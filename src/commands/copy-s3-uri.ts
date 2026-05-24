/**
 * Command: Copy S3 URI to clipboard
 *
 * Copies the s3:// URI for an object or prefix to the system clipboard.
 */

import * as vscode from 'vscode';
import { S3BucketItem, S3ObjectItem, S3PrefixItem } from '../views/s3-tree-provider';

export async function copyS3Uri(
    item: S3BucketItem | S3ObjectItem | S3PrefixItem,
): Promise<void> {
    let uri: string;

    if (item instanceof S3BucketItem) {
        const bucketPath = item.config.prefix ? `${item.config.name}/${item.config.prefix}` : item.config.name;
        uri = `s3://${bucketPath}`;
    } else if (item instanceof S3ObjectItem) {
        uri = `s3://${item.bucket}/${item.key}`;
    } else if (item instanceof S3PrefixItem) {
        uri = `s3://${item.bucket}/${item.prefix}`;
    } else {
        vscode.window.showErrorMessage('No valid object or prefix selected.');
        return;
    }

    await vscode.env.clipboard.writeText(uri);
    vscode.window.showInformationMessage(`Copied to clipboard: ${uri}`);
}
