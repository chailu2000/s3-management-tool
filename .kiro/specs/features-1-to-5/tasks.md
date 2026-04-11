# Tasks — Features #1 to #5

> **Date:** 2026-04-04  
> **Scope:** Implement Create Folder, Copy S3 URI, Bucket Info, Text File Preview, Recursive Folder Download

---

## Task 1: Create Folder Command

**File:** `src/commands/create-folder.ts` (new)
- [x] 1.1 Create command function accepting `S3BucketItem | S3PrefixItem`
- [x] 1.2 Show input box for folder name with validation
- [x] 1.3 Normalise folder name (ensure trailing `/`)
- [x] 1.4 Compute full key respecting configured prefix scope
- [x] 1.5 Call `s3Service.putObject(bucket, folderKey, Buffer.from(''), region)`
- [x] 1.6 Show success/error notification
- [x] 1.7 Refresh parent tree node
- [x] 1.8 Register command in `extension-standalone.ts`

**Status: DONE** — File already created.

---

## Task 2: Copy S3 URI Command

**File:** `src/commands/copy-s3-uri.ts` (new)
- [x] 2.1 Create command function accepting `S3ObjectItem | S3PrefixItem`
- [x] 2.2 Construct `s3://bucket/key` URI string
- [x] 2.3 Write to clipboard via `vscode.env.clipboard.writeText()`
- [x] 2.4 Show confirmation notification
- [x] 2.5 Register command in `extension-standalone.ts`

**Status: DONE** — File already created.

---

## Task 3: Bucket Info Command

**File:** `src/commands/bucket-info.ts` (new)
- [x] 3.1 Create command function accepting `S3BucketItem`
- [x] 3.2 Fetch versioning status via `s3Service.getBucketVersioning()`
- [x] 3.3 Fetch policy via `s3Service.getBucketPolicy()`
- [x] 3.4 Build webview HTML with all fields (name, region, versioning badge, policy, prefix, addedManually)
- [x] 3.5 Open webview panel with `vscode.window.createWebviewPanel()`
- [x] 3.6 Handle errors gracefully (Promise.allSettled — access denied → "Unknown"/"— No policy or access denied —")
- [x] 3.7 Register command in `extension-standalone.ts`

**Status: DONE**

---

## Task 4: Text File Preview Command

**File:** `src/commands/preview-object.ts` (new)
- [x] 4.1 Create command function accepting `S3ObjectItem`
- [x] 4.2 Fetch metadata via `s3Service.headObject()` for size + content type
- [x] 4.3 Size guard: reject if > 50 KB with message showing actual size
- [x] 4.4 Previewability check: extension whitelist (30+ extensions) OR content type MIME check (6 prefixes)
- [x] 4.5 If not previewable → show info message suggesting download
- [x] 4.6 Fetch content via `s3Service.getObject()` → async iterable stream (capped at 50 KB)
- [x] 4.7 Detect language from file extension (20+ mappings including terraform, graphql, proto3)
- [x] 4.8 Open read-only text document via `vscode.workspace.openTextDocument()` + `showTextDocument()`
- [x] 4.9 Add preview header comment with S3 URI (language-aware comment delimiter)
- [x] 4.10 Register command in `extension-standalone.ts`

**Status: DONE**

---

## Task 5: Recursive Folder Download Command

**File:** `src/commands/download-folder.ts` (new)
- [x] 5.1 Create command function accepting `S3PrefixItem`
- [x] 5.2 Prompt for destination directory via `showOpenDialog({ canSelectFolders: true })`
- [x] 5.3 Paginate all objects under prefix using `listObjects()` loop with continuation token
- [x] 5.4 Open progress notification with `[N/M] key` per-file progress
- [x] 5.5 For each object: create local dirs (`mkdirSync recursive`), download stream to file
- [x] 5.6 Per-file error handling: console.error + increment counter + continue
- [x] 5.7 Track stats: downloaded count, total bytes, error count
- [x] 5.8 Show summary notification (with error count if any failures)
- [x] 5.9 Support cancellation via `token.isCancellationRequested` check per-file
- [x] 5.10 Register command in `extension-standalone.ts`

**Status: DONE**

---

## Task 6: package.json Updates

**File:** `package.json` (modify)
- [x] 6.1 Add 5 new command definitions to `contributes.commands` (with icons)
- [x] 6.2 Add "Create Folder" menu entry for `s3Bucket` and `s3Prefix` context
- [x] 6.3 Add "Copy S3 URI" menu entry for `s3Object` and `s3Prefix` context
- [x] 6.4 Add "Bucket Info" menu entry for `s3Bucket` context
- [x] 6.5 Add "Preview Content" menu entry for `s3Object` context
- [x] 6.6 Add "Download Folder" menu entry for `s3Prefix` context

**Status: DONE**

---

## Task 7: Compile & Verify

- [x] 7.1 Run `pnpm run compile` — 0 TypeScript errors
- [x] 7.2 Run `pnpm test` — 186 passed, 0 failures (all existing tests pass, 1 new test added)
- [x] 7.3 Review all new files for correctness

---

## Task 8: Bugfixes — Download Folder & Prefix Display

### 8.1 Download Folder includes prefix folder name in destination

**Issue:** When downloading prefix `team-data/logs/`, files went directly into `destDir/` instead of `destDir/logs/`.

**Fix:** `src/commands/download-folder.ts` — compute `displayPrefix` (portion after configured prefix), prepend it to local destination path via `path.join(destDir, displayPrefix)`.

- [x] 8.1.1 Compute `localRoot = path.join(destDir, displayPrefix)`
- [x] 8.1.2 Pass `localRoot` instead of `destDir` to `downloadSingleObject()`
- [x] 8.1.3 Update summary notification to show `localRoot`

### 8.2 Show prefix scope on bucket node in tree view

**Issue:** No visual indication that a bucket is scoped to a prefix.

**Fix:** `src/views/s3-tree-provider.ts` — `S3BucketItem` now shows prefix in description and tooltip.

- [x] 8.2.1 Description: `us-east-1` → `us-east-1 · prefix: team-data/` when prefix is set
- [x] 8.2.2 Tooltip: adds `\nScoped to prefix: team-data/` when prefix is set
- [x] 8.2.3 New unit test: `shows prefix in description when bucket has a prefix scope`

**Status: DONE**

### 8.3 Filter zero-byte folder placeholder objects from listing

**Issue:** S3 returns zero-byte objects ending with `/` (folder placeholders created by "Create Folder") in `Contents` AND `CommonPrefixes`, causing folders to appear twice — once as a folder, once as a 0-byte file.

**Fix:** `src/services/s3-service.ts` — `listObjects()` now filters out objects where `Size === 0 && key.endsWith('/')`.

- [x] 8.3.1 Add filter in `listObjects`: skip zero-byte objects whose key ends with `/`
- [x] 8.3.2 Unit test in `s3-service.test.ts`: verifies `logs/` (0-byte) is filtered, `logs/app.log` and `empty.txt` (0-byte but no `/`) are kept
- [x] 8.3.3 Unit test in `s3-tree-provider.test.ts`: verifies tree provider renders CommonPrefixes as folders + filtered objects as files

**Status: DONE**
