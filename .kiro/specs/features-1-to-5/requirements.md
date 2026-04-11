# Requirements — Features #1 to #5

> **Date:** 2026-04-04  
> **Scope:** Create Folder, Copy S3 URI, Bucket Info, Text File Preview, Recursive Folder Download

---

## Feature #1: Create Folder

### User Story
As a user, I want to create a folder (prefix placeholder) inside an S3 bucket or under an existing prefix, so that I can organize my S3 objects without uploading files first.

### Acceptance Criteria
1. Right-clicking a bucket or prefix in the tree shows a "Create Folder" context menu item.
2. User is prompted to enter a folder name with validation (non-empty).
3. A zero-byte object is created in S3 with a key ending in `/`.
4. The folder key respects the bucket's configured prefix scope (if any).
5. After creation, the tree node is refreshed and the new folder appears.
6. Success/error notification is shown to the user.
7. If the user cancels the input dialog, no action is taken.

---

## Feature #2: Copy S3 URI

### User Story
As a user, I want to copy the `s3://` URI of an object or prefix to my clipboard, so that I can share links or use them in CLI commands.

### Acceptance Criteria
1. Right-clicking an object or prefix in the tree shows a "Copy S3 URI" context menu item.
2. Clicking it copies `s3://bucket/key` (for objects) or `s3://bucket/prefix/` (for prefixes) to the system clipboard.
3. A confirmation notification is shown with the copied URI.

---

## Feature #3: Display Bucket Info

### User Story
As a user, I want to view detailed information about a bucket (region, versioning, policy, creation date), so that I can audit and understand my bucket's configuration.

### Acceptance Criteria
1. Right-clicking a bucket in the tree shows a "Bucket Info" context menu item.
2. A webview panel opens showing:
   - Bucket name
   - AWS region
   - Creation date (if available)
   - Versioning status (Enabled / Suspended / Not Enabled / Unknown)
   - Bucket policy JSON (if exists, in a collapsible section)
   - Configured prefix scope (if any)
3. If the bucket policy exists, it is displayed as formatted JSON.
4. If the bucket policy is not accessible, a "— No policy or access denied —" message is shown.
5. If versioning access is denied, the status shows "Unknown".
6. All data is fetched from AWS; errors are shown to the user.

---

## Feature #4: Text File Preview

### User Story
As a user, I want to preview the content of a text-based S3 object (JSON, CSV, logs, configs) directly in VS Code, so that I don't have to download it first.

### Acceptance Criteria
1. Right-clicking an object in the tree shows a "Preview Content" context menu item.
2. The extension determines if the object is text-previewable based on:
   - File extension (`.json`, `.csv`, `.txt`, `.log`, `.yaml`, `.yml`, `.xml`, `.md`, `.js`, `.ts`, `.html`, `.css`, `.py`, `.sh`, `.ini`, `.cfg`, `.conf`, `.toml`, `.env`)
   - OR `ContentType` metadata starting with `text/`, `application/json`, `application/xml`, `application/x-yaml`
3. For previewable objects:
   - Content is fetched from S3 (up to 50 KB limit).
   - A **read-only VS Code text editor tab** opens with the content.
   - Language mode is auto-detected from file extension.
   - The tab title shows the object key.
   - A message in the editor indicates it is read-only preview from S3.
4. For non-previewable objects (binary, too large):
   - User is shown an informational message explaining why preview is not available.
   - Suggestion to download the file instead.
5. Objects larger than 50 KB are rejected with a message showing the actual size.

---

## Feature #5: Recursive Folder Download

### User Story
As a user, I want to download an entire prefix (folder) from S3 to my local filesystem, preserving the directory structure, so that I can work with multiple files at once.

### Acceptance Criteria
1. Right-clicking a prefix in the tree shows a "Download Folder" context menu item.
2. User is prompted to select a local destination directory.
3. All objects under the prefix are downloaded, preserving the S3 directory structure as local folders.
4. Progress notification shows:
   - Overall progress: "Downloading 3 of 15 files..."
   - Current file name being downloaded.
5. If an error occurs on a single file, the error is logged but the download continues for remaining files.
6. A summary notification is shown at the end:
   - Total files downloaded.
   - Total bytes transferred.
   - Number of errors (if any).
7. The destination directory is opened in the file explorer (optional, user preference).
8. Prefix scope is respected (if the bucket has a configured prefix).
