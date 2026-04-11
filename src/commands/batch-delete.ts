/**
 * Command: Batch delete S3 objects and/or prefixes
 *
 * Accepts a single item or an array of selected items.
 * For prefixes, deletes all objects under the prefix recursively.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem, S3PrefixItem, S3TreeProvider } from '../views/s3-tree-provider';

export async function batchDelete(
    items: S3ObjectItem | S3PrefixItem | Array<S3ObjectItem | S3PrefixItem>,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const itemList = Array.isArray(items) ? items : [items];

    if (itemList.length === 0) {
        return;
    }

    // Build confirmation message
    const objectCount = itemList.filter(i => i instanceof S3ObjectItem).length;
    const prefixCount = itemList.filter(i => i instanceof S3PrefixItem).length;

    let confirmMsg = `Delete ${objectCount} object(s)`;
    if (prefixCount > 0) {
        confirmMsg += ` and ${prefixCount} folder(s)`;
    }
    confirmMsg += '? This action cannot be undone.';

    if (prefixCount > 0) {
        confirmMsg += '\n\nFolders will have all their contents deleted recursively.';
    }

    const confirm = await vscode.window.showWarningMessage(
        confirmMsg,
        { modal: true },
        'Delete',
    );

    if (!confirm) {
        return;
    }

    let deleted = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Deleting ${itemList.length} item(s)...`,
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < itemList.length; i++) {
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage(
                        `Delete cancelled. ${deleted} item(s) deleted.`,
                    );
                    return;
                }

                const item = itemList[i];
                progress.report({ message: `[${i + 1}/${itemList.length}] ${getItemLabel(item)}` });

                try {
                    if (item instanceof S3ObjectItem) {
                        await s3Service.deleteObject(item.bucket, item.key, item.region);
                        deleted++;
                    } else if (item instanceof S3PrefixItem) {
                        const result = await deletePrefixRecursive(
                            item.bucket,
                            item.prefix,
                            item.region,
                            s3Service,
                            (message) => { progress.report({ message }); },
                            { get isCancellationRequested() { return token.isCancellationRequested; } },
                        );
                        deleted += result.deleted;
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
    let summary = `Deleted: ${deleted}`;
    if (errors > 0) { summary += ` · Errors: ${errors}`; }

    if (errors > 0) {
        vscode.window.showWarningMessage(summary);
    } else {
        vscode.window.showInformationMessage(summary);
    }

    treeProvider.refresh();
}

async function deletePrefixRecursive(
    bucket: string,
    prefix: string,
    region: string,
    s3Service: S3Service,
    onProgress: (message: string) => void,
    cancellation: { readonly isCancellationRequested: boolean },
): Promise<{ deleted: number; errors: number; errorDetails: string[] }> {
    let deleted = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Recursively collect ALL object keys under the entire folder tree
    const allKeys: string[] = [];
    await collectAllKeysForDelete(s3Service, bucket, region, prefix, allKeys, cancellation);

    // Delete all collected objects
    for (const key of allKeys) {
        if (cancellation.isCancellationRequested) {
            break;
        }

        try {
            onProgress(`Deleting ${key}...`);
            await s3Service.deleteObject(bucket, key, region);
            deleted++;
        } catch (err) {
            errors++;
            const msg = err instanceof Error ? err.message : String(err);
            errorDetails.push(`${key}: ${msg}`);
        }
    }

    // Also delete the folder placeholder object
    try {
        await s3Service.deleteObject(bucket, prefix, region);
        deleted++;
    } catch {
        // Folder placeholder may not exist — that's OK
    }

    return { deleted, errors, errorDetails };
}

async function collectAllKeysForDelete(
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
            await collectAllKeysForDelete(s3Service, bucket, region, subPrefix, results, cancellation);
        }

        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
}

function getItemLabel(item: S3ObjectItem | S3PrefixItem): string {
    if (item instanceof S3ObjectItem) {
        return item.key.split('/').pop()!;
    }
    const prefix = item.prefix;
    return prefix.endsWith('/') ? prefix.slice(0, -1).split('/').pop()! : prefix.split('/').pop()!;
}
