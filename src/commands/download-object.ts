/**
 * Command: Download object
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem } from '../views/s3-tree-provider';

export async function downloadObject(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void> {
    // Last segment of key as default filename
    const filename = item.key.includes('/')
        ? item.key.slice(item.key.lastIndexOf('/') + 1)
        : item.key;

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename),
        saveLabel: 'Download',
    });

    if (!saveUri) {
        return;
    }

    const localPath = saveUri.fsPath;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${filename}…`,
            cancellable: false,
        },
        async () => {
            let writeStream: fs.WriteStream | undefined;
            try {
                const readStream = await s3Service.getObject(item.bucket, item.key, item.region);
                writeStream = fs.createWriteStream(localPath);

                await new Promise<void>((resolve, reject) => {
                    readStream.pipe(writeStream!);
                    writeStream!.on('finish', resolve);
                    writeStream!.on('error', reject);
                    readStream.on('error', reject);
                });

                vscode.window.showInformationMessage(`Downloaded to ${localPath}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to download "${item.key}": ${msg}`);

                // Clean up partial file
                try {
                    if (fs.existsSync(localPath)) {
                        fs.unlinkSync(localPath);
                    }
                } catch {
                    // Best-effort cleanup
                }
            } finally {
                writeStream?.destroy();
            }
        },
    );
}
