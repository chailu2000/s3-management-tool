/**
 * S3TreeProvider — implements vscode.TreeDataProvider<S3TreeItem>
 * and vscode.TreeDragAndDropController<S3TreeItem> for drag-in uploads.
 *
 * Tree hierarchy:
 *   S3BucketItem  (contextValue: 's3Bucket')
 *     S3PrefixItem  (contextValue: 's3Prefix')
 *     S3ObjectItem  (contextValue: 's3Object')
 *     S3ErrorItem   (contextValue: 's3Error')  — rendered on AccessDenied
 *
 * Requirements: 1.3, 1.4, 6.1, 6.2, 6.5, 6.6, 18.5
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { BucketStorage } from '../services/bucket-storage';
import { S3Service } from '../services/s3-service';
import { BucketConfig } from '../models/s3-models';
import { uploadDirectory, uploadSingleFile } from '../utils/upload-helpers';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export type S3TreeItem = S3BucketItem | S3PrefixItem | S3ObjectItem | S3ErrorItem | S3LoadMoreItem;

// Maximum items to load at once to prevent hanging on huge folders
const MAX_ITEMS_PER_LOAD = 10000;

export class S3BucketItem extends vscode.TreeItem {
    readonly contextValue = 's3Bucket';

    constructor(public readonly config: BucketConfig) {
        super(config.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = buildBucketDescription(config);
        this.iconPath = new vscode.ThemeIcon('database');
        this.tooltip = buildBucketTooltip(config);
    }
}

function buildBucketDescription(config: BucketConfig): string {
    if (config.prefix) {
        return `${config.region} · prefix: ${config.prefix}`;
    }
    return config.region;
}

function buildBucketTooltip(config: BucketConfig): string {
    let tooltip = `${config.name} (${config.region})`;
    if (config.prefix) {
        tooltip += `\nScoped to prefix: ${config.prefix}`;
    }
    return tooltip;
}

export class S3PrefixItem extends vscode.TreeItem {
    readonly contextValue = 's3Prefix';

    constructor(
        public readonly bucket: string,
        public readonly region: string,
        public readonly prefix: string,
        public readonly bucketConfig?: BucketConfig,
    ) {
        // Label is the last non-empty segment of the prefix
        const label = S3PrefixItem.labelFromPrefix(prefix);
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = prefix;
    }

    private static labelFromPrefix(prefix: string): string {
        // prefix always ends with '/', e.g. "foo/bar/"
        const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        const lastSlash = trimmed.lastIndexOf('/');
        return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
    }
}

export class S3ObjectItem extends vscode.TreeItem {
    readonly contextValue = 's3Object';

    constructor(
        public readonly bucket: string,
        public readonly region: string,
        public readonly key: string,
        public readonly size: number,
        public readonly lastModified: Date,
    ) {
        // Label is the filename (last segment of key)
        const lastSlash = key.lastIndexOf('/');
        const label = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = `${formatSize(size)}  ${lastModified.toLocaleDateString()}`;
        this.iconPath = new vscode.ThemeIcon('file');
        this.tooltip = key;
    }
}

export class S3ErrorItem extends vscode.TreeItem {
    readonly contextValue = 's3Error';

    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('error');
        this.tooltip = message;
    }
}

export class S3LoadMoreItem extends vscode.TreeItem {
    readonly contextValue = 's3LoadMore';

    constructor(
        public readonly bucket: string,
        public readonly region: string,
        public readonly prefix: string,
        public readonly continuationToken: string,
        public readonly itemsLoaded: number,
        public readonly bucketConfig?: BucketConfig,
    ) {
        super('Load more files…', vscode.TreeItemCollapsibleState.None);
        this.description = `${formatSize(itemsLoaded)} loaded so far`;
        this.iconPath = new vscode.ThemeIcon('arrow-down');
        this.tooltip = `Click to load the next batch of files from ${bucket}/${prefix}`;
        this.command = {
            command: 's3-management-tool.loadMore',
            title: 'Load More',
            arguments: [this],
        };
    }
}

// ---------------------------------------------------------------------------
// Size formatter
// ---------------------------------------------------------------------------

export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// ---------------------------------------------------------------------------
// S3TreeProvider
// ---------------------------------------------------------------------------

export class S3TreeProvider implements
    vscode.TreeDataProvider<S3TreeItem>,
    vscode.TreeDragAndDropController<S3TreeItem> {
    readonly dropMimeTypes = ['files', 'text/uri-list', 'application/vnd.code.tree.s3object'];
    readonly dragMimeTypes = ['application/vnd.code.tree.s3object'];

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<S3TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Pagination state: key = "bucket/prefix", value = { continuationToken, itemsLoaded }
    private readonly paginationState = new Map<string, { continuationToken: string | undefined; itemsLoaded: number }>();
    // Accumulated items for prefixes that have been paginated
    private readonly accumulatedItems = new Map<string, { prefixes: string[]; objects: Array<{ key: string; size: number; lastModified: Date }> }>();

    constructor(
        private readonly storage: BucketStorage,
        private readonly s3Service: S3Service,
    ) { }

    /**
     * Fires onDidChangeTreeData for the given item (or the full tree if undefined).
     */
    refresh(item?: S3TreeItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Load more items when the user clicks the "Load More" item.
     * This appends the next batch of items to the existing list.
     */
    async loadMore(item: S3LoadMoreItem): Promise<void> {
        const paginationKey = `${item.bucket}/${item.prefix}`;
        const state = this.paginationState.get(paginationKey);

        if (!state || !state.continuationToken) {
            vscode.window.showInformationMessage('No more items to load.');
            return;
        }

        // Fetch the next batch
        const nextPrefixes: string[] = [];
        const nextObjects: Array<{ key: string; size: number; lastModified: Date }> = [];
        let continuationToken: string | undefined = state.continuationToken;
        let itemsInThisCall = 0;

        do {
            const page = await this.s3Service.listObjects(
                item.bucket,
                item.prefix,
                item.region,
                continuationToken,
                item.bucketConfig,
            );

            const newItems = page.commonPrefixes.length + page.objects.length;
            itemsInThisCall += newItems;
            nextPrefixes.push(...page.commonPrefixes);
            nextObjects.push(...page.objects);
            continuationToken = page.nextContinuationToken;

            if (itemsInThisCall >= MAX_ITEMS_PER_LOAD && continuationToken) {
                break;
            }
        } while (continuationToken);

        // Update state
        state.itemsLoaded += nextPrefixes.length + nextObjects.length;
        state.continuationToken = continuationToken;
        this.paginationState.set(paginationKey, state);

        // Store the accumulated items for this prefix so getChildren can use them
        const accumulatedKey = `accumulated:${paginationKey}`;
        const existing = this.accumulatedItems.get(accumulatedKey) || { prefixes: [], objects: [] };
        existing.prefixes.push(...nextPrefixes);
        existing.objects.push(...nextObjects);
        this.accumulatedItems.set(accumulatedKey, existing);

        // Refresh the tree to show the new items
        this.refresh();
    }

    getTreeItem(element: S3TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: S3TreeItem): Promise<S3TreeItem[]> {
        // Root level — return bucket nodes
        if (!element) {
            const buckets = await this.storage.getBuckets();
            return buckets.map(config => new S3BucketItem(config));
        }

        // Bucket node — list root objects/prefixes
        if (element instanceof S3BucketItem) {
            return this.listChildren(
                element.config.name,
                element.config.region,
                element.config.prefix ?? '',
                element.config,
            );
        }

        // Prefix node — list objects/prefixes under this prefix
        if (element instanceof S3PrefixItem) {
            return this.listChildren(
                element.bucket,
                element.region,
                element.prefix,
                element.bucketConfig,
            );
        }

        // Object node — leaf, no children
        return [];
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async listChildren(
        bucket: string,
        region: string,
        prefix: string,
        bucketConfig?: BucketConfig,
        startToken?: string,
    ): Promise<S3TreeItem[]> {
        const paginationKey = `${bucket}/${prefix}`;
        const accumulatedKey = `accumulated:${paginationKey}`;

        // If starting fresh, reset pagination state
        if (!startToken) {
            this.paginationState.set(paginationKey, { continuationToken: undefined, itemsLoaded: 0 });
            this.accumulatedItems.delete(accumulatedKey);
        }

        const allPrefixes: string[] = [];
        const allObjects: Array<{ key: string; size: number; lastModified: Date }> = [];
        let continuationToken = startToken;
        let itemsInThisCall = 0;

        // Fetch pages until we hit the limit or run out of data
        do {
            const page = await this.s3Service.listObjects(bucket, prefix, region, continuationToken, bucketConfig);

            if ((page as { accessDenied?: boolean }).accessDenied) {
                return [new S3ErrorItem(`Access denied to "${bucket}/${prefix}"`)];
            }

            const newItems = page.commonPrefixes.length + page.objects.length;
            itemsInThisCall += newItems;
            allPrefixes.push(...page.commonPrefixes);
            allObjects.push(...page.objects);

            continuationToken = page.nextContinuationToken;

            // Stop if we've loaded enough items in this call
            if (itemsInThisCall >= MAX_ITEMS_PER_LOAD && continuationToken) {
                break;
            }
        } while (continuationToken);

        // Update pagination state
        const state = this.paginationState.get(paginationKey) || { continuationToken: undefined, itemsLoaded: 0 };
        state.itemsLoaded += allPrefixes.length + allObjects.length;
        state.continuationToken = continuationToken;
        this.paginationState.set(paginationKey, state);

        // Merge with accumulated items if any
        const accumulated = this.accumulatedItems.get(accumulatedKey);
        const finalPrefixes = accumulated ? [...accumulated.prefixes, ...allPrefixes] : allPrefixes;
        const finalObjects = accumulated ? [...accumulated.objects, ...allObjects] : allObjects;

        const prefixItems: S3PrefixItem[] = finalPrefixes.map(
            p => new S3PrefixItem(bucket, region, p, bucketConfig),
        );

        const objectItems: S3ObjectItem[] = finalObjects.map(
            obj => new S3ObjectItem(bucket, region, obj.key, obj.size, obj.lastModified),
        );

        const result: S3TreeItem[] = [...prefixItems, ...objectItems];

        // Add "Load More" item if there are more pages
        if (continuationToken) {
            result.push(new S3LoadMoreItem(bucket, region, prefix, continuationToken, state.itemsLoaded, bucketConfig));
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // TreeDragAndDropController
    // -----------------------------------------------------------------------

    /**
     * Called when dragging starts from this tree. Serializes S3 objects/prefixes
     * so they can be dropped elsewhere in the tree or to the local filesystem.
     */
    handleDrag(
        source: readonly S3TreeItem[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): void | Thenable<void> {
        // Serialize the dragged S3 items as JSON
        const s3Items = source
            .filter(item => item instanceof S3ObjectItem || item instanceof S3PrefixItem)
            .map(item => {
                if (item instanceof S3ObjectItem) {
                    return {
                        type: 'object' as const,
                        bucket: item.bucket,
                        region: item.region,
                        key: item.key,
                        size: item.size,
                    };
                } else {
                    return {
                        type: 'prefix' as const,
                        bucket: item.bucket,
                        region: item.region,
                        prefix: item.prefix,
                    };
                }
            });

        if (s3Items.length > 0) {
            dataTransfer.set(
                'application/vnd.code.tree.s3object',
                new vscode.DataTransferItem(JSON.stringify(s3Items)),
            );
        }
    }

    async handleDrop(
        target: S3TreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        // Check if this is an S3-to-S3 drag operation (dragged from this tree)
        const s3DragItem = dataTransfer.get('application/vnd.code.tree.s3object');

        // If dropped outside any tree item (target is undefined), ignore
        // (VS Code cannot handle drops to external apps like Finder)
        if (!target) {
            return;
        }

        // 1. Resolve target bucket + prefix
        let bucket: string;
        let prefix: string;
        let region: string;

        if (target instanceof S3BucketItem) {
            bucket = target.config.name;
            prefix = target.config.prefix ?? '';
            region = target.config.region;
        } else if (target instanceof S3PrefixItem) {
            bucket = target.bucket;
            prefix = target.prefix;
            region = target.region;
        } else {
            vscode.window.showErrorMessage('Drop target must be a bucket or prefix.');
            return;
        }

        // 2. Check if this is an S3-to-S3 drag operation
        if (s3DragItem) {
            await this.handleS3ToS3Drop(s3DragItem, bucket, prefix, region, target, token);
            return;
        }

        // 3. Handle file upload from local/VS Code explorer
        const fileUris = this.extractFileUris(dataTransfer);
        if (fileUris.length === 0) {
            return;
        }

        await this.handleFileUploadDrop(fileUris, bucket, prefix, region, target, token);
    }

    /**
     * Handles drag-and-drop of S3 objects/prefixes within or between buckets.
     */
    private async handleS3ToS3Drop(
        s3DragItem: vscode.DataTransferItem,
        destBucket: string,
        destPrefix: string,
        destRegion: string,
        target: S3TreeItem,
        token: vscode.CancellationToken,
    ): Promise<void> {
        // Parse the dragged S3 items
        const text = await s3DragItem.asString();
        let draggedItems: Array<{ type: 'object' | 'prefix'; bucket: string; region: string; key?: string; prefix?: string }>;
        try {
            draggedItems = JSON.parse(text);
        } catch {
            vscode.window.showErrorMessage('Failed to parse dragged S3 items.');
            return;
        }

        if (draggedItems.length === 0) {
            return;
        }

        // Ask user whether to copy or move
        const action = await vscode.window.showQuickPick(
            [
                { label: 'Copy', description: 'Copy items to destination' },
                { label: 'Move', description: 'Move items to destination (delete from source)' },
            ],
            { placeHolder: 'Choose action for dragged S3 items' },
        );

        if (!action) {
            return; // User cancelled
        }

        const isMove = action.label === 'Move';

        // Track source buckets for refresh (needed for move operations)
        const sourceBuckets = new Set<string>();
        for (const item of draggedItems) {
            sourceBuckets.add(item.bucket);
        }

        // Process each dragged item
        let processed = 0;
        let errors = 0;
        const errorDetails: string[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `${isMove ? 'Moving' : 'Copying'} ${draggedItems.length} item(s)...`,
                cancellable: true,
            },
            async (progress, innerToken) => {
                for (let i = 0; i < draggedItems.length; i++) {
                    if (token.isCancellationRequested || innerToken.isCancellationRequested) {
                        vscode.window.showWarningMessage(
                            `Operation cancelled. ${processed} item(s) processed.`,
                        );
                        return;
                    }

                    const item = draggedItems[i];
                    progress.report({ message: `[${i + 1}/${draggedItems.length}] ${item.key || item.prefix}` });

                    try {
                        if (item.type === 'object') {
                            // Copy/move single object
                            const srcKey = item.key!;
                            const fileName = srcKey.split('/').pop()!;
                            const destKey = destPrefix ? `${destPrefix}${fileName}` : fileName;

                            await this.s3Service.copyObject(
                                item.bucket,
                                srcKey,
                                destBucket,
                                destKey,
                                item.region,
                                destRegion,
                            );

                            // If move, delete the source
                            if (isMove) {
                                await this.s3Service.deleteObject(item.bucket, srcKey, item.region);
                            }

                            processed++;
                        } else if (item.type === 'prefix') {
                            // Copy/move entire prefix (folder)
                            const srcPrefix = item.prefix!;
                            const folderName = srcPrefix.endsWith('/') ? srcPrefix.slice(0, -1).split('/').pop()! : srcPrefix.split('/').pop()!;
                            const destPrefixForFolder = destPrefix ? `${destPrefix}${folderName}/` : `${folderName}/`;

                            const result = await this.copyPrefix(
                                item.bucket,
                                srcPrefix,
                                destBucket,
                                destPrefixForFolder,
                                item.region,
                                destRegion,
                                isMove,
                                (message) => { progress.report({ message }); },
                                { get isCancellationRequested() { return innerToken.isCancellationRequested || token.isCancellationRequested; } },
                            );

                            processed += result.processed;
                            errors += result.errors;
                            errorDetails.push(...result.errorDetails);
                        }
                    } catch (err) {
                        errors++;
                        const msg = err instanceof Error ? err.message : String(err);
                        errorDetails.push(`${item.key || item.prefix}: ${msg}`);
                    }
                }
            },
        );

        // Summary
        if (processed > 0 || errors > 0) {
            let summary = `${isMove ? 'Moved' : 'Copied'}: ${processed}`;
            if (errors > 0) { summary += ` · Errors: ${errors}`; }

            if (errors > 0) {
                vscode.window.showWarningMessage(summary);
            } else {
                vscode.window.showInformationMessage(summary);
            }
        }

        // Refresh destination tree node
        this.refresh(target);

        // For move operations, also refresh all source buckets so deleted items disappear
        if (isMove) {
            // Refresh the entire tree to ensure source changes are visible
            this.refresh();
        }
    }

    /**
     * Copies (or moves) all objects under a prefix to a destination prefix.
     * Recursively handles nested sub-folders.
     */
    private async copyPrefix(
        srcBucket: string,
        srcPrefix: string,
        destBucket: string,
        destPrefix: string,
        srcRegion: string,
        destRegion: string,
        isMove: boolean,
        onProgress: (message: string) => void,
        cancellation: { readonly isCancellationRequested: boolean },
    ): Promise<{ processed: number; errors: number; errorDetails: string[] }> {
        let processed = 0;
        let errors = 0;
        const errorDetails: string[] = [];

        // Recursively collect ALL object keys under the entire folder tree
        const allKeys: string[] = [];
        await this.collectAllKeys(srcBucket, srcPrefix, srcRegion, allKeys, cancellation);

        // Copy each object
        for (const key of allKeys) {
            if (cancellation.isCancellationRequested) {
                break;
            }

            try {
                const relativeKey = key.startsWith(srcPrefix)
                    ? key.slice(srcPrefix.length)
                    : key;
                const destKey = destPrefix + relativeKey;

                onProgress(`Processing ${key}...`);

                await this.s3Service.copyObject(
                    srcBucket,
                    key,
                    destBucket,
                    destKey,
                    srcRegion,
                    destRegion,
                );

                // Delete source if moving
                if (isMove) {
                    await this.s3Service.deleteObject(srcBucket, key, srcRegion);
                }

                processed++;
            } catch (err) {
                errors++;
                const msg = err instanceof Error ? err.message : String(err);
                errorDetails.push(`${key}: ${msg}`);
            }
        }

        // If moving, also delete the folder placeholder object
        if (isMove) {
            try {
                await this.s3Service.deleteObject(srcBucket, srcPrefix, srcRegion);
            } catch {
                // Folder placeholder may not exist — that's OK
            }
        }

        return { processed, errors, errorDetails };
    }

    /**
     * Recursively collects ALL object keys under a prefix, including objects
     * in nested sub-folders.
     */
    private async collectAllKeys(
        srcBucket: string,
        srcPrefix: string,
        srcRegion: string,
        results: string[],
        cancellation: { readonly isCancellationRequested: boolean },
    ): Promise<void> {
        let continuationToken: string | undefined;

        do {
            if (cancellation.isCancellationRequested) break;

            const page = await this.s3Service.listObjects(
                srcBucket,
                srcPrefix,
                srcRegion,
                continuationToken,
            );

            results.push(...page.objects.map(obj => obj.key));

            for (const subPrefix of page.commonPrefixes) {
                await this.collectAllKeys(srcBucket, subPrefix, srcRegion, results, cancellation);
            }

            continuationToken = page.nextContinuationToken;
        } while (continuationToken);
    }

    /**
     * Handles drag-and-drop of local files to S3.
     */
    private async handleFileUploadDrop(
        fileUris: vscode.Uri[],
        bucket: string,
        prefix: string,
        region: string,
        target: S3TreeItem,
        token: vscode.CancellationToken,
    ): Promise<void> {
        // 3. Process each dropped item
        let uploaded = 0;
        let skipped = 0;
        let errors = 0;
        const errorDetails: string[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Uploading ${fileUris.length} item(s) to s3://${bucket}/${prefix || '(root)'}…`,
                cancellable: true,
            },
            async (progress, innerToken) => {
                for (let i = 0; i < fileUris.length; i++) {
                    if (token.isCancellationRequested || innerToken.isCancellationRequested) {
                        vscode.window.showWarningMessage(
                            `Upload cancelled. ${uploaded} file(s) uploaded.`,
                        );
                        return;
                    }

                    const uri = fileUris[i];
                    progress.report({ message: `[${i + 1}/${fileUris.length}] ${uri.fsPath}` });

                    try {
                        const stat = await fs.promises.stat(uri.fsPath);
                        if (stat.isFile()) {
                            const destKey = prefix ? `${prefix}${uri.fsPath.split('/').pop()!}` : uri.fsPath.split('/').pop()!;
                            await uploadSingleFile(uri.fsPath, bucket, destKey, region, this.s3Service);
                            uploaded++;
                        } else if (stat.isDirectory()) {
                            const folderName = uri.fsPath.split('/').pop()!;
                            const destPrefixForDir = prefix ? `${prefix}${folderName}/` : `${folderName}/`;
                            const result = await uploadDirectory(
                                uri.fsPath,
                                bucket,
                                destPrefixForDir,
                                region,
                                this.s3Service,
                                (message) => { progress.report({ message }); },
                                { get isCancellationRequested() { return innerToken.isCancellationRequested || token.isCancellationRequested; } },
                            );
                            uploaded += result.uploaded;
                            skipped += result.skipped;
                            errors += result.errors;
                            errorDetails.push(...result.errorDetails);
                        }
                    } catch (err) {
                        errors++;
                        const msg = err instanceof Error ? err.message : String(err);
                        errorDetails.push(`${uri.fsPath}: ${msg}`);
                    }
                }
            },
        );

        // 4. Summary
        if (uploaded > 0 || skipped > 0 || errors > 0) {
            let summary = `Uploaded: ${uploaded}`;
            if (skipped > 0) { summary += ` · Skipped: ${skipped}`; }
            if (errors > 0) { summary += ` · Errors: ${errors}`; }

            if (errors > 0) {
                vscode.window.showWarningMessage(summary);
            } else {
                vscode.window.showInformationMessage(summary);
            }
        }

        // 5. Refresh the tree node where items were dropped
        if (target instanceof S3BucketItem || target instanceof S3PrefixItem) {
            this.refresh(target);
        }
    }

    /**
     * Extracts file URIs from a DataTransfer, handling both 'files' and
     * 'text/uri-list' MIME types.
     */
    private extractFileUris(dataTransfer: vscode.DataTransfer): vscode.Uri[] {
        const uris: vscode.Uri[] = [];

        // Try 'files' MIME type (drag from OS file explorer or VS Code explorer)
        // When you drag files, VS Code provides them under the 'files' mime type
        const filesItem = dataTransfer.get('files');
        if (filesItem) {
            // The value should be an array of DataTransferFile objects
            const files = filesItem.value as Array<{ uri?: vscode.Uri }>;
            if (Array.isArray(files)) {
                for (const file of files) {
                    if (file.uri) {
                        uris.push(file.uri);
                    }
                }
            }
        }

        // Also try 'text/uri-list' (drag from VS Code explorer)
        const uriListItem = dataTransfer.get('text/uri-list');
        if (uriListItem) {
            const text = uriListItem.value as string;
            if (typeof text === 'string') {
                for (const line of text.split(/\r?\n/).filter(Boolean)) {
                    try {
                        uris.push(vscode.Uri.parse(line));
                    } catch {
                        // skip unparseable URIs
                    }
                }
            }
        }

        return uris;
    }
}
