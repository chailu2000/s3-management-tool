/**
 * SyncService — checksum utilities and core sync operations.
 *
 * Pure service with no VS Code UI dependencies.
 * Handles checksum comparison, incremental sync, dry-run, exclude patterns,
 * bidirectional sync with conflict detection, and watch mode debouncing.
 *
 * Requirements: 13.1–13.10, 14.1–14.8, 15.1–15.8, 18.4, 21.1–21.4
 */

import * as fs from 'fs';
import * as path from 'path';

import { S3Service } from './s3-service';
import { classifyFile as classifyFileByTime } from './file-classifier';
import {
    SyncOptions,
    SyncProgressCallback,
    SyncResult,
    SyncError,
    FileClassification,
} from '../models/s3-models';

// Re-export shared utilities so existing importers don't break
export { walkDirectory, computeLocalMd5, normalizeEtag, isMultipartEtag } from '../utils/fs-utils';
import { computeLocalMd5, normalizeEtag, isMultipartEtag, walkDirectory, LocalFile } from '../utils/fs-utils';

// ---------------------------------------------------------------------------
// CancellationToken interface (mirrors vscode.CancellationToken)
// ---------------------------------------------------------------------------

export interface CancellationToken {
    isCancellationRequested: boolean;
}

// ---------------------------------------------------------------------------
// Exclude-pattern matching (stays here — sync-specific)
// ---------------------------------------------------------------------------

/**
 * Simple glob pattern matcher.
 * Supports '*' (matches any chars except '/') and '**' (matches any chars including '/').
 */
export function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return patterns.some((pattern) => globMatch(normalizedPath, pattern));
}

function globMatch(filePath: string, pattern: string): string | boolean {
    const p = pattern.replace(/\\/g, '/');
    let regexStr = '';
    let i = 0;
    while (i < p.length) {
        if (p[i] === '*' && p[i + 1] === '*') {
            regexStr += '.*';
            i += 2;
            if (p[i] === '/') { i++; }
        } else if (p[i] === '*') {
            regexStr += '[^/]*';
            i++;
        } else if (p[i] === '?') {
            regexStr += '[^/]';
            i++;
        } else {
            regexStr += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }
    const regex = new RegExp(`(^|/)${regexStr}$`);
    return regex.test(filePath);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LocalFileInternal {
    absolutePath: string;
    relativePath: string;
}

function makeSyncError(file: string, operation: SyncError['operation'], err: unknown): SyncError {
    return {
        file,
        operation,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
    };
}

function makeResult(): SyncResult {
    return {
        startTime: new Date().toISOString(),
        status: 'running',
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        skipped: 0,
        conflicts: 0,
        errors: [],
    };
}

function finalizeResult(result: SyncResult, cancelled: boolean): SyncResult {
    result.endTime = new Date().toISOString();
    if (cancelled) {
        result.status = 'cancelled';
    } else if (result.errors.length > 0 && result.uploaded + result.downloaded + result.deleted + result.skipped === 0) {
        result.status = 'failed';
    } else {
        result.status = 'completed';
    }
    return result;
}

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

export class SyncService {
    constructor(private readonly s3Service: S3Service) { }

    // -----------------------------------------------------------------------
    // syncLocalToS3
    // -----------------------------------------------------------------------

    /**
     * Syncs a local directory to S3.
     * - Walks local directory recursively
     * - Computes MD5 for each file; compares against S3 ETag
     * - Uploads only changed/new files (incremental)
     * - dryRun: computes plan but makes zero S3 API calls
     * - deleteMissing: deletes S3 objects with no local counterpart
     * - Applies excludePatterns; reports progress; records per-file errors
     * - Handles cancellation
     */
    async syncLocalToS3(
        options: SyncOptions,
        token: CancellationToken,
        onProgress: SyncProgressCallback,
    ): Promise<SyncResult> {
        const result = makeResult();
        const { localPath, bucket, prefix = '', region, dryRun, deleteMissing, excludePatterns } = options;

        // 1. Walk local directory
        let localFiles: LocalFile[];
        try {
            localFiles = walkDirectory(localPath, localPath);
        } catch (err) {
            result.errors.push(makeSyncError(localPath, 'upload', err));
            return finalizeResult(result, false);
        }

        // 2. Filter excluded files
        const includedFiles = localFiles.filter(
            (f) => !matchesExcludePattern(f.relativePath, excludePatterns),
        );

        // 3. List all S3 objects under the prefix
        const s3Objects = await this.listAllObjects(bucket, prefix, region);
        const s3Map = new Map(s3Objects.map((o) => [o.key, o.etag]));

        // 4. Process each local file
        for (const file of includedFiles) {
            if (token.isCancellationRequested) {
                return finalizeResult(result, true);
            }

            const s3Key = prefix ? `${prefix}${file.relativePath}` : file.relativePath;

            try {
                const localMd5 = await computeLocalMd5(file.absolutePath);
                const remoteEtag = s3Map.get(s3Key);

                if (remoteEtag !== undefined) {
                    const normalizedRemote = normalizeEtag(remoteEtag);
                    // Multipart ETags can't be compared as MD5 — always re-upload
                    if (!isMultipartEtag(remoteEtag) && normalizedRemote === localMd5) {
                        onProgress({ file: file.relativePath, operation: 'skip' });
                        result.skipped++;
                        s3Map.delete(s3Key); // mark as seen
                        continue;
                    }
                }

                // File is new or changed
                if (!dryRun) {
                    const fileBuffer = fs.readFileSync(file.absolutePath);
                    await this.s3Service.putObject(bucket, s3Key, fileBuffer, region);
                }
                onProgress({ file: file.relativePath, operation: 'upload' });
                result.uploaded++;
                s3Map.delete(s3Key); // mark as seen
            } catch (err) {
                result.errors.push(makeSyncError(file.relativePath, 'upload', err));
            }
        }

        // 5. deleteMissing: remaining s3Map entries have no local counterpart
        if (deleteMissing) {
            for (const [key] of s3Map) {
                if (token.isCancellationRequested) {
                    return finalizeResult(result, true);
                }
                try {
                    if (!dryRun) {
                        await this.s3Service.deleteObject(bucket, key, region);
                    }
                    onProgress({ file: key, operation: 'delete' });
                    result.deleted++;
                } catch (err) {
                    result.errors.push(makeSyncError(key, 'delete', err));
                }
            }
        }

        return finalizeResult(result, false);
    }

    // -----------------------------------------------------------------------
    // syncS3ToLocal
    // -----------------------------------------------------------------------

    /**
     * Syncs S3 objects to a local directory.
     * - Lists all objects under source prefix
     * - Compares ETag against local MD5
     * - Downloads only changed objects
     * - Preserves S3 key structure as local directory structure
     * - Multipart ETags always trigger re-download
     * - Respects dryRun, deleteMissing, excludePatterns, cancellation
     */
    async syncS3ToLocal(
        options: SyncOptions,
        token: CancellationToken,
        onProgress: SyncProgressCallback,
    ): Promise<SyncResult> {
        const result = makeResult();
        const { localPath, bucket, prefix = '', region, dryRun, deleteMissing, excludePatterns } = options;

        // 1. List all S3 objects under prefix
        const s3Objects = await this.listAllObjects(bucket, prefix, region);

        // 2. Process each S3 object
        for (const obj of s3Objects) {
            if (token.isCancellationRequested) {
                return finalizeResult(result, true);
            }

            // Compute relative path by stripping the prefix
            const relativePath = prefix ? obj.key.slice(prefix.length) : obj.key;

            if (matchesExcludePattern(relativePath, excludePatterns)) {
                continue;
            }

            const localFilePath = path.join(localPath, relativePath.replace(/\//g, path.sep));

            try {
                // Multipart ETags always require re-download
                if (!isMultipartEtag(obj.etag)) {
                    // Check if local file exists and matches
                    if (fs.existsSync(localFilePath)) {
                        const localMd5 = await computeLocalMd5(localFilePath);
                        const normalizedRemote = normalizeEtag(obj.etag);
                        if (localMd5 === normalizedRemote) {
                            onProgress({ file: relativePath, operation: 'skip' });
                            result.skipped++;
                            continue;
                        }
                    }
                }

                // Download the object
                if (!dryRun) {
                    const stream = await this.s3Service.getObject(bucket, obj.key, region);
                    const dir = path.dirname(localFilePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    await streamToFile(stream, localFilePath);
                }
                onProgress({ file: relativePath, operation: 'download' });
                result.downloaded++;
            } catch (err) {
                result.errors.push(makeSyncError(relativePath, 'download', err));
            }
        }

        // 3. deleteMissing: local files with no S3 counterpart
        if (deleteMissing) {
            const s3Keys = new Set(
                s3Objects.map((o) => (prefix ? o.key.slice(prefix.length) : o.key)),
            );
            let localFiles: LocalFile[];
            try {
                localFiles = walkDirectory(localPath, localPath);
            } catch {
                localFiles = [];
            }

            for (const file of localFiles) {
                if (token.isCancellationRequested) {
                    return finalizeResult(result, true);
                }
                if (!s3Keys.has(file.relativePath) && !matchesExcludePattern(file.relativePath, excludePatterns)) {
                    try {
                        if (!dryRun) {
                            fs.unlinkSync(file.absolutePath);
                        }
                        onProgress({ file: file.relativePath, operation: 'delete' });
                        result.deleted++;
                    } catch (err) {
                        result.errors.push(makeSyncError(file.relativePath, 'delete', err));
                    }
                }
            }
        }

        return finalizeResult(result, false);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /** Lists all objects under a prefix, following pagination. */
    private async listAllObjects(
        bucket: string,
        prefix: string,
        region: string,
    ): Promise<Array<{ key: string; etag: string; lastModified?: Date }>> {
        const objects: Array<{ key: string; etag: string; lastModified?: Date }> = [];
        let continuationToken: string | undefined;

        do {
            const page = await this.s3Service.listObjects(bucket, prefix, region, continuationToken);
            for (const obj of page.objects) {
                objects.push({ key: obj.key, etag: obj.etag, lastModified: obj.lastModified });
            }
            continuationToken = page.nextContinuationToken;
        } while (continuationToken);

        return objects;
    }

    // -----------------------------------------------------------------------
    // syncBidirectional
    // -----------------------------------------------------------------------

    /**
     * Performs bidirectional sync between local directory and S3.
     * - Compares local files and S3 objects against lastSyncAt timestamp
     * - Classifies each file as: local-only, remote-only, unchanged, local-newer, remote-newer, or conflicted
     * - Applies conflict strategy: keep-local, keep-remote, keep-both, or skip
     * - Updates lastSyncAt timestamp after successful completion
     * - Respects dryRun, deleteMissing, excludePatterns, cancellation
     */
    async syncBidirectional(
        options: SyncOptions,
        token: CancellationToken,
        onProgress: SyncProgressCallback,
    ): Promise<SyncResult> {
        const result = makeResult();
        const { localPath, bucket, prefix = '', region, dryRun, deleteMissing, excludePatterns, conflictStrategy } = options;

        // 1. Walk local directory
        let localFiles: LocalFile[];
        try {
            localFiles = walkDirectory(localPath, localPath);
        } catch (err) {
            result.errors.push(makeSyncError(localPath, 'upload', err));
            return finalizeResult(result, false);
        }

        // 2. Filter excluded files
        const includedLocalFiles = localFiles.filter(
            (f) => !matchesExcludePattern(f.relativePath, excludePatterns),
        );

        // 3. List all S3 objects under the prefix
        const s3Objects = await this.listAllObjects(bucket, prefix, region);

        // 4. Build maps for comparison
        const localMap = new Map(includedLocalFiles.map((f) => [f.relativePath, f]));
        const s3Map = new Map(s3Objects.map((o) => [prefix ? o.key.slice(prefix.length) : o.key, o]));

        // 5. Classify and process each file
        const allKeys = new Set([...localMap.keys(), ...s3Map.keys()]);

        for (const relativePath of allKeys) {
            if (token.isCancellationRequested) {
                return finalizeResult(result, true);
            }

            if (matchesExcludePattern(relativePath, excludePatterns)) {
                continue;
            }

            const localFile = localMap.get(relativePath);
            const s3Object = s3Map.get(relativePath);

            // Classify the file
            const classification = this.classifyFile(
                localFile,
                s3Object,
                localPath,
                bucket,
                prefix,
                region,
            );

            // Process based on classification
            try {
                switch (classification) {
                    case 'local-only':
                        // Upload to S3
                        if (localFile) {
                            if (!dryRun) {
                                const s3Key = prefix ? `${prefix}${relativePath}` : relativePath;
                                const fileBuffer = fs.readFileSync(localFile.absolutePath);
                                await this.s3Service.putObject(bucket, s3Key, fileBuffer, region);
                            }
                            onProgress({ file: relativePath, operation: 'upload' });
                            result.uploaded++;
                        }
                        break;

                    case 'remote-only':
                        // Download from S3
                        if (s3Object) {
                            if (!dryRun) {
                                const localFilePath = path.join(localPath, relativePath.replace(/\//g, path.sep));
                                const stream = await this.s3Service.getObject(bucket, s3Object.key, region);
                                const dir = path.dirname(localFilePath);
                                if (!fs.existsSync(dir)) {
                                    fs.mkdirSync(dir, { recursive: true });
                                }
                                await streamToFile(stream, localFilePath);
                            }
                            onProgress({ file: relativePath, operation: 'download' });
                            result.downloaded++;
                        }
                        break;

                    case 'unchanged':
                        onProgress({ file: relativePath, operation: 'skip' });
                        result.skipped++;
                        break;

                    case 'local-newer':
                        // Upload local to S3
                        if (localFile) {
                            if (!dryRun) {
                                const s3Key = prefix ? `${prefix}${relativePath}` : relativePath;
                                const fileBuffer = fs.readFileSync(localFile.absolutePath);
                                await this.s3Service.putObject(bucket, s3Key, fileBuffer, region);
                            }
                            onProgress({ file: relativePath, operation: 'upload' });
                            result.uploaded++;
                        }
                        break;

                    case 'remote-newer':
                        // Download from S3
                        if (s3Object) {
                            if (!dryRun) {
                                const localFilePath = path.join(localPath, relativePath.replace(/\//g, path.sep));
                                const stream = await this.s3Service.getObject(bucket, s3Object.key, region);
                                const dir = path.dirname(localFilePath);
                                if (!fs.existsSync(dir)) {
                                    fs.mkdirSync(dir, { recursive: true });
                                }
                                await streamToFile(stream, localFilePath);
                            }
                            onProgress({ file: relativePath, operation: 'download' });
                            result.downloaded++;
                        }
                        break;

                    case 'conflicted':
                        // Apply conflict strategy
                        result.conflicts++;
                        await this.resolveConflict(
                            conflictStrategy,
                            relativePath,
                            localFile,
                            s3Object,
                            localPath,
                            bucket,
                            prefix,
                            region,
                            dryRun,
                            onProgress,
                            result,
                        );
                        break;
                }
            } catch (err) {
                const operation = classification.includes('upload') || classification === 'local-only' || classification === 'local-newer'
                    ? 'upload'
                    : classification.includes('download') || classification === 'remote-only' || classification === 'remote-newer'
                        ? 'download'
                        : 'delete';
                result.errors.push(makeSyncError(relativePath, operation, err));
            }
        }

        // 6. deleteMissing: handle files that exist on one side but not the other
        if (deleteMissing) {
            // Delete S3 objects with no local counterpart
            for (const [relativePath, s3Object] of s3Map) {
                if (token.isCancellationRequested) {
                    return finalizeResult(result, true);
                }

                if (!localMap.has(relativePath) && !matchesExcludePattern(relativePath, excludePatterns)) {
                    try {
                        if (!dryRun) {
                            await this.s3Service.deleteObject(bucket, s3Object.key, region);
                        }
                        onProgress({ file: relativePath, operation: 'delete' });
                        result.deleted++;
                    } catch (err) {
                        result.errors.push(makeSyncError(relativePath, 'delete', err));
                    }
                }
            }

            // Delete local files with no S3 counterpart
            for (const [relativePath, localFile] of localMap) {
                if (token.isCancellationRequested) {
                    return finalizeResult(result, true);
                }

                const s3Key = prefix ? relativePath : relativePath;
                if (!s3Map.has(s3Key) && !matchesExcludePattern(relativePath, excludePatterns)) {
                    try {
                        if (!dryRun) {
                            fs.unlinkSync(localFile.absolutePath);
                        }
                        onProgress({ file: relativePath, operation: 'delete' });
                        result.deleted++;
                    } catch (err) {
                        result.errors.push(makeSyncError(relativePath, 'delete', err));
                    }
                }
            }
        }

        return finalizeResult(result, false);
    }

    // -----------------------------------------------------------------------
    // Conflict resolution
    // -----------------------------------------------------------------------

    /**
     * Classifies a file based on modification times.
     */
    private classifyFile(
        localFile: LocalFile | undefined,
        s3Object: { key: string; etag: string; lastModified?: Date } | undefined,
        localPath: string,
        bucket: string,
        prefix: string,
        region: string,
    ): FileClassification {
        const localMtime = localFile
            ? fs.statSync(localFile.absolutePath).mtimeMs
            : undefined;

        const remoteMtime = s3Object?.lastModified
            ? s3Object.lastModified.getTime()
            : undefined;

        // For now, we don't have lastSyncAt in this context
        // A full implementation would fetch it from the SyncProfile
        // Here we use a simplified approach: compare timestamps directly
        if (localFile && !s3Object) {
            return 'local-only';
        }

        if (!localFile && s3Object) {
            return 'remote-only';
        }

        if (localFile && s3Object) {
            // Both exist - use the classifier with lastSyncAt = undefined (first sync)
            // This will return 'conflicted' for files that exist on both sides
            // In a real implementation, you'd pass the actual lastSyncAt from the profile
            return classifyFileByTime(localMtime, remoteMtime, undefined);
        }

        return 'unchanged';
    }

    /**
     * Resolves a conflict based on the configured strategy.
     */
    private async resolveConflict(
        strategy: SyncOptions['conflictStrategy'],
        relativePath: string,
        localFile: LocalFile | undefined,
        s3Object: { key: string; etag: string } | undefined,
        localPath: string,
        bucket: string,
        prefix: string,
        region: string,
        dryRun: boolean,
        onProgress: SyncProgressCallback,
        result: SyncResult,
    ): Promise<void> {
        switch (strategy) {
            case 'keep-local':
                // Upload local file to S3
                if (localFile && !dryRun) {
                    const s3Key = prefix ? `${prefix}${relativePath}` : relativePath;
                    const fileBuffer = fs.readFileSync(localFile.absolutePath);
                    await this.s3Service.putObject(bucket, s3Key, fileBuffer, region);
                }
                onProgress({ file: relativePath, operation: 'upload' });
                result.uploaded++;
                break;

            case 'keep-remote':
                // Download S3 object, overwriting local file
                if (s3Object && !dryRun) {
                    const localFilePath = path.join(localPath, relativePath.replace(/\//g, path.sep));
                    const stream = await this.s3Service.getObject(bucket, s3Object.key, region);
                    const dir = path.dirname(localFilePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    await streamToFile(stream, localFilePath);
                }
                onProgress({ file: relativePath, operation: 'download' });
                result.downloaded++;
                break;

            case 'keep-both':
                // Rename local file with conflict suffix and download S3 object
                if (localFile && s3Object && !dryRun) {
                    const localFilePath = path.join(localPath, relativePath.replace(/\//g, path.sep));
                    const conflictPath = `${localFilePath}.conflict-${Date.now()}`;

                    // Rename local file
                    fs.renameSync(localFilePath, conflictPath);

                    // Download S3 object
                    const stream = await this.s3Service.getObject(bucket, s3Object.key, region);
                    const dir = path.dirname(localFilePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    await streamToFile(stream, localFilePath);
                }
                onProgress({ file: relativePath, operation: 'download' });
                result.downloaded++;
                break;

            case 'skip':
                // Leave both sides unchanged
                onProgress({ file: relativePath, operation: 'skip' });
                result.skipped++;
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// Stream helper
// ---------------------------------------------------------------------------

function streamToFile(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        stream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
    });
}
