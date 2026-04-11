/**
 * Command: Rename S3 object or prefix (folder)
 *
 * S3 doesn't support rename natively, so this is implemented as:
 * 1. Copy object(s) to new key
 * 2. Delete original object(s)
 *
 * For prefixes (folders), all objects under the prefix are renamed recursively.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem, S3PrefixItem, S3TreeProvider } from '../views/s3-tree-provider';

export async function renameObject(
    item: S3ObjectItem | S3PrefixItem,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    // Determine current name
    let currentName: string;
    let isPrefix = false;

    if (item instanceof S3ObjectItem) {
        currentName = item.key.split('/').pop()!;
    } else {
        isPrefix = true;
        const prefix = item.prefix;
        currentName = prefix.endsWith('/') ? prefix.slice(0, -1).split('/').pop()! : prefix.split('/').pop()!;
    }

    // Prompt for new name
    const newName = await vscode.window.showInputBox({
        prompt: `Enter new name for "${currentName}"`,
        value: currentName,
        placeHolder: isPrefix ? 'folder-name' : 'file-name.ext',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Name cannot be empty';
            }
            if (value.includes('/')) {
                return 'Name cannot contain "/" (use a different prefix to reorganize)';
            }
            return null;
        },
    });

    if (!newName || newName.trim() === currentName) {
        return; // User cancelled or no change
    }

    const trimmedNewName = newName.trim();

    // Confirm the operation
    const action = isPrefix ? 'Rename folder' : 'Rename file';
    const confirm = await vscode.window.showWarningMessage(
        `${action} "${currentName}" to "${trimmedNewName}"?\n\nThis will copy the object(s) to the new name and delete the original.`,
        { modal: true },
        'Rename',
    );

    if (!confirm) {
        return;
    }

    try {
        if (isPrefix) {
            await renamePrefix(item as S3PrefixItem, trimmedNewName, s3Service, treeProvider);
        } else {
            await renameSingleObject(item as S3ObjectItem, trimmedNewName, s3Service, treeProvider);
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to rename "${currentName}": ${msg}`);
    }
}

async function renameSingleObject(
    item: S3ObjectItem,
    newName: string,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const parts = item.key.split('/');
    parts[parts.length - 1] = newName;
    const newKey = parts.join('/');

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Renaming "${item.key.split('/').pop()}" to "${newName}"...`,
        },
        async () => {
            // 1. Copy to new key
            await s3Service.copyObject(
                item.bucket,
                item.key,
                item.bucket,
                newKey,
                item.region,
                item.region,
            );

            // 2. Delete original
            await s3Service.deleteObject(item.bucket, item.key, item.region);
        },
    );

    vscode.window.showInformationMessage(`Renamed to "${newKey}"`);
    treeProvider.refresh();
}

async function renamePrefix(
    item: S3PrefixItem,
    newName: string,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const srcPrefix = item.prefix;
    const parentPrefix = srcPrefix.endsWith('/')
        ? srcPrefix.slice(0, -1).split('/').slice(0, -1).join('/')
        : srcPrefix.split('/').slice(0, -1).join('/');
    const destPrefix = parentPrefix ? `${parentPrefix}/${newName}/` : `${newName}/`;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Scanning "${srcPrefix.split('/').filter(Boolean).pop()}"...`,
            cancellable: false,
        },
        async (progress) => {
            // Recursively collect ALL objects under the entire folder tree
            const allObjects: string[] = [];
            await collectAllObjects(s3Service, item.bucket, item.region, srcPrefix, allObjects, progress);

            progress.report({ message: `Found ${allObjects.length} object(s) to rename...` });

            let errors = 0;
            const errorDetails: string[] = [];

            // Copy each object to the new prefix
            for (let i = 0; i < allObjects.length; i++) {
                const key = allObjects[i];
                progress.report({ message: `[${i + 1}/${allObjects.length}] ${key}` });

                try {
                    const relativeKey = key.startsWith(srcPrefix)
                        ? key.slice(srcPrefix.length)
                        : key;
                    const newKey = destPrefix + relativeKey;

                    await s3Service.copyObject(
                        item.bucket,
                        key,
                        item.bucket,
                        newKey,
                        item.region,
                        item.region,
                    );
                } catch (err) {
                    errors++;
                    const msg = err instanceof Error ? err.message : String(err);
                    errorDetails.push(`${key}: ${msg}`);
                }
            }

            // Delete all originals (only if all copies succeeded)
            if (errors === 0) {
                for (let i = 0; i < allObjects.length; i++) {
                    const key = allObjects[i];
                    progress.report({ message: `Deleting ${i + 1}/${allObjects.length}...` });

                    try {
                        await s3Service.deleteObject(item.bucket, key, item.region);
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        errorDetails.push(`DELETE ${key}: ${msg}`);
                        errors++;
                    }
                }

                // Also delete the folder placeholder object
                try {
                    await s3Service.deleteObject(item.bucket, srcPrefix, item.region);
                } catch {
                    // Folder placeholder may not exist — that's OK
                }
            }

            if (errors > 0) {
                vscode.window.showWarningMessage(
                    `Renamed with ${errors} error(s) during cleanup:\n${errorDetails.slice(0, 3).join('\n')}`,
                );
            }
        },
    );

    vscode.window.showInformationMessage(`Renamed folder to "${newName}"`);
    treeProvider.refresh();
}

/**
 * Recursively collects ALL object keys under a prefix, including objects
 * in nested sub-folders. Handles the Delimiter: '/' pagination where
 * commonPrefixes represent sub-folders whose contents are NOT returned.
 */
async function collectAllObjects(
    s3Service: S3Service,
    bucket: string,
    region: string,
    prefix: string,
    results: string[],
    progress: { report: (data: { message: string }) => void },
): Promise<void> {
    let continuationToken: string | undefined;

    do {
        const page = await s3Service.listObjects(bucket, prefix, region, continuationToken);

        // Collect objects at this level
        results.push(...page.objects.map(obj => obj.key));

        // Recurse into each sub-folder (commonPrefix)
        for (const subPrefix of page.commonPrefixes) {
            await collectAllObjects(s3Service, bucket, region, subPrefix, results, progress);
        }

        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
}
