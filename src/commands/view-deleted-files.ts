/**
 * Command: View Deleted Files
 *
 * Opens a webview panel displaying deleted files for the entire bucket,
 * provided versioning is enabled.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3BucketItem } from '../views/s3-tree-provider';
import { VersionsPanel } from '../webviews/versions-panel';
import { S3TreeProvider } from '../views/s3-tree-provider';

export async function viewDeletedFiles(
    item: S3BucketItem,
    s3Service: S3Service,
    extensionUri: vscode.Uri,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const bucket = item.config.name;
    const region = item.config.region;

    // The VersionsPanel.create handles the versioning check, fetching the first page,
    // and showing messages/errors appropriately.
    await VersionsPanel.create(extensionUri, {
        bucket,
        region,
        s3Service,
        treeProvider,
    });
}
