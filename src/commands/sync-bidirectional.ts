/**
 * Command: Bidirectional Sync
 * Requirements: 15.1
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SyncService, CancellationToken } from '../services/sync-service';
import { SyncOptions, SyncResult, FileClassification } from '../models/s3-models';

export async function syncBidirectional(
    syncService: SyncService,
    context: vscode.ExtensionContext,
): Promise<void> {
    // Prompt for local directory
    const localPath = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Directory to SYNC',
    });

    if (!localPath || localPath.length === 0) {
        return;
    }

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

    // Prompt for conflict strategy
    const conflictStrategy = await vscode.window.showQuickPick(
        [
            { label: 'keep-local', description: 'Upload local file to S3, overwriting remote' },
            { label: 'keep-remote', description: 'Download S3 object, overwriting local file' },
            { label: 'keep-both', description: 'Rename local with .conflict suffix, download remote' },
            { label: 'skip', description: 'Leave both sides unchanged' },
        ],
        {
            placeHolder: 'Conflict resolution strategy',
        },
    );

    if (!conflictStrategy) {
        return;
    }

    // Prompt for delete missing option
    const deleteMissing = await vscode.window.showQuickPick(
        ['Yes', 'No'],
        {
            placeHolder: 'Delete files that exist only on one side?',
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
        direction: 'bidirectional',
        deleteMissing: deleteMissing === 'Yes',
        excludePatterns: ['**/.git/**', '**/node_modules/**', '**/.DS_Store'],
        conflictStrategy: conflictStrategy.label as SyncOptions['conflictStrategy'],
        dryRun: dryRun === 'Yes - Preview only',
    };

    // Execute sync with progress
    const tokenSource = new vscode.CancellationTokenSource();
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: options.dryRun ? 'Calculating bidirectional sync changes…' : `Bidirectional sync: ${path.basename(options.localPath)} ↔ ${options.bucket}`,
            cancellable: true,
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                tokenSource.cancel();
            });

            const vsCodeToken: CancellationToken = {
                get isCancellationRequested() {
                    return token.isCancellationRequested;
                },
            };

            return await syncService.syncBidirectional(
                options,
                vsCodeToken,
                (progressUpdate) => {
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
    const mode = dryRun ? 'Preview' : 'Bidirectional Sync';

    if (result.errors.length > 0) {
        // Warning if there are errors
        vscode.window.showWarningMessage(
            `${mode} completed with ${result.errors.length} error(s): ` +
            `${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.skipped} skipped, ${result.conflicts} conflicts`,
        );

        // Show detailed errors in output channel
        const outputChannel = vscode.window.createOutputChannel('S3 Sync');
        outputChannel.appendLine(`${mode} Result Summary:`);
        outputChannel.appendLine(`  Uploaded: ${result.uploaded}`);
        outputChannel.appendLine(`  Downloaded: ${result.downloaded}`);
        outputChannel.appendLine(`  Skipped: ${result.skipped}`);
        outputChannel.appendLine(`  Conflicts: ${result.conflicts}`);
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
            `${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.skipped} skipped, ${result.conflicts} conflicts`,
        );
    }
}
