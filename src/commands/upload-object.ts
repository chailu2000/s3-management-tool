/**
 * Command: Upload object(s) and/or directories
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 *
 * Supports both single-file uploads (existing behaviour) and recursive
 * directory uploads with change detection (skip unchanged files).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { S3TreeProvider, S3BucketItem, S3PrefixItem } from '../views/s3-tree-provider';
import { uploadDirectory, uploadSingleFile } from '../utils/upload-helpers';
import { UploadResult } from '../models/s3-models';

const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5 MB

export async function uploadObject(
    context: S3PrefixItem | S3BucketItem | undefined,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: 'Upload',
    });

    if (!fileUris || fileUris.length === 0) {
        return;
    }

    // Determine default prefix from context
    let defaultPrefix = '';
    let bucket = '';
    let region = '';
    let configuredPrefix = '';

    if (context instanceof S3PrefixItem) {
        defaultPrefix = context.prefix;
        bucket = context.bucket;
        region = context.region;
        configuredPrefix = context.bucketConfig?.prefix ?? '';
    } else if (context instanceof S3BucketItem) {
        bucket = context.config.name;
        region = context.config.region;
        configuredPrefix = context.config.prefix ?? '';
        defaultPrefix = configuredPrefix;
    }

    if (!bucket) {
        vscode.window.showErrorMessage('No bucket context selected. Please select a bucket or prefix in the tree.');
        return;
    }

    const destinationPrefix = await vscode.window.showInputBox({
        prompt: 'Destination prefix (folder path in S3)',
        placeHolder: 'folder/subfolder/',
        value: defaultPrefix,
    });

    if (destinationPrefix === undefined) {
        return;
    }

    // Prepend configured prefix scope if not already present
    const effectivePrefix = resolveDestinationPrefix(destinationPrefix, configuredPrefix);

    let refreshNode: S3PrefixItem | S3BucketItem | undefined = context;

    // Aggregate results for summary notification
    const aggregateResult: UploadResult = { uploaded: 0, skipped: 0, errors: 0, totalBytes: 0, errorDetails: [] };

    for (const fileUri of fileUris) {
        const filePath = fileUri.fsPath;
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // --- Recursive directory upload ---
            const destPrefixForDir = effectivePrefix
                ? `${effectivePrefix}${path.basename(filePath)}/`
                : `${path.basename(filePath)}/`;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Uploading folder "${path.basename(filePath)}" to s3://${bucket}/${destPrefixForDir}…`,
                    cancellable: true,
                },
                async (progress, token) => {
                    const result = await uploadDirectory(
                        filePath,
                        bucket,
                        destPrefixForDir,
                        region,
                        s3Service,
                        (message) => { progress.report({ message }); },
                        { get isCancellationRequested() { return token.isCancellationRequested; } },
                    );
                    aggregateResult.uploaded += result.uploaded;
                    aggregateResult.skipped += result.skipped;
                    aggregateResult.errors += result.errors;
                    aggregateResult.totalBytes += result.totalBytes;
                    aggregateResult.errorDetails.push(...result.errorDetails);
                },
            );
        } else {
            // --- Single file upload (existing behaviour) ---
            const filename = path.basename(filePath);
            const destKey = effectivePrefix ? `${effectivePrefix}${filename}` : filename;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Uploading ${filename}…`,
                    cancellable: false,
                },
                async (progress) => {
                    try {
                        if (stat.size > MULTIPART_THRESHOLD) {
                            await s3Service.putObjectMultipart(
                                bucket,
                                destKey,
                                filePath,
                                region,
                                (bytesTransferred, totalBytes) => {
                                    const pct = Math.round((bytesTransferred / totalBytes) * 100);
                                    progress.report({ message: `${pct}%` });
                                },
                            );
                        } else {
                            const body = fs.readFileSync(filePath);
                            await s3Service.putObject(bucket, destKey, body, region);
                        }
                        aggregateResult.uploaded++;
                        aggregateResult.totalBytes += stat.size;
                    } catch (error) {
                        aggregateResult.errors++;
                        const msg = error instanceof Error ? error.message : String(error);
                        aggregateResult.errorDetails.push(`${filename}: ${msg}`);
                        vscode.window.showErrorMessage(`Failed to upload "${filename}": ${msg}`);
                    }
                },
            );
        }
    }

    // Summary notification
    if (aggregateResult.uploaded > 0 || aggregateResult.skipped > 0 || aggregateResult.errors > 0) {
        let summary = `Uploaded: ${aggregateResult.uploaded}`;
        if (aggregateResult.skipped > 0) {
            summary += ` · Skipped: ${aggregateResult.skipped}`;
        }
        if (aggregateResult.errors > 0) {
            summary += ` · Errors: ${aggregateResult.errors}`;
        }
        summary += ` · ${formatSize(aggregateResult.totalBytes)}`;

        if (aggregateResult.errors > 0) {
            vscode.window.showWarningMessage(summary);
        } else {
            vscode.window.showInformationMessage(summary);
        }
    }

    treeProvider.refresh(refreshNode);
}

function resolveDestinationPrefix(prefix: string, configuredPrefix: string): string {
    if (!configuredPrefix) {
        return prefix;
    }
    if (prefix.startsWith(configuredPrefix)) {
        return prefix;
    }
    return configuredPrefix + prefix;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}
