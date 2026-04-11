/**
 * Shared upload helpers used by the upload command and drag-and-drop.
 */

import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { LocalFile, walkDirectory, computeLocalMd5, normalizeEtag, isMultipartEtag } from './fs-utils';
import { UploadResult } from '../models/s3-models';

const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Uploads an entire local directory to an S3 bucket/prefix.
 * Skips files that haven't changed (MD5 vs ETag comparison).
 * Reports progress via the onProgress callback.
 * Supports cancellation via the token.
 */
export async function uploadDirectory(
    localDir: string,
    bucket: string,
    destPrefix: string,
    region: string,
    s3Service: S3Service,
    onProgress: (message: string) => void,
    token: { isCancellationRequested: boolean },
): Promise<UploadResult> {
    const result: UploadResult = { uploaded: 0, skipped: 0, errors: 0, totalBytes: 0, errorDetails: [] };

    // 1. Walk local directory
    let localFiles: LocalFile[];
    try {
        localFiles = walkDirectory(localDir, localDir);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errorDetails.push(`Failed to walk directory "${localDir}": ${msg}`);
        result.errors++;
        return result;
    }

    if (localFiles.length === 0) {
        return result;
    }

    // 2. Fetch existing S3 objects under the destination prefix for change detection
    const s3ObjectMap = await buildS3ObjectMap(bucket, destPrefix, region, s3Service);

    // 3. Upload each file
    for (const file of localFiles) {
        if (token.isCancellationRequested) {
            return result;
        }

        const s3Key = destPrefix ? `${destPrefix}${file.relativePath.replace(/\\/g, '/')}` : file.relativePath.replace(/\\/g, '/');

        try {
            // Change detection
            const remoteEtag = s3ObjectMap.get(s3Key);
            if (remoteEtag && !isMultipartEtag(remoteEtag)) {
                const localMd5 = await computeLocalMd5(file.absolutePath);
                if (localMd5 === normalizeEtag(remoteEtag)) {
                    result.skipped++;
                    onProgress(`[skip] ${file.relativePath} (unchanged)`);
                    continue;
                }
            }

            // Upload
            const bytes = await uploadSingleFile(file.absolutePath, bucket, s3Key, region, s3Service, (pct) => {
                onProgress(`[${Math.round(pct)}%] ${file.relativePath}`);
            });

            result.uploaded++;
            result.totalBytes += bytes;
        } catch (err) {
            result.errors++;
            const msg = err instanceof Error ? err.message : String(err);
            result.errorDetails.push(`${file.relativePath}: ${msg}`);
            onProgress(`[error] ${file.relativePath}: ${msg}`);
        }
    }

    return result;
}

/**
 * Uploads a single file to S3, using multipart for large files.
 * Returns the number of bytes uploaded.
 */
export async function uploadSingleFile(
    localPath: string,
    bucket: string,
    destKey: string,
    region: string,
    s3Service: S3Service,
    onProgress?: (percent: number) => void,
): Promise<number> {
    const stat = fs.statSync(localPath);
    const fileSize = stat.size;

    if (fileSize > MULTIPART_THRESHOLD) {
        await s3Service.putObjectMultipart(bucket, destKey, localPath, region, (bytesTransferred) => {
            if (onProgress) {
                onProgress((bytesTransferred / fileSize) * 100);
            }
        });
    } else {
        const body = fs.readFileSync(localPath);
        await s3Service.putObject(bucket, destKey, body, region);
    }

    return fs.statSync(localPath).size;
}

/**
 * Checks whether a local file has changed compared to a remote ETag.
 * Returns true if the file should be re-uploaded.
 */
export async function isFileChanged(
    localPath: string,
    remoteEtag: string | undefined,
): Promise<boolean> {
    if (!remoteEtag) { return true; }
    if (isMultipartEtag(remoteEtag)) { return true; }
    const localMd5 = await computeLocalMd5(localPath);
    return localMd5 !== normalizeEtag(remoteEtag);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Builds a map of S3 key → ETag for all objects under the given prefix.
 */
async function buildS3ObjectMap(
    bucket: string,
    prefix: string,
    region: string,
    s3Service: S3Service,
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let continuationToken: string | undefined;

    do {
        const page = await s3Service.listObjects(bucket, prefix, region, continuationToken);
        for (const obj of page.objects) {
            map.set(obj.key, obj.etag);
        }
        continuationToken = page.nextContinuationToken;
    } while (continuationToken);

    return map;
}
