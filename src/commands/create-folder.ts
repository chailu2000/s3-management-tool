/**
 * Command: Create Folder (prefix placeholder) in S3
 *
 * S3 has no real "folders" — a folder is a zero-byte object whose key ends with '/'.
 * This command creates that zero-byte placeholder object so the prefix appears
 * in the tree view and S3 console.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3TreeProvider, S3BucketItem, S3PrefixItem } from '../views/s3-tree-provider';

export async function createFolder(
    context: S3BucketItem | S3PrefixItem | undefined,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    let bucket: string;
    let region: string;
    let basePrefix: string;

    if (context instanceof S3PrefixItem) {
        bucket = context.bucket;
        region = context.region;
        basePrefix = context.prefix;
    } else if (context instanceof S3BucketItem) {
        bucket = context.config.name;
        region = context.config.region;
        basePrefix = context.config.prefix ?? '';
    } else {
        vscode.window.showErrorMessage(
            'No bucket or prefix context selected. Please right-click on a bucket or prefix in the tree.',
        );
        return;
    }

    const folderName = await vscode.window.showInputBox({
        prompt: 'Folder name',
        placeHolder: 'my-folder/',
        validateInput: (input) => {
            if (!input || input.trim().length === 0) {
                return 'Folder name is required';
            }
            return null;
        },
    });

    if (!folderName) {
        return;
    }

    // Ensure the folder key ends with '/'
    const normalisedFolder = folderName.endsWith('/') ? folderName : `${folderName}/`;
    const folderKey = basePrefix ? `${basePrefix}${normalisedFolder}` : normalisedFolder;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Creating folder "${normalisedFolder}" in ${bucket}…`,
            cancellable: false,
        },
        async () => {
            try {
                await s3Service.putObject(bucket, folderKey, Buffer.from(''), region);
                vscode.window.showInformationMessage(
                    `Created folder "${normalisedFolder}" in s3://${bucket}/${basePrefix}`,
                );
                // Refresh the node where the folder was created
                treeProvider.refresh(context);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(
                    `Failed to create folder "${normalisedFolder}": ${msg}`,
                );
            }
        },
    );
}
