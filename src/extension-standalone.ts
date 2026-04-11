/**
 * Standalone VS Code Extension for AWS S3 Management
 *
 * This extension communicates directly with AWS S3 without requiring a backend server.
 * It uses the AWS SDK for all operations and stores configuration in VS Code's global state.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.4, 2.5
 */

import * as vscode from 'vscode';
import { S3ClientFactory } from './aws/client-factory';
import { S3Service } from './services/s3-service';
import { CredentialProvider } from './services/credential-provider';
import { BucketStorage } from './services/bucket-storage';
import { SyncService } from './services/sync-service';
import { S3TreeProvider, S3BucketItem, S3ObjectItem, S3PrefixItem } from './views/s3-tree-provider';
import { ObjectDetailsPanel } from './views/object-details-panel';
import { VersionsPanel } from './webviews/versions-panel';
import { BucketConfig, ObjectMetadata } from './models/s3-models';
import { sanitizeForWebview } from './utils/webview-sanitizer';
import { viewMetadata } from './commands/view-metadata';

function log(message: string): void {
    console.log(`[S3 Management Tool] ${message}`);
}

// Global service instances
let extensionContext: vscode.ExtensionContext;
let clientFactory: S3ClientFactory;
let credentialProvider: CredentialProvider;
let bucketStorage: BucketStorage;
let s3Service: S3Service;
let syncService: SyncService;
let treeProvider: S3TreeProvider;
let objectDetailsPanel: ObjectDetailsPanel;

// Status bar items
let awsProfileStatusBarItem: vscode.StatusBarItem;
let watchModeStatusBarItem: vscode.StatusBarItem;

// ---------------------------------------------------------------------------
// Extension Lifecycle
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;
    log('S3 Management Tool extension is now active!');

    // Initialize services
    credentialProvider = new CredentialProvider(context.secrets);
    bucketStorage = new BucketStorage(context);

    // Initialize client factory (credentials will be loaded on demand)
    clientFactory = new S3ClientFactory();

    // Initialize S3 service
    s3Service = new S3Service(clientFactory);

    // Initialize sync service
    syncService = new SyncService(s3Service);

    // Initialize tree provider — register IMMEDIATELY so tree renders right away
    treeProvider = new S3TreeProvider(bucketStorage, s3Service);

    // Use createTreeView instead of registerTreeDataProvider to enable drag-and-drop
    const treeView = vscode.window.createTreeView('s3ManagementBuckets', {
        treeDataProvider: treeProvider,
        dragAndDropController: treeProvider,
        canSelectMany: true,
    });
    context.subscriptions.push(treeView);

    // Initialize object details panel
    objectDetailsPanel = new ObjectDetailsPanel(
        context.extensionUri,
        handleObjectDetailsCommand,
    );

    // Create status bar items
    awsProfileStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    awsProfileStatusBarItem.command = 's3-management-tool.selectAwsProfile';
    awsProfileStatusBarItem.tooltip = 'Select AWS Profile';
    awsProfileStatusBarItem.show();
    context.subscriptions.push(awsProfileStatusBarItem);

    watchModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    watchModeStatusBarItem.command = 's3-management-tool.stopWatchMode';
    watchModeStatusBarItem.tooltip = 'Stop S3 Watch Mode';
    context.subscriptions.push(watchModeStatusBarItem);

    // Register all commands — done BEFORE async work so commands are available immediately
    registerCommands(context);

    // Fire-and-forget: load credentials in background (don't block activation)
    loadDefaultCredentials().catch(err => {
        log(`Background credential load failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Fire-and-forget: run auto-discovery in background (don't block activation)
    runAutoDiscovery().catch(err => {
        log(`Background auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function deactivate(): void {
    log('S3 Management Tool extension is now deactivated');
    clientFactory.dispose();
    if (objectDetailsPanel) {
        objectDetailsPanel.dispose();
    }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

function registerCommands(context: vscode.ExtensionContext): void {
    // Bucket management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.addBucketByName', async () => {
            const { addBucketByName } = await import('./commands/add-bucket-by-name');
            await addBucketByName(bucketStorage, s3Service, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.addBucketByArn', async () => {
            const { addBucketByArn } = await import('./commands/add-bucket-by-arn');
            await addBucketByArn(bucketStorage, s3Service, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.addBucketWithPrefix', async () => {
            const { addBucketWithPrefix } = await import('./commands/add-bucket-with-prefix');
            await addBucketWithPrefix(bucketStorage, s3Service, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.removeBucket', async (item) => {
            const { removeBucket } = await import('./commands/remove-bucket');
            await removeBucket(item, bucketStorage, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.refreshBuckets', async () => {
            treeProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.selectAwsProfile', async () => {
            const { selectProfile } = await import('./commands/select-profile');
            await selectProfile(credentialProvider, clientFactory, treeProvider, awsProfileStatusBarItem);
        }),
    );

    // Object operation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.downloadObject', async (item: S3ObjectItem) => {
            const { downloadObject } = await import('./commands/download-object');
            await downloadObject(item, s3Service);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.uploadObject', async (item) => {
            const { uploadObject } = await import('./commands/upload-object');
            await uploadObject(item, s3Service, treeProvider);
        }),
    );

    // deleteObject is registered later with batch-delete support (multi-select)

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.copyObject', async (item: S3ObjectItem) => {
            const { copyObject } = await import('./commands/copy-object');
            await copyObject(item, s3Service);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.viewMetadata', async (item: S3ObjectItem) => {
            await viewMetadata(item, s3Service);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.generatePresignedUrl', async (item: S3ObjectItem) => {
            const { generatePresignedUrl } = await import('./commands/generate-presigned-url');
            await generatePresignedUrl(item, s3Service);
        }),
    );

    // Sync commands
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.syncLocalToS3', async () => {
            const { syncLocalToS3 } = await import('./commands/sync-local-to-s3');
            await syncLocalToS3(syncService, extensionContext);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.syncS3ToLocal', async () => {
            const { syncS3ToLocal } = await import('./commands/sync-s3-to-local');
            await syncS3ToLocal(syncService, extensionContext);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.syncBidirectional', async () => {
            const { syncBidirectional } = await import('./commands/sync-bidirectional');
            await syncBidirectional(syncService, extensionContext);
        }),
    );

    // Sync profile commands
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.createSyncProfile', async () => {
            const { createSyncProfile } = await import('./commands/sync-profiles');
            await createSyncProfile(bucketStorage);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.runSyncProfile', async () => {
            const { runSyncProfile } = await import('./commands/sync-profiles');
            await runSyncProfile(bucketStorage, syncService);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.editSyncProfile', async () => {
            const { editSyncProfile } = await import('./commands/sync-profiles');
            await editSyncProfile(bucketStorage);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.deleteSyncProfile', async () => {
            const { deleteSyncProfile } = await import('./commands/sync-profiles');
            await deleteSyncProfile(bucketStorage);
        }),
    );

    // Watch mode commands
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.startWatchMode', async () => {
            const { startWatchMode } = await import('./commands/watch-mode');
            await startWatchMode(bucketStorage, syncService, extensionContext);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.stopWatchMode', async () => {
            const { stopWatchMode } = await import('./commands/watch-mode');
            await stopWatchMode();
        }),
    );

    // View sync results command
    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.viewSyncResults', async () => {
            const { viewSyncResults } = await import('./commands/view-sync-results');
            await viewSyncResults();
        }),
    );

    // --- New feature commands (#1-5) ---

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.createFolder', async (item) => {
            const { createFolder } = await import('./commands/create-folder');
            await createFolder(item, s3Service, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.copyS3Uri', async (item) => {
            const { copyS3Uri } = await import('./commands/copy-s3-uri');
            await copyS3Uri(item as S3ObjectItem | S3PrefixItem);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.bucketInfo', async (item: S3BucketItem) => {
            const { bucketInfo } = await import('./commands/bucket-info');
            await bucketInfo(item, s3Service);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.previewObject', async (item: S3ObjectItem) => {
            const { previewObject } = await import('./commands/preview-object');
            await previewObject(item, s3Service);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.loadMore', async (item) => {
            const { S3LoadMoreItem } = await import('./views/s3-tree-provider');
            if (item instanceof S3LoadMoreItem) {
                await treeProvider.loadMore(item);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.downloadFolder', async (item: S3PrefixItem) => {
            const { downloadFolder } = await import('./commands/download-folder');
            await downloadFolder(item, s3Service);
        }),
    );

    // --- Feature #6: Versioned Bucket Support ---

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.viewVersions', async (item: S3ObjectItem) => {
            const panel = await VersionsPanel.create(extensionContext.extensionUri, {
                bucket: item.bucket,
                key: item.key,
                region: item.region,
                s3Service,
                treeProvider: treeProvider,
            });
            // Panel creation handles all guard checks and errors internally
        }),
    );

    // --- Feature #12: Inline Rename ---

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.renameObject', async (item) => {
            const { renameObject } = await import('./commands/rename-object');
            await renameObject(item as S3ObjectItem | S3PrefixItem, s3Service, treeProvider);
        }),
    );

    // --- Feature #11: Object Tag Management ---

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.manageTags', async (item: S3ObjectItem) => {
            const { manageTags } = await import('./commands/manage-tags');
            await manageTags(item, s3Service);
        }),
    );

    // --- Feature #9: Multi-Select Operations (Batch Delete, Batch Download) ---

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.deleteObject', async (item, selectedItems) => {
            const { batchDelete } = await import('./commands/batch-delete');
            // If multiple items are selected, use batch delete
            const itemsToDelete = selectedItems && Array.isArray(selectedItems) && selectedItems.length > 1
                ? selectedItems
                : item;
            await batchDelete(itemsToDelete, s3Service, treeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('s3-management-tool.downloadSelected', async (item, selectedItems) => {
            const { downloadSelected } = await import('./commands/download-selected');
            const itemsToDownload = selectedItems && Array.isArray(selectedItems) && selectedItems.length > 1
                ? selectedItems
                : item;
            await downloadSelected(itemsToDownload, s3Service);
        }),
    );
}

// ---------------------------------------------------------------------------
// Object Details Command Handler
// ---------------------------------------------------------------------------

async function handleObjectDetailsCommand(command: string, args: any): Promise<void> {
    try {
        switch (command) {
            case 'downloadObject':
                vscode.commands.executeCommand('s3-management-tool.downloadObject', {
                    bucket: args.bucket,
                    key: args.key,
                    region: 'us-east-1', // Will be resolved by command
                });
                break;

            case 'deleteObject':
                vscode.commands.executeCommand('s3-management-tool.deleteObject', {
                    bucket: args.bucket,
                    key: args.key,
                    region: 'us-east-1',
                });
                break;

            case 'copyObject':
                vscode.commands.executeCommand('s3-management-tool.copyObject', {
                    bucket: args.bucket,
                    key: args.key,
                    region: 'us-east-1',
                });
                break;

            case 'generatePresignedUrl':
                vscode.commands.executeCommand('s3-management-tool.generatePresignedUrl', {
                    bucket: args.bucket,
                    key: args.key,
                    region: 'us-east-1',
                });
                break;

            case 'uploadToPrefix':
                vscode.commands.executeCommand('s3-management-tool.uploadObject', {
                    bucket: args.bucket,
                    prefix: args.prefix,
                    region: 'us-east-1',
                });
                break;

            default:
                log(`Unknown object details command: ${command}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute ${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ---------------------------------------------------------------------------
// Auto-Discovery
// ---------------------------------------------------------------------------

async function runAutoDiscovery(): Promise<void> {
    try {
        const result = await s3Service.tryListBuckets();

        if (result.hasPermission && result.buckets.length > 0) {
            const choice = await vscode.window.showInformationMessage(
                `Found ${result.buckets.length} S3 bucket(s). Would you like to import them?`,
                'Import All',
                'Skip',
            );

            if (choice === 'Import All') {
                for (const bucket of result.buckets) {
                    await bucketStorage.addBucket({
                        id: generateUUID(),
                        name: bucket.name,
                        region: bucket.region || 'us-east-1',
                        addedManually: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    });
                }
                treeProvider.refresh();
                vscode.window.showInformationMessage(`Imported ${result.buckets.length} bucket(s)`);
            }
        }
    } catch (error) {
        // Auto-discovery failed - this is OK, user can add buckets manually
        log(`Auto-discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ---------------------------------------------------------------------------
// Status Bar Updates
// ---------------------------------------------------------------------------

/**
 * Attempt to load credentials from the default chain on extension activation.
 * Tries the default profile first, then falls back gracefully if none exist.
 */
async function loadDefaultCredentials(): Promise<void> {
    try {
        // Try the default profile from ~/.aws/credentials
        const profiles = await credentialProvider.listProfiles();
        if (profiles.length > 0) {
            // Use the first available profile (usually 'default')
            const defaultProfile = profiles.includes('default') ? 'default' : profiles[0];
            const creds = await credentialProvider.getCredentials(defaultProfile);
            clientFactory.updateCredentials(creds);
            log(`Loaded credentials from profile: ${creds.profile ?? defaultProfile}`);
            await updateAwsProfileStatusBarItem();
            return;
        }

        // Check VS Code SecretStorage
        try {
            const storedCreds = await credentialProvider.getCredentials();
            if (storedCreds) {
                clientFactory.updateCredentials(storedCreds);
                log('Loaded credentials from VS Code SecretStorage');
                await updateAwsProfileStatusBarItem();
                return;
            }
        } catch {
            // No stored credentials in SecretStorage
        }

        // Check environment variables
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            const creds = await credentialProvider.getCredentials();
            if (creds) {
                clientFactory.updateCredentials(creds);
                log('Loaded credentials from environment variables');
                await updateAwsProfileStatusBarItem();
            }
        }
    } catch {
        // No credentials available yet — user can select a profile manually
        log('No default credentials found; user can select a profile manually');
    }
}

async function updateAwsProfileStatusBarItem(): Promise<void> {
    try {
        const credentials = await credentialProvider.getCredentials();
        if (credentials?.profile) {
            awsProfileStatusBarItem.text = `$(account) ${credentials.profile}`;
        } else {
            awsProfileStatusBarItem.text = '$(account) No Profile';
        }
    } catch {
        awsProfileStatusBarItem.text = '$(account) No Credentials';
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
