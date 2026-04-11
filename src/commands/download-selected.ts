/**
 * Command: Download Selected S3 objects and/or prefixes
 *
 * Prompts for a local destination folder, then downloads all selected items
 * preserving directory structure.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem, S3PrefixItem, S3TreeProvider } from '../views/s3-tree-provider';

export async function downloadSelected(
    items: S3ObjectItem | S3PrefixItem | Array<S3ObjectItem | S3PrefixItem>,
    s3Service: S3Service,
): Promise<void> {
    const itemList = Array.isArray(items) ? items : [items];

    if (itemList.length === 0) {
        return;
    }

    // Prompt for local destination folder
    const folderUris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Download Here',
    });

    if (!folderUris || folderUris.length === 0) {
        return;
    }

    const destFolder = folderUris[0].fsPath;
    let downloaded = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${itemList.length} item(s) to ${destFolder}...`,
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < itemList.length; i++) {
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage(
                        `Download cancelled. ${downloaded} item(s) downloaded.`,
                    );
                    return;
                }

                const item = itemList[i];
                progress.report({ message: `[${i + 1}/${itemList.length}] ${getItemLabel(item)}` });

                try {
                    if (item instanceof S3ObjectItem) {
                        const fileName = item.key.split('/').pop()!;
                        const destPath = path.join(destFolder, fileName);
                        await downloadSingleFile(s3Service, item.bucket, item.key, item.region, destPath);
                        downloaded++;
                    } else if (item instanceof S3PrefixItem) {
                        const result = await downloadPrefix(
                            s3Service,
                            item.bucket,
                            item.prefix,
                            item.region,
                            destFolder,
                            (message) => { progress.report({ message }); },
                            { get isCancellationRequested() { return token.isCancellationRequested; } },
                        );
                        downloaded += result.downloaded;
                        errors += result.errors;
                        errorDetails.push(...result.errorDetails);
                    }
                } catch (err) {
                    errors++;
                    const msg = err instanceof Error ? err.message : String(err);
                    errorDetails.push(`${getItemLabel(item)}: ${msg}`);
                }
            }
        },
    );

    // Summary
    let summary = `Downloaded: ${downloaded}`;
    if (errors > 0) { summary += ` · Errors: ${errors}`; }

    if (errors > 0) {
        vscode.window.showWarningMessage(summary);
    } else {
        vscode.window.showInformationMessage(summary);
    }
}

async function downloadSingleFile(
    s3Service: S3Service,
    bucket: string,
    key: string,
    region: string,
    destPath: string,
): Promise<void> {
    const stream = await s3Service.getObject(bucket, key, region);
    const writeStream = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
        stream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
    });
}

async function downloadPrefix(
    s3Service: S3Service,
    bucket: string,
    prefix: string,
    region: string,
    destFolder: string,
    onProgress: (message: string) => void,
    cancellation: { readonly isCancellationRequested: boolean },
): Promise<{ downloaded: number; errors: number; errorDetails: string[] }> {
    let downloaded = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Recursively collect ALL object keys
    const allKeys: string[] = [];
    await collectAllKeys(s3Service, bucket, region, prefix, allKeys, cancellation);

    // Download all collected objects
    for (const key of allKeys) {
        if (cancellation.isCancellationRequested) {
            break;
        }

        try {
            const relativePath = key.startsWith(prefix) ? key.slice(prefix.length) : key;
            const destPath = path.join(destFolder, relativePath);

            // Ensure parent directory exists
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            onProgress(`Downloading ${key}...`);

            const stream = await s3Service.getObject(bucket, key, region);
            const writeStream = fs.createWriteStream(destPath);
            await new Promise<void>((resolve, reject) => {
                stream.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                stream.on('error', reject);
            });

            downloaded++;
        } catch (err) {
            errors++;
            const msg = err instanceof Error ? err.message : String(err);
            errorDetails.push(`${key}: ${msg}`);
        }
    }

    return { downloaded, errors, errorDetails };
}

async function collectAllKeys(
    s3Service: S3Service,
    bucket: string,
    region: string,
    prefix: string,
    results: string[],
    cancellation: { readonly isCancellationRequested: boolean },
): Promise<void> {
    let continuationToken: string | undefined;

    do {
        if (cancellation.isCancellationRequested) break;

        const page = await s3Service.listObjects(bucket, prefix, region, continuationToken);
        results.push(...page.objects.map(obj => obj.key));

        for (const subPrefix of page.commonPrefixes) {
            await collectAllKeys(s3Service, bucket, region, subPrefix, results, cancellation);
        }

        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
}

function getItemLabel(item: S3ObjectItem | S3PrefixItem): string {
    if (item instanceof S3ObjectItem) {
        return item.key.split('/').pop()!;
    }
    const p = item.prefix;
    return p.endsWith('/') ? p.slice(0, -1).split('/').pop()! : p.split('/').pop()!;
}
