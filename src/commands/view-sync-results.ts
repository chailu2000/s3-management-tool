/**
 * Command: View Sync Results
 * Requirements: 22.4
 */

import * as vscode from 'vscode';
import { SyncResult } from '../models/s3-models';

// Store last sync result for viewing
let lastSyncResult: SyncResult | undefined;

export async function viewSyncResults(): Promise<void> {
    if (!lastSyncResult) {
        vscode.window.showInformationMessage('No sync results to display. Run a sync operation first.');
        return;
    }

    // Create output channel
    const outputChannel = vscode.window.createOutputChannel('S3 Sync Results');
    outputChannel.clear();

    // Display summary
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine('S3 Sync Result Details');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine('');
    outputChannel.appendLine(`Status: ${lastSyncResult.status.toUpperCase()}`);
    outputChannel.appendLine(`Start Time: ${new Date(lastSyncResult.startTime).toLocaleString()}`);
    if (lastSyncResult.endTime) {
        outputChannel.appendLine(`End Time: ${new Date(lastSyncResult.endTime).toLocaleString()}`);
    }
    outputChannel.appendLine('');

    // Display counts
    outputChannel.appendLine('Summary:');
    outputChannel.appendLine(`  Uploaded:   ${lastSyncResult.uploaded}`);
    outputChannel.appendLine(`  Downloaded: ${lastSyncResult.downloaded}`);
    outputChannel.appendLine(`  Deleted:    ${lastSyncResult.deleted}`);
    outputChannel.appendLine(`  Skipped:    ${lastSyncResult.skipped}`);
    outputChannel.appendLine(`  Conflicts:  ${lastSyncResult.conflicts}`);
    outputChannel.appendLine(`  Errors:     ${lastSyncResult.errors.length}`);
    outputChannel.appendLine('');

    // Display errors if any
    if (lastSyncResult.errors.length > 0) {
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine('Errors:');
        outputChannel.appendLine('─'.repeat(60));

        for (const error of lastSyncResult.errors) {
            outputChannel.appendLine('');
            outputChannel.appendLine(`[${error.timestamp}]`);
            outputChannel.appendLine(`  Operation: ${error.operation}`);
            outputChannel.appendLine(`  File: ${error.file}`);
            outputChannel.appendLine(`  Error: ${error.error}`);
        }

        outputChannel.appendLine('');
    }

    outputChannel.appendLine('═'.repeat(60));

    // Show the output channel
    outputChannel.show();
}

// Export function to store sync result (called by sync commands)
export function storeSyncResult(result: SyncResult): void {
    lastSyncResult = result;
}
