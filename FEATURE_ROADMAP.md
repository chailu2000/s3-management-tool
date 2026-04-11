# S3 Management Tool — Feature Gap Analysis & Roadmap

> **Date:** 2026-04-04  
> **Scope:** Review of existing capabilities, gaps, and prioritized feature recommendations

---

## Current State Summary

| Area | Status | Notes |
|------|--------|-------|
| Single file upload | ✅ Exists | File picker, single + multipart |
| Single object download | ✅ Exists | Save dialog, streaming |
| Create folder/prefix | ❌ Missing | No command, no zero-byte placeholder |
| File content preview | ❌ Missing | Metadata only, no content viewing |
| Drag & drop upload | ❌ Missing | No `TreeDragAndDropController` |
| Drag & drop download | ❌ Missing | Same as above |
| Bucket info display | ⚠️ Partial | `BucketSummary` model exists, versioning API exists, but no UI command to view them |
| Versioned bucket support | ⚠️ Partial | `getBucketVersioning()` exists in `S3Service`, but no UI or version listing |
| Recursive folder download | ❌ Missing | Only single-object downloads |
| Recursive folder upload | ❌ Missing | `canSelectFolders: false` hardcoded |
| Multi-select operations | ❌ Missing | No batch delete/download |
| Copy S3 URI to clipboard | ❌ Missing | Quick win, not implemented |

---

## Feature Review & Prioritization

### #1 — Create Folder at Bucket/Prefix Level
**Priority: 🟢 Quick Win (Highest)**  
**Effort:** Small (~1-2 hours)

**What's missing:** No "Create Folder" context menu action on buckets or prefixes. S3 "folders" are zero-byte objects with a trailing `/` in the key.

**Implementation:**
- New command: `s3-management-tool.createFolder`
- Context menu on `s3Bucket` and `s3Prefix` items
- Prompts for folder name, calls `putObject` with empty body and key ending with `/`
- Refreshes the parent node after creation

**Why first:** Fills a basic file-manager gap. Very low risk, high daily utility.

---

### #2 — Copy S3 URI / Key to Clipboard
**Priority: 🟢 Quick Win**  
**Effort:** Tiny (~30 minutes)

**What's missing:** No way to quickly copy `s3://bucket/key` or just the object key.

**Implementation:**
- New command: `s3-management-tool.copyS3Uri`
- Context menu on `s3Object` and `s3Prefix` items
- Copies `s3://bucket/key/` to clipboard via `vscode.env.clipboard.writeText()`
- Shows confirmation notification

**Why early:** Almost zero effort, used constantly in workflows (sharing links, debugging, CLI usage).

---

### #3 — Text File Preview (First N Lines)
**Priority: 🟡 High Value**  
**Effort:** Medium (~4-6 hours)

**What's missing:** Can view metadata but not file content. Need to download to read.

**Implementation:**
- New command: `s3-management-tool.previewObject`
- For objects with text-like extensions (`.json`, `.csv`, `.txt`, `.log`, `.yaml`, `.xml`, `.md`, `.js`, `.ts`, etc.)
- Fetches object via `GetObjectCommand`, reads first ~50KB
- Opens in a VS Code **read-only editor tab** with language mode detection
- Falls back to webview for binary/unknown content types
- Size limit enforced to prevent loading gigabyte files into memory

**Why high:** Essential for inspecting configs, logs, data files without downloading.

---

### #4 — Recursive Folder Download (Prefix Download)
**Priority: 🟡 High Value**  
**Effort:** Medium (~4-6 hours)

**What's missing:** Can only download single objects. No way to download an entire prefix/folder.

**Implementation:**
- New command: `s3-management-tool.downloadPrefix`
- Context menu on `s3Prefix` items
- Prompts for local destination directory
- Iterates all objects under prefix (handling pagination)
- Downloads each object preserving directory structure
- Progress reporting with overall count and per-file progress
- Reuses existing `getObject()` streaming logic

**Why high:** Practical necessity — users rarely want just one file from a prefix.

---

### #5 — Display Bucket Info
**Priority: 🟡 High Value**  
**Effort:** Small (~2-3 hours)

**What's missing:** `S3Service` already has `getBucketRegion()`, `getBucketVersioning()`, `getBucketPolicy()`, and `tryListBuckets()` returns `BucketSummary` with name/creation date. But there's **no UI command** to display this information.

**Current state:**
```
S3Service methods already available:
  ✅ getBucketRegion(bucket) → string
  ✅ getBucketVersioning(bucket) → 'Enabled' | 'Suspended' | 'NotEnabled' | 'Unknown'
  ✅ getBucketPolicy(bucket) → string | null
  ✅ tryListBuckets() → { buckets: BucketSummary[], hasPermission: boolean }

BucketSummary model already exists:
  ✅ name: string
  ✅ region?: string
  ✅ creationDate?: Date
```

**Implementation:**
- New command: `s3-management-tool.showBucketInfo`
- Context menu on `s3Bucket` items
- Opens a webview panel or information panel showing:
  - **Bucket name**
  - **Region**
  - **Creation date**
  - **Versioning status** (Enabled / Suspended / Not Enabled / Unknown)
  - **Bucket policy** (if exists, collapsible JSON)
  - **Prefix scope** (if configured on the bucket)
  - **Object count** (from listing with truncated results)
  - **Total size** (sum of object sizes)
- Reuses existing `S3Service` methods — minimal new API code

**Why high:** Leverages existing backend code. Users need this for auditing, debugging access issues, and understanding bucket configuration.

---

### #6 — Versioned Bucket Support
**Priority: 🟠 Medium**  
**Effort:** Medium-Large (~6-8 hours)

**What's missing:** Versioning status is queryable but there's no UI for:
- Listing object versions
- Restoring a previous version
- Deleting a specific version
- Showing version ID in the tree view

**Current state:**
```
Already available:
  ✅ getBucketVersioning() returns status
  ✅ VersioningStatus type defined
  ✅ S3 SDK supports ListObjectVersionsCommand (not yet imported)

Not implemented:
  ❌ No ListObjectVersionsCommand import in S3Service
  ❌ No version listing UI
  ❌ No version restore/delete
  ❌ No version ID shown on object nodes
```

**Implementation:**
- New `S3Service` method: `listObjectVersions(bucket, key, region)` → returns array of versions
- New `S3Service` method: `restoreVersion(bucket, key, versionId, region)` → copy version to current
- New `S3Service` method: `deleteVersion(bucket, key, versionId, region)`
- Context menu on `s3Object` → "View Versions" (only shown if bucket versioning is Enabled)
- Opens a webview panel listing all versions with:
  - Version ID
  - Size
  - Last modified
  - Is latest? (boolean)
  - Actions: Restore, Delete, Download
- Optional: Show version count badge on object nodes in versioned buckets

**Why medium:** More complex, requires new SDK imports, version-specific UI flow. Important for enterprise users with compliance requirements.

---

### #7 — Recursive Folder Upload (Directory Upload)
**Priority: 🟠 Medium**  
**Effort:** Medium (~4-6 hours)

**What's missing:** `canSelectFolders: false` hardcoded in upload command. No recursive directory upload.

**Implementation:**
- Modify `uploadObject` command or create new `uploadDirectory` command
- Use `vscode.window.showOpenDialog({ canSelectFolders: true })` for directory selection
- Or: allow multi-file selection with folder structure preservation
- Recursively walks local directory, uploads each file preserving relative paths
- Progress reporting with file count and overall bytes
- Optionally skip unchanged files (compare local MD5 with S3 ETag)

**Why medium:** Pairs well with drag-and-drop (#8). Useful for deploying build artifacts, static sites, data directories.

---

### #8 — Drag & Drop Upload
**Priority: 🟠 Medium**  
**Effort:** Medium-Large (~6-8 hours)

**What's missing:** No `TreeDragAndDropController` on the tree provider. Cannot drag local files onto S3 bucket/prefix nodes.

**Current state:**
```
Tree provider implements:
  ✅ TreeDataProvider<S3TreeItem>
  ✅ getTreeItem(), getChildren()

Tree provider does NOT implement:
  ❌ TreeDragAndDropController
  ❌ handleDrag(), handleDrop()
  ❌ dragMimeTypes, dropMimeTypes
```

**Implementation:**
- Add `TreeDragAndDropController` to `S3TreeProvider` (or per-item class)
- `dropMimeTypes = ['files', 'text/uri-list']`
- `handleDrop()` processes `vscode.DataTransfer` items:
  - File drops → upload each file to the target bucket/prefix
  - Folder drops → recursive upload (depends on #7)
- Progress notification during upload
- Visual feedback on hover (which prefix will receive the files)

**Why medium:** Great UX but requires understanding VS Code's drag-and-drop API. Pairs with #7.

---

### #9 — Multi-Select Operations
**Priority: 🔵 Lower**  
**Effort:** Medium (~4 hours)

**What's missing:** No batch delete, batch download, or multi-select actions.

**Implementation:**
- VS Code tree views don't natively support multi-select well
- Could use a "select mode" toggle that adds checkboxes to tree items
- Or: use Command Palette with multi-input for batch operations
- Batch delete: select multiple objects → confirm → delete all
- Batch download: select multiple → choose folder → download all

**Why lower:** Complex UX in VS Code's tree API. Lower frequency use case.

---

### #10 — Drag & Drop Download (Tree → Local)
**Priority: 🔵 Lower**  
**Effort:** Medium (~3-4 hours)

**What's missing:** Cannot drag an S3 object from the tree to the local filesystem.

**Implementation:**
- `handleDrag()` on `S3ObjectItem` sets data transfer with file content
- Limitation: VS Code doesn't support writing to arbitrary filesystem locations from drag
- Alternative: drag to VS Code's explorer (downloads to workspace folder)
- Or: drag creates a temp file and copies to drop target

**Why lower:** Technically constrained by VS Code's API. Right-click → Download works fine. Lower ROI.

---

### #11 — Object Tag Management
**Priority: 🔵 Lower**  
**Effort:** Medium (~3-4 hours)

**What's missing:** No ability to view or edit S3 object tags (used for lifecycle rules, cost allocation).

**Implementation:**
- New `S3Service` methods: `getObjectTags()`, `setObjectTags()`
- Context menu → "Manage Tags"
- Webview showing tag key-value pairs with add/edit/delete

**Why lower:** Niche use case. Mostly needed by DevOps/infrastructure teams.

---

### #12 — Inline Rename for Objects/Prefixes
**Priority: 🟣 Lowest**  
**Effort:** Medium (~3-4 hours)

**What's missing:** No rename capability. S3 doesn't support rename natively — it's copy + delete.

**Implementation:**
- Context menu → "Rename"
- Prompts for new key
- Copies object to new key, deletes original
- For prefixes: copies all objects under prefix, deletes originals (expensive operation)

**Why lowest:** Destructive operation with risk of data loss. S3 rename is not atomic.

---

## Recommended Implementation Order

| Phase | Feature | Effort | Impact | Why This Order |
|-------|---------|--------|--------|----------------|
| **1** | Create Folder | Small | Medium | Quick win, fills basic gap |
| **2** | Copy S3 URI | Tiny | Medium | 30-min feature, daily utility |
| **3** | Bucket Info Display | Small | High | Reuses existing backend, high value |
| **4** | Text File Preview | Medium | High | Major UX improvement |
| **5** | Recursive Folder Download | Medium | High | Practical necessity |
| **6** | Recursive Folder Upload | Medium | Medium | Pairs with drag-and-drop |
| **7** | Drag & Drop Upload | Medium-Large | Medium | Modern UX expectation |
| **8** | Versioned Bucket Support | Medium-Large | Medium | Enterprise compliance |
| **9** | Multi-Select Operations | Medium | Low-Medium | Productivity booster |
| **10** | Object Tag Management | Medium | Low | Niche use case |
| **11** | Drag & Drop Download | Medium | Low | Technically constrained |
| **12** | Inline Rename | Medium | Low | Risky, non-atomic operation |

---

## Quick Wins Summary (< 3 hours each)

| Feature | Effort | Benefit |
|---------|--------|---------|
| Copy S3 URI | 30 min | Daily utility for sharing links |
| Create Folder | 1-2 hours | Basic file manager functionality |
| Bucket Info Display | 2-3 hours | Auditing, debugging, understanding config |

---

## High-Impact Features (> 4 hours but transformative)

| Feature | Effort | Benefit |
|---------|--------|---------|
| Text File Preview | 4-6 hours | Inspect without download |
| Recursive Folder Download | 4-6 hours | Bulk operations |
| Drag & Drop Upload | 6-8 hours | Modern UX |
| Versioned Bucket Support | 6-8 hours | Enterprise compliance, safety |

---

## Dependency Map

```
Create Folder ───────────────────────────────────→ (none)
Copy S3 URI ─────────────────────────────────────→ (none)
Bucket Info Display ─────────────────────────────→ (none, backend already exists)
Text File Preview ───────────────────────────────→ (none)
Recursive Folder Download ───────────────────────→ (none, uses existing getObject)
Recursive Folder Upload ─────────────────────────→ (none)
Drag & Drop Upload ──────────────────────────────→ Folder Upload (#7) recommended first
Versioned Bucket Support ────────────────────────→ Bucket Info (#3) recommended first
Multi-Select Operations ─────────────────────────→ (none)
Drag & Drop Download ────────────────────────────→ (none)
Object Tag Management ───────────────────────────→ (none)
Inline Rename ───────────────────────────────────→ (none)
```

---

## Architecture Notes

### Existing Backend Methods (Ready to Use)

These `S3Service` methods are **already implemented** and just need UI wiring:

| Method | Returns | Feature it enables |
|--------|---------|-------------------|
| `getBucketRegion(bucket)` | `string` | Bucket Info |
| `getBucketVersioning(bucket)` | `VersioningStatus` | Bucket Info, Versioned Support |
| `getBucketPolicy(bucket)` | `string \| null` | Bucket Info |
| `tryListBuckets()` | `{ buckets: BucketSummary[], hasPermission: boolean }` | Bucket Info |

### New Backend Methods Needed

| Method | Feature | SDK Commands Needed |
|--------|---------|-------------------|
| `listObjectVersions(bucket, key, region)` | Versioned Support | `ListObjectVersionsCommand` |
| `restoreVersion(bucket, key, versionId, region)` | Versioned Support | `CopyObjectCommand` (version source) |
| `deleteVersion(bucket, key, versionId, region)` | Versioned Support | `DeleteObjectCommand` with `VersionId` |

---

## Notes on Bucket Info & Versioned Bucket Support

### Bucket Info (#3)

**Already implemented — just needs UI.** The `S3Service` already fetches region, versioning, and policy. The `BucketSummary` model already has `name`, `region`, and `creationDate`.

**Recommended UI:** Webview panel or information panel (similar to Object Details) showing:
- Bucket name, region, creation date
- Versioning status badge
- Bucket policy (collapsible JSON)
- Configured prefix (if any)
- Object count and total size (optional, from listing)

**No new AWS SDK imports needed.** All data is already fetchable.

### Versioned Bucket Support (#6)

**Partially implemented.** `getBucketVersioning()` exists and returns status. But version listing, restore, and delete are not implemented.

**What's needed:**
1. Import `ListObjectVersionsCommand` from `@aws-sdk/client-s3`
2. New `S3Service.listObjectVersions()` method
3. New `S3Service.restoreVersion()` method (copy version to current key)
4. New `S3Service.deleteVersion()` method (delete with `VersionId` parameter)
5. UI: "View Versions" context menu on objects in versioned buckets
6. Webview listing versions with restore/delete actions

**Key design decision:** Only show "View Versions" if `getBucketVersioning()` returns `Enabled`. Otherwise the menu item is hidden or shows "Versioning not enabled for this bucket."

---

*Document maintained as part of the S3 Management Tool project.*
