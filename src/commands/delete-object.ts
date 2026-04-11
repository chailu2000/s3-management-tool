/**
 * Command: Delete object
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3TreeProvider, S3ObjectItem } from '../views/s3-tree-provider';

export async function deleteObject(
    item: S3ObjectItem,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete object "${item.key}"?`,
        { modal: true },
        'Delete',
    );

    if (confirm !== 'Delete') {
        return;
    }

    try {
        await s3Service.deleteObject(item.bucket, item.key, item.region);
        treeProvider.refresh();
        vscode.window.showInformationMessage(`Deleted "${item.key}".`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to delete "${item.key}": ${msg}`);
    }
}
