/**
 * Command: Watch Mode (Start/Stop)
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SyncService, CancellationToken } from '../services/sync-service';
import { BucketStorage } from '../services/bucket-storage';
import { SyncProfile, SyncOptions } from '../models/s3-models';

// Global state for watch mode
let activeWatchMode: {
    watcher: vscode.FileSystemWatcher;
    statusBarItem: vscode.StatusBarItem;
    profile: SyncProfile;
} | undefined;

// ---------------------------------------------------------------------------
// Start Watch Mode
// ---------------------------------------------------------------------------

export async function startWatchMode(
    bucketStorage: BucketStorage,
    syncService: SyncService,
    context: vscode.ExtensionContext,
): Promise<void> {
    // Check if watch mode is already active
    if (activeWatchMode) {
        const choice = await vscode.window.showWarningMessage(
            'Watch mode is already active. Do you want to stop it first?',
            'Stop Current',
            'Cancel',
        );

        if (choice === 'Stop Current') {
            await stopWatchMode();
        } else {
            return;
        }
    }

    // Get profiles or prompt for manual configuration
    const profiles = await bucketStorage.getSyncProfiles();

    let profile: SyncProfile | undefined;

    if (profiles.length > 0) {
        const profilePick = await vscode.window.showQuickPick(
            profiles.map((p) => ({
                label: p.name,
                description: `${p.bucket}/${p.prefix || ''} ↔ ${p.localPath}`,
                profile: p,
            })),
            {
                placeHolder: 'Select sync profile (or press Esc for manual configuration)',
            },
        );

        if (profilePick) {
            profile = profilePick.profile;
        }
    }

    // Manual configuration if no profile selected
    if (!profile) {
        profile = await promptForWatchConfiguration();
        if (!profile) {
            return;
        }
    }

    // Validate local path exists
    const localPath = profile.localPath;

    // Create file system watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(localPath, '**/*'),
        false, // ignoreCreateEvents
        false, // ignoreChangeEvents
        false, // ignoreDeleteEvents
    );

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        99,
    );
    statusBarItem.text = `$(sync~spin) S3 Watch: ${profile.name}`;
    statusBarItem.tooltip = `Watching: ${localPath}\nTarget: s3://${profile.bucket}/${profile.prefix || ''}\nClick to stop watch mode`;
    statusBarItem.command = 's3-management-tool.stopWatchMode';
    statusBarItem.show();

    // Debounce timer
    let debounceTimer: NodeJS.Timeout | undefined;
    const DEBOUNCE_MS = 500;

    // Track pending uploads
    const pendingFiles = new Map<string, 'upload' | 'delete'>();

    // Handle file creation
    watcher.onDidCreate(async (uri) => {
        if (uri.fsPath.startsWith(localPath)) {
            pendingFiles.set(uri.fsPath, 'upload');
            scheduleSync();
        }
    });

    // Handle file change
    watcher.onDidChange(async (uri) => {
        if (uri.fsPath.startsWith(localPath)) {
            pendingFiles.set(uri.fsPath, 'upload');
            scheduleSync();
        }
    });

    // Handle file deletion
    watcher.onDidDelete(async (uri) => {
        if (uri.fsPath.startsWith(localPath) && profile!.deleteMissing) {
            pendingFiles.set(uri.fsPath, 'delete');
            scheduleSync();
        }
    });

    // Debounced sync function
    function scheduleSync() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            await processPendingFiles();
        }, DEBOUNCE_MS);
    }

    async function processPendingFiles() {
        if (pendingFiles.size === 0) {
            return;
        }

        const filesToProcess = new Map(pendingFiles);
        pendingFiles.clear();

        // Build sync options
        const options: SyncOptions = {
            localPath: profile!.localPath,
            bucket: profile!.bucket,
            prefix: profile!.prefix || '',
            region: profile!.region,
            direction: profile!.direction,
            deleteMissing: profile!.deleteMissing,
            excludePatterns: profile!.excludePatterns,
            conflictStrategy: profile!.conflictStrategy,
            dryRun: false,
        };

        // Process each pending file
        for (const [filePath, operation] of filesToProcess) {
            try {
                const relativePath = path.relative(localPath, filePath);
                const s3Key = options.prefix ? `${options.prefix}${relativePath}` : relativePath;

                if (operation === 'upload') {
                    // Upload file to S3
                    const fs = require('fs');
                    if (fs.existsSync(filePath)) {
                        const fileBuffer = fs.readFileSync(filePath);
                        await syncService['s3Service'].putObject(
                            options.bucket,
                            s3Key,
                            fileBuffer,
                            options.region,
                        );
                    }
                } else if (operation === 'delete') {
                    // Delete from S3
                    await syncService['s3Service'].deleteObject(
                        options.bucket,
                        s3Key,
                        options.region,
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Watch mode upload failed: ${filePath} - ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    // Store active watch mode
    activeWatchMode = {
        watcher,
        statusBarItem,
        profile,
    };

    context.subscriptions.push({
        dispose: () => stopWatchMode(),
    });

    vscode.window.showInformationMessage(
        `Watch mode started: ${profile.name}\nMonitoring: ${localPath}`,
    );
}

// ---------------------------------------------------------------------------
// Stop Watch Mode
// ---------------------------------------------------------------------------

export async function stopWatchMode(): Promise<void> {
    if (!activeWatchMode) {
        vscode.window.showInformationMessage('Watch mode is not active');
        return;
    }

    // Dispose watcher
    activeWatchMode.watcher.dispose();

    // Remove status bar item
    activeWatchMode.statusBarItem.dispose();

    // Clear active watch mode
    activeWatchMode = undefined;

    vscode.window.showInformationMessage('Watch mode stopped');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function promptForWatchConfiguration(): Promise<SyncProfile | undefined> {
    // Prompt for local directory
    const localPathUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Directory to Watch',
    });

    if (!localPathUri || localPathUri.length === 0) {
        return undefined;
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
        return undefined;
    }

    // Prompt for prefix (optional)
    const prefix = await vscode.window.showInputBox({
        prompt: 'Enter S3 prefix (optional)',
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
        return undefined;
    }

    const now = new Date().toISOString();

    return {
        id: generateUUID(),
        name: `Watch: ${path.basename(localPathUri[0].fsPath)}`,
        localPath: localPathUri[0].fsPath,
        bucket: bucket.trim(),
        prefix: prefix?.trim() || '',
        region: region.trim(),
        direction: 'upload',
        deleteMissing: false,
        excludePatterns: ['**/.git/**', '**/node_modules/**', '**/.DS_Store'],
        conflictStrategy: 'skip',
        createdAt: now,
        updatedAt: now,
    };
}

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
