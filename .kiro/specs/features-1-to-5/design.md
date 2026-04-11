# Design — Features #1 to #5

> **Date:** 2026-04-04  
> **Scope:** Technical design for Create Folder, Copy S3 URI, Bucket Info, Text File Preview, Recursive Folder Download

---

## Architecture Overview

All five features follow the existing extension patterns:
- **Command files** in `src/commands/` — each exported as an `async function`
- **Registration** in `extension-standalone.ts` → `registerCommands()`
- **Menu contributions** in `package.json` → `contributes.menus.view/item/context`
- **Context values** on tree items (`s3Bucket`, `s3Prefix`, `s3Object`) determine menu visibility

No new services are needed. All features use existing `S3Service` methods or add thin wrappers.

---

## Feature #1: Create Folder

### Technical Approach

S3 has no native folder concept. A "folder" is a **zero-byte object** whose key ends with `/`.
When `ListObjectsV2` is called with `Delimiter: '/'`, S3 returns these zero-byte objects as common prefixes, making them appear as folders in the UI.

### Component: `src/commands/create-folder.ts` (new)

**Flow:**
1. Extract bucket, region, basePrefix from the context item (`S3BucketItem` or `S3PrefixItem`).
2. Show input box for folder name → validate non-empty.
3. Normalise: ensure folder name ends with `/`.
4. Compute full key: `basePrefix + folderName` (if basePrefix exists).
5. Call `s3Service.putObject(bucket, folderKey, Buffer.from(''), region)` — zero-byte body.
6. Show success notification.
7. Call `treeProvider.refresh(context)` to refresh the parent node.

### Dependencies
- `S3Service.putObject()` — already exists, accepts `Buffer` body.
- No new SDK imports needed.

### Edge Cases
- Folder already exists: `putObject` silently overwrites (same as S3 console behavior).
- No bucket context: show error, do nothing.
- Input cancelled: return early.

---

## Feature #2: Copy S3 URI

### Technical Approach

Trivial utility — construct `s3://bucket/key` string and write to clipboard.

### Component: `src/commands/copy-s3-uri.ts` (new)

**Flow:**
1. Accept `S3ObjectItem` or `S3PrefixItem`.
2. Construct URI:
   - Object: `s3://${item.bucket}/${item.key}`
   - Prefix: `s3://${item.bucket}/${item.prefix}`
3. Call `vscode.env.clipboard.writeText(uri)`.
4. Show info notification: `Copied to clipboard: s3://...`

### Dependencies
- VS Code `env.clipboard` API — built-in, no AWS dependencies.

---

## Feature #3: Bucket Info Display

### Technical Approach

All backend methods already exist in `S3Service`. Just need a command + webview.

### Component: `src/commands/bucket-info.ts` (new)

**Flow:**
1. Accept `S3BucketItem`.
2. Fetch in parallel:
   - `s3Service.getBucketVersioning(bucket)` → versioning status
   - `s3Service.getBucketPolicy(bucket)` → policy JSON or null
3. Read from `BucketConfig` (already available on the item):
   - name, region, prefix, creation date (not stored — need to fetch via `tryListBuckets`)
4. Open a webview panel with formatted info.

### Data Source Mapping

| Field | Source |
|-------|--------|
| Bucket name | `item.config.name` |
| Region | `item.config.region` |
| Creation date | Try `tryListBuckets()` match by name, else "—" |
| Versioning status | `getBucketVersioning()` |
| Bucket policy | `getBucketPolicy()` |
| Configured prefix | `item.config.prefix ?? '—'` |
| Added manually | `item.config.addedManually ? 'Yes' : 'No'` |

### Webview Design
- Simple HTML table (same pattern as `view-metadata.ts`).
- Policy section: formatted JSON in a `<pre>` block with `overflow: auto`.
- CSP: `default-src 'none'; style-src 'unsafe-inline'`.
- No scripts needed — static HTML.

### Error Handling
- Versioning access denied → show "Unknown (access denied)".
- Policy access denied → show "— Access denied —".
- Both errors caught individually; one failure doesn't block the other.

---

## Feature #4: Text File Preview

### Technical Approach

Open content in a **read-only VS Code text document** using `vscode.workspace.openTextDocument` with an untitled URI. This gives syntax highlighting, word wrap, and a native editor experience.

### Component: `src/commands/preview-object.ts` (new)

**Flow:**
1. Accept `S3ObjectItem`.
2. Fetch object metadata via `s3Service.headObject()` to get size and content type.
3. **Size check**: if size > 50 KB → reject with message showing actual size.
4. **Content type check**: determine if previewable.
   - By extension: check against a whitelist of text extensions.
   - By MIME type: check if ContentType starts with `text/`, `application/json`, `application/xml`, `application/x-yaml`.
   - If neither matches → show info message suggesting download.
5. Fetch content via `s3Service.getObject()` → read stream into string (capped at 50 KB).
6. Create untitled text document:
   ```ts
   const doc = await vscode.workspace.openTextDocument({
       content: previewHeader + content,
       language: detectLanguage(item.key),
   });
   await vscode.window.showTextDocument(doc, { preview: false });
   ```
7. Preview header: a comment line at the top indicating this is an S3 preview.

### Language Detection

Map file extensions to VS Code language IDs:

| Extension | Language |
|-----------|----------|
| `.json` | `json` |
| `.yaml`, `.yml` | `yaml` |
| `.xml` | `xml` |
| `.js` | `javascript` |
| `.ts` | `typescript` |
| `.py` | `python` |
| `.sh` | `shellscript` |
| `.html` | `html` |
| `.css` | `css` |
| `.md` | `markdown` |
| `.csv` | `csv` |
| `.txt`, `.log` | `plaintext` |
| `.ini`, `.cfg`, `.conf`, `.toml`, `.env` | `properties` |
| Default | `plaintext` |

### Content Reading

The `getObject()` returns a `ReadableStream`. We'll collect bytes into a string:

```ts
const chunks: Buffer[] = [];
let totalBytes = 0;
const MAX_BYTES = 50 * 1024; // 50 KB

for await (const chunk of readStream) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BYTES) {
        // truncate
        break;
    }
    chunks.push(chunk);
}
const content = Buffer.concat(chunks).toString('utf-8');
```

### Dependencies
- `S3Service.getObject()` — already exists.
- `S3Service.headObject()` — already exists.
- No new SDK imports needed.

---

## Feature #5: Recursive Folder Download

### Technical Approach

Iterate all objects under a prefix using **paginated `ListObjectsV2`**, then download each one to the corresponding local path.

### Component: `src/commands/download-folder.ts` (new)

**Flow:**
1. Accept `S3PrefixItem`.
2. Prompt user for destination directory via `vscode.window.showOpenDialog({ canSelectFolders: true, openLabel: 'Select' })`.
3. Compute local base path: `destinationDir + prefix`.
4. **Paginate** through all objects:
   - Call `s3Service.listObjects(bucket, prefix, region, continuationToken)`.
   - Collect all objects (follow `isTruncated` + `nextContinuationToken`).
5. For each object:
   - Derive local path: strip prefix from key → append to destination dir.
   - Create parent directories: `fs.mkdirSync(parentDir, { recursive: true })`.
   - Download: `s3Service.getObject()` → pipe to `fs.createWriteStream`.
   - Report progress: `progress.report({ message: 'Downloading 3 of 15: path/to/file.txt' })`.
6. Track stats: total files, total bytes, error count.
7. Show summary notification.

### Progress Reporting

```ts
await vscode.window.withProgress(
    {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${prefix} from ${bucket}…`,
        cancellable: true,
    },
    async (progress, token) => {
        // download loop
    }
);
```

### Pagination Logic

```ts
let token: string | undefined;
const allObjects: ObjectSummary[] = [];
do {
    const page = await s3Service.listObjects(bucket, prefix, region, token);
    allObjects.push(...page.objects);
    token = page.nextContinuationToken;
} while (page.isTruncated);
```

### Error Handling
- Individual file download failure → log error, increment error counter, continue.
- Directory creation failure → log error, skip remaining files in that sub-tree.
- Token cancellation → stop downloading, show partial summary.

### Dependencies
- `S3Service.listObjects()` — already exists with pagination support.
- `S3Service.getObject()` — already exists.
- No new SDK imports needed.

---

## package.json Changes

### New Commands
```json
{ "command": "s3-management-tool.createFolder", "title": "Create Folder", "icon": "$(new-folder)" },
{ "command": "s3-management-tool.copyS3Uri", "title": "Copy S3 URI", "icon": "$(clippy)" },
{ "command": "s3-management-tool.bucketInfo", "title": "Bucket Info", "icon": "$(info)" },
{ "command": "s3-management-tool.previewObject", "title": "Preview Content", "icon": "$(preview)" },
{ "command": "s3-management-tool.downloadFolder", "title": "Download Folder", "icon": "$(cloud-download)" }
```

### New Menu Entries

| Command | When | Group |
|---------|------|-------|
| `createFolder` | `viewItem == s3Bucket \|\| viewItem == s3Prefix` | `1_object@0` |
| `copyS3Uri` | `viewItem == s3Object \|\| viewItem == s3Prefix` | `1_object@0` |
| `bucketInfo` | `viewItem == s3Bucket` | `bucket@1` |
| `previewObject` | `viewItem == s3Object` | `1_object@1` |
| `downloadFolder` | `viewItem == s3Prefix` | `1_object@2` |

---

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `src/commands/create-folder.ts` | Create folder command |
| `src/commands/copy-s3-uri.ts` | Copy S3 URI command |
| `src/commands/bucket-info.ts` | Bucket info webview command |
| `src/commands/preview-object.ts` | Text file preview command |
| `src/commands/download-folder.ts` | Recursive folder download command |

### Modified Files
| File | Changes |
|------|---------|
| `src/extension-standalone.ts` | Register 5 new commands |
| `package.json` | Add 5 commands + 5 menu entries |

### Unchanged Files
All existing services, models, tree provider, and other commands remain untouched.
