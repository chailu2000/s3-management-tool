/**
 * Command: Download entire prefix (folder) from S3 to local filesystem.
 *
 * Paginates through all objects under the prefix, downloads each one
 * preserving the S3 directory structure, and reports overall progress.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { S3PrefixItem } from '../views/s3-tree-provider';

export async function downloadFolder(
    item: S3PrefixItem,
    s3Service: S3Service,
): Promise<void> {
    // Step 1: Choose destination directory
    const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Destination',
    });

    if (!uris || uris.length === 0) {
        return;
    }

    const destDir = uris[0].fsPath;

    // The prefix displayed in the bucket tree already ends with '/'
    // We strip the bucket-configured prefix to get the "display" portion
    const configuredPrefix = item.bucketConfig?.prefix ?? '';
    // The relative portion the user sees (e.g. if prefix is "team-data/logs/", show "logs/")
    const displayPrefix = item.prefix.startsWith(configuredPrefix)
        ? item.prefix.slice(configuredPrefix.length)
        : item.prefix;

    // Step 2: Collect all objects via pagination
    const objects = await collectAllObjects(item.bucket, item.prefix, item.region, s3Service);

    if (objects.length === 0) {
        vscode.window.showInformationMessage(`No objects found under prefix "${displayPrefix || item.prefix}".`);
        return;
    }

    // Step 3: Download all objects with progress reporting
    // The local root folder includes the display prefix so the folder structure is preserved
    const localRoot = path.join(destDir, displayPrefix);
    let downloaded = 0;
    let totalBytes = 0;
    let errors = 0;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${objects.length} file(s) from s3://${item.bucket}/${displayPrefix}…`,
            cancellable: true,
        },
        async (progress, token) => {
            for (const obj of objects) {
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage(
                        `Download cancelled. ${downloaded} of ${objects.length} files downloaded.`,
                    );
                    return;
                }

                progress.report({
                    message: `[${downloaded + 1}/${objects.length}] ${obj.key}`,
                });

                try {
                    const bytes = await downloadSingleObject(
                        obj.key,
                        item.bucket,
                        item.region,
                        item.prefix,  // full S3 prefix to strip from key
                        localRoot,    // root folder on local disk (includes display prefix)
                        s3Service,
                    );
                    totalBytes += bytes;
                    downloaded++;
                } catch (error) {
                    errors++;
                    // Log error but continue
                    console.error(`[S3] Failed to download "${obj.key}": ${error}`);
                }
            }
        },
    );

    // Step 4: Summary
    if (errors > 0) {
        vscode.window.showWarningMessage(
            `Downloaded ${downloaded} file(s) (${formatSize(totalBytes)}) to ${localRoot} with ${errors} error(s). Check Output for details.`,
        );
    } else {
        vscode.window.showInformationMessage(
            `Downloaded ${downloaded} file(s) (${formatSize(totalBytes)}) to ${localRoot}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface ObjectRef {
    key: string;
}

async function collectAllObjects(
    bucket: string,
    prefix: string,
    region: string,
    s3Service: S3Service,
): Promise<ObjectRef[]> {
    const objects: ObjectRef[] = [];
    let token: string | undefined;

    do {
        const page = await s3Service.listObjects(bucket, prefix, region, token);
        for (const obj of page.objects) {
            objects.push({ key: obj.key });
        }
        token = page.nextContinuationToken;
    } while (token);

    return objects;
}

// ---------------------------------------------------------------------------
// Single object download
// ---------------------------------------------------------------------------

async function downloadSingleObject(
    key: string,
    bucket: string,
    region: string,
    prefix: string,
    destDir: string,
    s3Service: S3Service,
): Promise<number> {
    // Strip the prefix from the key to get the relative local path
    const relativeKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const localPath = path.join(destDir, relativeKey);

    // Create parent directories
    const parentDir = path.dirname(localPath);
    fs.mkdirSync(parentDir, { recursive: true });

    // Download stream to file
    const readStream = await s3Service.getObject(bucket, key, region);
    const writeStream = fs.createWriteStream(localPath);

    let bytesWritten = 0;
    writeStream.on('finish', () => {
        bytesWritten = fs.statSync(localPath).size;
    });

    await new Promise<void>((resolve, reject) => {
        readStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', (err) => {
            reject(err);
            // Clean up partial file
            try { fs.unlinkSync(localPath); } catch { /* best-effort */ }
        });
        readStream.on('error', (err) => {
            reject(err);
            try { fs.unlinkSync(localPath); } catch { /* best-effort */ }
        });
    });

    return fs.statSync(localPath).size;
}

// ---------------------------------------------------------------------------
// Size formatter (same as tree provider)
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}
