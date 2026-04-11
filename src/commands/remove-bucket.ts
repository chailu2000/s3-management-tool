/**
 * Command: Remove bucket from the extension (no AWS deletion)
 * Requirements: 4.7
 */

import * as vscode from 'vscode';
import { BucketStorage } from '../services/bucket-storage';
import { S3TreeProvider, S3BucketItem } from '../views/s3-tree-provider';
import { BucketConfig } from '../models/s3-models';

export async function removeBucket(
    item: S3BucketItem | BucketConfig,
    storage: BucketStorage,
    treeProvider: S3TreeProvider,
): Promise<void> {
    // Extract config from S3BucketItem if that's what we received
    const config = item instanceof S3BucketItem ? item.config : item;

    const answer = await vscode.window.showWarningMessage(
        `Remove bucket '${config.name}'? This will not delete the bucket from AWS.`,
        { modal: true },
        'Remove',
    );

    if (answer !== 'Remove') {
        return;
    }

    await storage.removeBucket(config.id);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Bucket "${config.name}" removed from the extension.`);
}
