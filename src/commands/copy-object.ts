/**
 * Command: Copy object
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem } from '../views/s3-tree-provider';

export async function copyObject(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void> {
    const dstBucket = await vscode.window.showInputBox({
        prompt: 'Destination bucket name',
        placeHolder: item.bucket,
        value: item.bucket,
    });
    if (dstBucket === undefined) {
        return;
    }

    const dstKey = await vscode.window.showInputBox({
        prompt: 'Destination key',
        placeHolder: item.key,
        value: item.key,
    });
    if (dstKey === undefined) {
        return;
    }

    const dstRegion = await vscode.window.showInputBox({
        prompt: 'Destination region',
        placeHolder: item.region,
        value: item.region,
    });
    if (dstRegion === undefined) {
        return;
    }

    try {
        await s3Service.copyObject(
            item.bucket,
            item.key,
            dstBucket.trim() || item.bucket,
            dstKey.trim() || item.key,
            item.region,
            dstRegion.trim() || item.region,
        );
        vscode.window.showInformationMessage(
            `Copied "${item.key}" to "${dstBucket}/${dstKey}".`,
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to copy "${item.key}": ${msg}`);
    }
}
