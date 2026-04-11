# Design: Versioned Buckets, Recursive Upload, Drag & Drop

> **Date:** 2026-04-04
> **Features:** #6 Versioned Bucket Support, #7 Recursive Folder Upload, #8 Drag & Drop Upload

---

## 1. Architecture Overview

All three features share a common pattern:

| Layer | Responsibility |
|-------|----------------|
| **S3Service** | AWS SDK calls (new methods + new SDK command imports) |
| **Command handler** | VS Code UI interaction (dialogs, progress, notifications) |
| **Tree provider / items** | Visual indicators and context menu entries |
| **Webview panel** | Rich UI for version listing (Feature #6 only) |

No new dependencies are needed — all required AWS SDK commands are available in the already-installed `@aws-sdk/client-s3` package.

---

## 2. Feature #6 — Versioned Bucket Support

### 2.1 S3Service Extensions

Three new methods are added to `S3Service`:

```typescript
interface ObjectVersion {
    versionId: string;
    isLatest: boolean;
    size: number;
    lastModified: Date;
    etag: string;
    storageClass?: string;
    deleteMarker: boolean;
}

class S3Service {
    /**
     * List all versions of a specific object key.
     * Uses ListObjectVersionsCommand with KeyMarker filtering.
     */
    async listObjectVersions(
        bucket: string,
        key: string,
        region: string,
    ): Promise<ObjectVersion[]>

    /**
     * Restore a previous version by copying it to the current key.
     * Uses CopyObjectCommand with VersionId in the copy source.
     */
    async restoreVersion(
        bucket: string,
        key: string,
        versionId: string,
        region: string,
    ): Promise<void>

    /**
     * Delete a specific version of an object.
     * Uses DeleteObjectCommand with VersionId parameter.
     */
    async deleteVersion(
        bucket: string,
        key: string,
        versionId: string,
        region: string,
    ): Promise<void>

    /**
     * Get a specific version of an object as a stream.
     * Wraps existing getObject() with VersionId parameter.
     */
    async getObjectVersion(
        bucket: string,
        key: string,
        versionId: string,
        region: string,
    ): Promise<NodeJS.ReadableStream>
}
```

#### SDK Commands Needed

```typescript
// New imports to add to existing imports:
import {
    ListObjectVersionsCommand,
    // CopyObjectCommand — already imported
    // DeleteObjectCommand — already imported
    // GetObjectCommand — already imported (reuse with VersionId)
} from '@aws-sdk/client-s3';
```

#### `listObjectVersions` Implementation

```typescript
async listObjectVersions(bucket, key, region): Promise<ObjectVersion[]> {
    const client = this.clientFactory.getClient(region);
    const allVersions: ObjectVersion[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    do {
        const resp = await withRetry(() =>
            client.send(new ListObjectVersionsCommand({
                Bucket: bucket,
                Prefix: key,
                KeyMarker: keyMarker,
                VersionIdMarker: versionIdMarker,
            }))
        );

        for (const v of resp.Versions ?? []) {
            if (v.Key !== key) continue; // filter to exact key match
            allVersions.push({
                versionId: v.VersionId ?? 'null',
                isLatest: v.IsLatest ?? false,
                size: v.Size ?? 0,
                lastModified: v.LastModified ?? new Date(),
                etag: v.ETag ?? '',
                storageClass: v.StorageClass,
                deleteMarker: false,
            });
        }

        // Also check DeleteMarkers
        for (const m of resp.DeleteMarkers ?? []) {
            if (m.Key !== key) continue;
            allVersions.push({
                versionId: m.VersionId ?? 'null',
                isLatest: m.IsLatest ?? false,
                size: 0,
                lastModified: m.LastModified ?? new Date(),
                etag: '',
                deleteMarker: true,
            });
        }

        keyMarker = resp.NextKeyMarker;
        versionIdMarker = resp.NextVersionIdMarker;
    } while (keyMarker);

    // Sort by lastModified descending
    return allVersions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
```

#### `restoreVersion` Implementation

```typescript
async restoreVersion(bucket, key, versionId, region): Promise<void> {
    const client = this.clientFactory.getClient(region);
    await withRetry(() =>
        client.send(new CopyObjectCommand({
            Bucket: bucket,
            Key: key,
            CopySource: `/${bucket}/${key}?versionId=${versionId}`,
        }))
    );
}
```

#### `deleteVersion` Implementation

```typescript
async deleteVersion(bucket, key, versionId, region): Promise<void> {
    const client = this.clientFactory.getClient(region);
    await withRetry(() =>
        client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
            VersionId: versionId,
        }))
    );
}
```

#### `getObjectVersion` Implementation

Reuses the existing `getObject()` method by adding `VersionId` to the command input. Option A: overload the existing method. Option B: create a separate method.

**Decision:** Overload `getObject` with an optional `versionId` parameter to avoid duplication:

```typescript
async getObject(
    bucket: string,
    key: string,
    region: string,
    versionId?: string,   // new optional parameter
): Promise<NodeJS.ReadableStream>
```

### 2.2 Tree View Changes

#### S3BucketItem — Versioning Badge

Modify `buildBucketDescription()` in `s3-tree-provider.ts` to accept and display versioning status:

```typescript
function buildBucketDescription(
    config: BucketConfig,
    versioningStatus?: VersioningStatus,
): string {
    let desc = config.region;
    if (config.prefix) {
        desc += ` · prefix: ${config.prefix}`;
    }
    if (versioningStatus === 'Enabled') {
        desc += ' · 🔒 versioned';
    }
    return desc;
}
```

**How versioning status reaches the tree item:**

The tree provider's `getChildren()` method, when returning bucket children, will first call `getBucketVersioning()` for each bucket. To avoid N+1 API calls on every refresh, we cache versioning status per bucket using a `Map<string, VersioningStatus>` with a TTL of 5 minutes.

**Simpler alternative (chosen):** Pass versioning status only when the user clicks "View Versions." The bucket item itself does not show a versioning badge. Instead, the "View Versions" command first checks `getBucketVersioning()` and refuses to open if versioning is not `Enabled`. This avoids extra API calls during tree rendering.

#### S3ObjectItem — No Visual Change

No additional badge on the object itself. The versioning indicator is the context menu entry.

### 2.3 Command: View Versions

```typescript
// Command ID: s3-management-tool.viewVersions
// Registered in extension-standalone.ts

async function viewVersions(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void>
```

**Flow:**
1. Check `s3Service.getBucketVersioning(item.bucket)` → if not `'Enabled'`, show error and return.
2. Call `s3Service.listObjectVersions(bucket, key, region)`.
3. Open a webview panel with the results.

### 2.4 Webview Panel: Versions List

**Panel ID:** `s3ObjectVersions`

**HTML Structure:**
```
┌──────────────────────────────────────────────┐
│  Versions: logs/app.log                      │
├──────────────────────────────────────────────┤
│  ID          Size    Modified     Actions     │
│  ┌───────────────────────────────────────┐   │
│  │ ● Latest  12 KB  2024-01-03  Restore   │   │
│  │ a1b2c...  11 KB  2024-01-02  Restore   │   │
│  │ d4e5f...  10 KB  2024-01-01  Restore   │   │
│  └───────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**Webview communication:**
- The webview sends messages to the extension via `vscode.postMessage()`.
- The extension handles: `restore`, `delete`, `download`.
- After each action, the webview refreshes the version list.

**Message types (extension ← webview):**
```typescript
interface VersionsMessage {
    command: 'restore' | 'delete' | 'download' | 'refresh';
    versionId: string;
    bucket: string;
    key: string;
    region: string;
}
```

**Message types (extension → webview):**
```typescript
interface VersionsUpdate {
    command: 'updateVersions' | 'error' | 'actionSuccess' | 'actionError';
    versions?: ObjectVersion[];
    message?: string;
}
```

### 2.5 Commands: Restore, Delete, Download Version

These are triggered from the webview buttons, not registered as separate VS Code commands. The extension's message handler performs the action and sends back the result.

**Restore:**
```typescript
await s3Service.restoreVersion(bucket, key, versionId, region);
await s3Service.listObjectVersions(bucket, key, region); // refresh
webview.html = buildVersionsHtml(versions);
vscode.window.showInformationMessage(`Restored version ${versionId.slice(0, 8)} of ${key}`);
```

**Delete:**
```typescript
const confirm = await vscode.window.showWarningMessage(
    `Delete version ${versionId.slice(0, 8)} of ${key}? This cannot be undone.`,
    { modal: true },
    'Delete',
);
if (!confirm) return;
await s3Service.deleteVersion(bucket, key, versionId, region);
// refresh panel
```

**Download:**
```typescript
const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(key.split('/').pop()!),
});
if (!uri) return;
const stream = await s3Service.getObject(bucket, key, region, versionId);
// pipe to local file
```

---

## 3. Feature #7 — Recursive Folder Upload

### 3.1 Modified Command: Upload Object

**File:** `src/commands/upload-object.ts`

**Changes:**
- Change `canSelectFolders` from `false` to `true`.
- After user selection, for each selected URI:
  - If it's a file → upload as before.
  - If it's a folder → walk recursively, upload each file.

### 3.2 Recursive File Walker

```typescript
interface LocalFile {
    absolutePath: string;
    relativePath: string;  // relative to the selected folder root
}

function walkDirectory(dir: string, root: string): LocalFile[] {
    const results: LocalFile[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDirectory(abs, root));
        } else if (entry.isFile()) {
            results.push({
                absolutePath: abs,
                relativePath: path.relative(root, abs),
            });
        }
    }
    return results;
}
```

This pattern already exists in `sync-service.ts` — we extract it into a shared utility module.

**Decision:** Extract `walkDirectory` from `sync-service.ts` into a new `src/utils/fs-utils.ts` module so both sync and upload commands can reuse it.

### 3.3 Change Detection (ETag Comparison)

```typescript
async function isFileChanged(
    localPath: string,
    remoteEtag: string | undefined,
): Promise<boolean> {
    if (!remoteEtag) return true;  // no remote → upload
    const localMd5 = await computeLocalMd5(localPath);  // from sync-service
    return localMd5 !== normalizeEtag(remoteEtag);
}
```

Both `computeLocalMd5` and `normalizeEtag` already exist in `sync-service.ts`. After extracting `walkDirectory` to `fs-utils.ts`, also move these helpers there.

### 3.4 Upload Flow

```
1. User selects files/folders via showOpenDialog
2. For each selection:
   a. If file → add to upload queue
   b. If folder → walkDirectory → add all files to queue
3. Build upload plan: { localPath, s3Key }[]
4. For each planned file:
   a. Check isFileChanged() → skip if unchanged
   b. Upload (putObject or putObjectMultipart)
   c. Report progress
5. Show summary notification
```

**Progress reporting:**
```
Uploading 23/150 files — build/app.js (45%)
```

### 3.5 Upload Result Interface

```typescript
interface UploadResult {
    uploaded: number;
    skipped: number;
    errors: number;
    totalBytes: number;
}
```

---

## 4. Feature #8 — Drag & Drop Upload

### 4.1 TreeDragAndDropController Implementation

`S3TreeProvider` extends to implement both `TreeDataProvider` and `TreeDragAndDropController`:

```typescript
class S3TreeProvider implements
    vscode.TreeDataProvider<S3TreeItem>,
    vscode.TreeDragAndDropController<S3TreeItem>
{
    readonly dropMimeTypes = ['files', 'text/uri-list'];
    readonly dragMimeTypes = [];  // not implementing drag-out yet

    async handleDrop(
        dataTransfer: vscode.DataTransfer,
        target: S3TreeItem | undefined,
        token: vscode.CancellationToken,
    ): Promise<void>
}
```

### 4.2 Drop Handler Flow

```typescript
async handleDrop(dataTransfer, target, token): Promise<void> {
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
        vscode.window.showErrorMessage('Drop target must be a bucket or prefix');
        return;
    }

    // 2. Extract file URIs from dataTransfer
    const fileUris: vscode.Uri[] = [];

    // Try 'files' mime type first
    const filesItem = dataTransfer.get('files');
    if (filesItem) {
        for (const file of filesItem.value as DataTransferFile[]) {
            if (file.uri) fileUris.push(file.uri);
        }
    }

    // Also try 'text/uri-list' for VS Code explorer drags
    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem) {
        const uris = (uriListItem.value as string)
            .split('\r\n')
            .filter(Boolean)
            .map(u => vscode.Uri.parse(u));
        fileUris.push(...uris);
    }

    // 3. Process each file/folder
    for (const uri of fileUris) {
        if (token.isCancellationRequested) break;
        const stat = await fs.stat(uri.fsPath);
        if (stat.isFile()) {
            await uploadSingleFile(uri.fsPath, bucket, prefix, region, s3Service);
        } else if (stat.isDirectory()) {
            await uploadDirectory(uri.fsPath, bucket, prefix, region, s3Service);
        }
    }
}
```

### 4.3 Reusing Upload Logic

The drag-and-drop handler reuses the same upload functions from Feature #7. No duplication:

```
upload-directory.ts (Feature #7)
    ├── walkDirectory()        → fs-utils.ts
    ├── uploadFileWithCheck()  → shared upload logic
    └── UploadResult type

Drag & Drop (Feature #8)
    └── handleDrop()
        └── calls same uploadFileWithCheck() and uploadDirectory()
```

### 4.4 VS Code API Notes

**`DataTransferFile`** — In VS Code's tree drop API, the `files` mime type provides `DataTransferFile` objects which have a `.uri` property. The actual file content can be read via `fs.readFile(uri.fsPath)`.

**`text/uri-list`** — When dragging from VS Code's own explorer, the URIs come as `text/uri-list` strings (one URI per line). These are parsed with `vscode.Uri.parse()`.

**Important:** `dragMimeTypes = []` means items cannot be dragged *out* of the S3 tree (that's Feature #10). Only drag *in* is supported via `dropMimeTypes`.

---

## 5. File Map

### New Files

| File | Feature(s) | Purpose |
|------|------------|---------|
| `src/utils/fs-utils.ts` | #6, #7 | Shared file system utilities (walkDirectory, computeMd5, normalizeEtag) |
| `src/utils/upload-helpers.ts` | #7, #8 | Shared upload logic (uploadDirectory, uploadFileWithCheck) |
| `src/webviews/versions-panel.ts` | #6 | Webview HTML builder for version listing |

### Modified Files

| File | Feature(s) | Changes |
|------|------------|---------|
| `src/services/s3-service.ts` | #6 | Add `listObjectVersions`, `restoreVersion`, `deleteVersion`; overload `getObject` with `versionId` |
| `src/services/sync-service.ts` | #7 | Move `walkDirectory`, `computeLocalMd5`, `normalizeEtag` to `fs-utils.ts`; re-export from there |
| `src/commands/upload-object.ts` | #7 | Enable `canSelectFolders: true`; call `uploadDirectory` for folders |
| `src/views/s3-tree-provider.ts` | #8 | Implement `TreeDragAndDropController` interface |
| `src/extension-standalone.ts` | #6, #8 | Register `viewVersions` command; no new registration needed for drag-drop (it's on the provider) |
| `package.json` | #6 | Add `viewVersions` command to contributes.commands and contributes.menus |

---

## 6. Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| `listObjectVersions` on non-versioned bucket | Guard in command — don't call S3 API |
| `restoreVersion` fails (e.g., permission denied) | Show error notification, don't refresh panel |
| `deleteVersion` — user cancels confirmation | Return early, no S3 call |
| Folder upload — some files fail | Continue with remaining files, report error count |
| Drag-drop — non-S3 target | `handleDrop` checks target type, shows error |
| Drag-drop — empty drop | No-op, no notification |

---

## 7. Testing Strategy

### Unit Tests

| Test Target | What to Test |
|-------------|-------------|
| `S3Service.listObjectVersions` | Mock `ListObjectVersionsCommand` — pagination, filtering by key, sorting |
| `S3Service.restoreVersion` | Mock `CopyObjectCommand` — correct CopySource format |
| `S3Service.deleteVersion` | Mock `DeleteObjectCommand` — VersionId passed correctly |
| `S3Service.getObject` with versionId | Mock `GetObjectCommand` — VersionId parameter |
| `walkDirectory` | Mock filesystem — nested dirs, mixed files/dirs, empty dirs |
| `uploadFileWithCheck` | Skip logic when ETag matches, upload when different |
| `handleDrop` URI extraction | Mock `DataTransfer` — files, text/uri-list, mixed |

### Integration Tests

| Test | Description |
|------|-------------|
| Upload folder → listObjects → verify all keys | End-to-end folder upload with localstack |
| Restore version → headObject → verify ETag changed | Version restore round-trip |

---

## 8. Design Decisions & Rationale

### D1: Cache versioning status or check on demand?

**Decision:** Check on demand (when user clicks "View Versions"). Avoids N+1 API calls during tree rendering. Trade-off: slight delay when opening the versions panel.

### D2: Single webview panel or new command per action?

**Decision:** Single webview panel with message-based actions. Simpler than registering 3 more commands. The webview communicates back to the extension via `postMessage`.

### D3: Extract shared utilities or duplicate code?

**Decision:** Extract to `fs-utils.ts` and `upload-helpers.ts`. Both sync and upload commands need `walkDirectory` and `computeMd5`. Drag-drop needs the same upload logic. Single source of truth.

### D4: Overload `getObject` or create separate `getObjectVersion`?

**Decision:** Overload `getObject` with optional `versionId`. Only one additional parameter, and the SDK's `GetObjectCommandInput` already supports both. Less code duplication.

### D5: Show versioning badge on bucket items?

**Decision:** Defer to future. Would require fetching versioning status for every bucket on tree load, which is expensive. For now, "View Versions" command checks on demand and shows an error if versioning is not enabled.
