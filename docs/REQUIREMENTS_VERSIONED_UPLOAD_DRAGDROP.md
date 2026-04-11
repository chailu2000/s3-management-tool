# Requirements: Versioned Buckets, Recursive Upload, Drag & Drop

> **Date:** 2026-04-04
> **Features:** #6 Versioned Bucket Support, #7 Recursive Folder Upload, #8 Drag & Drop Upload
> **Source:** FEATURE_ROADMAP.md

---

## 1. Feature #6 — Versioned Bucket Support

### 1.1 Problem Statement

S3 buckets with versioning enabled store multiple versions of each object. The extension currently has no UI for listing, restoring, or deleting specific versions. Users must go to the AWS Console to manage versions, which breaks their workflow.

### 1.2 User Stories

| # | As a… | I want to… | So that… |
|---|-------|------------|----------|
| 6.1 | S3 user | See that a bucket has versioning enabled | I know versions are available |
| 6.2 | S3 user | View all versions of an object | I can find a previous version to restore |
| 6.3 | S3 user | Restore a previous version | I can recover from accidental changes |
| 6.4 | S3 user | Delete a specific version | I can clean up old versions I no longer need |
| 6.5 | S3 user | Download a specific version | I can inspect historical content |

### 1.3 Acceptance Criteria

**AC-6.1 — Version indicator on bucket**
- When a bucket's versioning status is `Enabled`, the `S3BucketItem` shows a versioning icon (e.g. `clock` ThemeIcon) alongside the database icon or as a badge in the description.

**AC-6.2 — "View Versions" context menu**
- Right-clicking an `S3ObjectItem` in a versioned bucket shows "View Versions" in the context menu.
- The menu item is hidden when the bucket's versioning status is not `Enabled`.

**AC-6.3 — Versions webview panel**
- Opens a webview titled `Versions: <object-key>`.
- Lists all versions of the object, sorted by last modified (newest first).
- Each row shows: Version ID (truncated, hover for full), Size, Last Modified, "Latest" badge.
- Each row has action buttons: **Restore**, **Delete**, **Download**.

**AC-6.4 — Restore version**
- Clicking "Restore" copies the selected version to the object's current key (S3 `CopyObject` with `VersionId` source).
- Shows confirmation notification.
- Refreshes the object listing to reflect the new latest version.

**AC-6.5 — Delete version**
- Clicking "Delete" shows a confirmation dialog ("Delete version <id>? This cannot be undone.").
- On confirm, calls `DeleteObject` with the `VersionId`.
- Shows confirmation or error notification.
- Refreshes the versions panel.

**AC-6.6 — Download version**
- Clicking "Download" opens a save dialog and streams the specific version to disk.
- Shows progress notification.

### 1.4 Out of Scope

- Enabling/suspending versioning on a bucket (admin operation, not a daily user task).
- Version diff view (comparing content between two versions).
- Batch version operations.

---

## 2. Feature #7 — Recursive Folder Upload (Directory Upload)

### 2.1 Problem Statement

Users can only upload individual files. There is no way to upload an entire local directory to an S3 prefix while preserving the directory structure. This is needed for deploying build artifacts, static sites, and data directories.

### 2.2 User Stories

| # | As a… | I want to… | So that… |
|---|-------|------------|----------|
| 7.1 | S3 user | Select a local folder to upload | I can upload an entire directory tree at once |
| 7.2 | S3 user | See upload progress for each file | I know how the upload is progressing |
| 7.3 | S3 user | Skip files that haven't changed | I avoid unnecessary re-uploads |
| 7.4 | S3 user | Cancel a folder upload mid-way | I can stop a large upload if needed |
| 7.5 | S3 user | Choose the destination prefix | I can upload to a specific path in the bucket |

### 2.3 Acceptance Criteria

**AC-7.1 — Folder selection**
- The existing "Upload Object" command now supports selecting folders via `canSelectFolders: true` in addition to files.
- The open dialog allows both file and folder selection (`canSelectFiles: true, canSelectFolders: true, canSelectMany: true`).

**AC-7.2 — Recursive upload**
- When a folder is selected, the command recursively walks the directory tree.
- Each file is uploaded with a key that preserves the relative path structure under the selected folder.
- The destination key is: `<existing-prefix>/<relative-path-from-selected-folder>`.

**AC-7.3 — Change detection (skip unchanged)**
- Before uploading each file, compare the local file's MD5 with the S3 object's ETag (normalized).
- If they match, skip the upload and count it as "skipped".
- This check can be disabled with a flag (for future use).

**AC-7.4 — Progress reporting**
- Shows a progress notification with:
  - Total file count and current file number
  - Current file name
  - Per-file upload progress percentage
- Supports cancellation.

**AC-7.5 — Summary notification**
- After completion, shows a summary:
  - Files uploaded: N
  - Files skipped (unchanged): N
  - Errors: N
  - Total bytes transferred

**AC-7.6 — Error handling**
- If a single file fails to upload, log the error and continue with the next file.
- Report the total error count in the summary.

### 2.4 Out of Scope

- Multi-part upload for every file in the batch (only files > 5 MB use multipart, same as current single-file upload).
- Bandwidth throttling.
- Resuming interrupted uploads (no checkpoint/manifest file).

---

## 3. Feature #8 — Drag & Drop Upload

### 3.1 Problem Statement

Users expect to drag files from their file explorer (or VS Code's explorer) onto S3 bucket/prefix nodes in the tree view. This is a standard file manager interaction pattern.

### 3.2 User Stories

| # | As a… | I want to… | So that… |
|---|-------|------------|----------|
| 8.1 | S3 user | Drag files from my file explorer onto a bucket/prefix node | I can upload files quickly without dialogs |
| 8.2 | S3 user | Drag multiple files at once | I can batch upload |
| 8.3 | S3 user | See upload progress during drag-drop | I know the upload is happening |
| 8.4 | S3 user | Drag a folder onto a bucket | The entire folder is uploaded recursively (depends on #7) |

### 3.3 Acceptance Criteria

**AC-8.1 — Drop handler on tree view**
- The `S3TreeProvider` implements `vscode.TreeDragAndDropController`.
- `dropMimeTypes` includes `'files'` and `'text/uri-list'`.
- `handleDrop()` processes dropped items:
  - For each file URI in the data transfer, extract the local filesystem path.
  - Upload each file to the target bucket/prefix.

**AC-8.2 — Target resolution**
- Dropping on an `S3BucketItem` → upload to the bucket's configured prefix (or root).
- Dropping on an `S3PrefixItem` → upload to that prefix.
- Dropped folders are recursively uploaded (requires #7).

**AC-8.3 — Progress notification**
- Shows the same progress notification as the upload command.
- Supports cancellation.

**AC-8.4 — Visual feedback**
- The tree view should accept drops (VS Code handles the cursor automatically when `dropMimeTypes` is set).

**AC-8.5 — Error handling**
- If any file fails, show an error notification but continue with remaining files.
- Summary shows success/error counts.

### 3.6 Out of Scope

- Drag from S3 tree → local filesystem (Feature #10 in roadmap).
- Drag between two S3 buckets/prefixes.
- Custom drop zone highlighting (VS Code handles this).

---

## 4. Cross-Cutting Requirements

### 4.1 Error Handling
- All S3 operations use `withRetry()` for throttling resilience.
- All SDK errors are wrapped with user-friendly messages via `wrapError()`.

### 4.2 Progress Notifications
- Use `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true })`.
- Report both message (file name) and increment (percentage or file count).

### 4.3 Tree Refresh
- After any mutation (upload, delete, restore), refresh the affected tree node.

### 4.4 Testing
- Unit tests for all new `S3Service` methods.
- Unit tests for recursive file walking and change detection.
- Unit tests for drag-and-drop URI extraction.

---

## 5. Dependencies

| Feature | Depends On |
|---------|------------|
| #6 Versioned Support | None (standalone) |
| #7 Recursive Upload | None (uses existing `putObject`/`putObjectMultipart`) |
| #8 Drag & Drop | #7 recommended (folder drop needs recursive upload) |
