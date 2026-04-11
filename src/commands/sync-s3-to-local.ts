/**
 * Command: Sync S3 to Local
 * Requirements: 14.1, 22.3
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SyncService, CancellationToken } from '../services/sync-service';
import { SyncOptions, SyncResult } from '../models/s3-models';

export async function syncS3ToLocal(
    syncService: SyncService,
    context: vscode.ExtensionContext,
): Promise<void> {
    // Prompt for bucket
    const bucket = await vscode.window.showInputBox({
        prompt: 'Enter S3 bucket name',
        placeHolder: 'my-bucket',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Bucket name is required';
            }
            return null;
        },
    });

    if (!bucket) {
        return;
    }

    // Prompt for prefix (optional)
    const prefix = await vscode.window.showInputBox({
        prompt: 'Enter S3 prefix (optional, press Enter to skip)',
        placeHolder: 'path/to/folder/',
    });

    // Prompt for region
    const region = await vscode.window.showInputBox({
        prompt: 'Enter AWS region',
        placeHolder: 'us-east-1',
        value: 'us-east-1',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Region is required';
            }
            return null;
        },
    });

    if (!region) {
        return;
    }

    // Prompt for local destination directory
    const localPath = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Destination Directory',
    });

    if (!localPath || localPath.length === 0) {
        return;
    }

    // Prompt for delete missing option
    const deleteMissing = await vscode.window.showQuickPick(
        ['Yes', 'No'],
        {
            placeHolder: 'Delete local files that do not exist in S3?',
        },
    );

    // Prompt for dry run option
    const dryRun = await vscode.window.showQuickPick(
        ['No - Execute sync', 'Yes - Preview only'],
        {
            placeHolder: 'Dry run (preview changes without executing)?',
        },
    );

    if (!deleteMissing || !dryRun) {
        return;
    }

    // Build sync options
    const options: SyncOptions = {
        localPath: localPath[0].fsPath,
        bucket: bucket.trim(),
        prefix: prefix?.trim() || '',
        region: region.trim(),
        direction: 'download',
        deleteMissing: deleteMissing === 'Yes',
        excludePatterns: ['**/.git/**', '**/node_modules/**', '**/.DS_Store'],
        conflictStrategy: 'skip',
        dryRun: dryRun === 'Yes - Preview only',
    };

    // Execute sync with progress
    const tokenSource = new vscode.CancellationTokenSource();
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: options.dryRun ? 'Calculating sync changes…' : `Syncing from S3: ${options.bucket}`,
            cancellable: true,
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                tokenSource.cancel();
            });

            let processedCount = 0;
            const vsCodeToken: CancellationToken = {
                get isCancellationRequested() {
                    return token.isCancellationRequested;
                },
            };

            return await syncService.syncS3ToLocal(
                options,
                vsCodeToken,
                (progressUpdate) => {
                    processedCount++;
                    progress.report({
                        message: `${progressUpdate.operation}: ${progressUpdate.file}`,
                        increment: 1,
                    });
                },
            );
        },
    );

    // Display result summary
    displaySyncResult(result, options.dryRun);
}

function displaySyncResult(result: SyncResult, dryRun: boolean): void {
    const mode = dryRun ? 'Preview' : 'Sync';

    if (result.errors.length > 0) {
        // Warning if there are errors
        vscode.window.showWarningMessage(
            `${mode} completed with ${result.errors.length} error(s): ` +
            `${result.downloaded} downloaded, ${result.skipped} skipped, ${result.deleted} deleted`,
        );

        // Show detailed errors in output channel
        const outputChannel = vscode.window.createOutputChannel('S3 Sync');
        outputChannel.appendLine(`${mode} Result Summary:`);
        outputChannel.appendLine(`  Downloaded: ${result.downloaded}`);
        outputChannel.appendLine(`  Skipped: ${result.skipped}`);
        outputChannel.appendLine(`  Deleted: ${result.deleted}`);
        outputChannel.appendLine(`  Errors: ${result.errors.length}`);
        outputChannel.appendLine('');

        for (const error of result.errors) {
            outputChannel.appendLine(`[${error.timestamp}] ${error.operation} ${error.file}: ${error.error}`);
        }

        outputChannel.show();
    } else {
        // Info message if no errors
        vscode.window.showInformationMessage(
            `${mode} completed successfully: ` +
            `${result.downloaded} downloaded, ${result.skipped} skipped, ${result.deleted} deleted`,
        );
    }
}
