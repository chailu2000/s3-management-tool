# S3 Management Tool - Complete Walkthrough Guide

A standalone VS Code extension for managing AWS S3 buckets and objects directly from your IDE. No backend required - communicates directly with AWS S3 using the AWS SDK.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Local Development Setup](#local-development-setup)
- [Running the Extension](#running-the-extension)
- [Using the Extension](#using-the-extension)
  - [Bucket Management](#bucket-management)
  - [Object Operations](#object-operations)
  - [Sync Functionality](#sync-functionality)
  - [Sync Profiles](#sync-profiles)
  - [Watch Mode](#watch-mode)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Property-Based Tests](#property-based-tests)
  - [E2E Tests with LocalStack](#e2e-tests-with-localstack)
- [Configuration](#configuration)
- [AWS Credentials](#aws-credentials)
- [IAM Permissions](#iam-permissions)
- [Troubleshooting](#troubleshooting)
- [Development Commands](#development-commands)
- [Architecture](#architecture)

---

## Overview

The S3 Management Tool is a **standalone VS Code extension** that provides a comprehensive interface for managing AWS S3 buckets and objects. It follows a **permission-aware architecture** that works even when you don't have `s3:ListAllMyBuckets` permission, making it ideal for restricted enterprise environments.

### Key Differentiators

- ✅ **No ListBuckets Permission Required** - Add buckets manually by name, ARN, or prefix
- ✅ **Prefix-Based Access** - Support for shared buckets with prefix-level permissions
- ✅ **Incremental Sync** - Only transfer changed files using MD5/ETag comparison
- ✅ **Bidirectional Sync** - Two-way sync with intelligent conflict detection
- ✅ **Watch Mode** - Auto-sync local changes to S3 in real-time
- ✅ **Sync Profiles** - Save and reuse sync configurations

---

## Key Features

### Bucket Management
- Add buckets by name, ARN, or with prefix scope
- Auto-discovery when ListBuckets permission is available
- Multi-region support with client caching
- Bucket metadata display (region, versioning, policy)

### Object Operations
- Browse objects in tree view (buckets → prefixes → objects)
- Download objects to local filesystem
- Upload objects (single or multi-part for large files)
- Delete objects with confirmation
- Copy objects between buckets/prefixes
- View object metadata
- Generate presigned URLs for temporary access

### Sync Functionality
- **Local → S3**: Upload local directory to S3 bucket/prefix
- **S3 → Local**: Download S3 objects to local directory
- **Bidirectional**: Two-way sync with conflict detection
- **Incremental**: Only transfer files that have changed (MD5/ETag comparison)
- **Dry-Run**: Preview changes without executing
- **Delete Missing**: Clean up files not present on other side
- **Exclude Patterns**: Filter out files using glob patterns (`.git`, `node_modules`, etc.)

### Sync Profiles
- Save named sync configurations
- One-click execution of saved profiles
- Edit/delete existing profiles
- Tracks last successful sync timestamp

### Watch Mode
- Monitor local directory for file changes
- Auto-upload changes to S3 (500ms debounce)
- Status bar indicator showing active watch
- Start/stop watch mode from command palette

---

## Project Structure

```
s3-management-tool/
├── src/
│   ├── extension-standalone.ts       # Main entry point
│   ├── aws/
│   │   ├── client-factory.ts         # S3 client factory with region cache
│   │   └── retry-handler.ts          # Exponential backoff retry logic
│   ├── commands/
│   │   ├── add-bucket-by-name.ts     # Add bucket command
│   │   ├── add-bucket-by-arn.ts      # Add bucket by ARN command
│   │   ├── add-bucket-with-prefix.ts # Add bucket with prefix command
│   │   ├── remove-bucket.ts          # Remove bucket command
│   │   ├── select-profile.ts         # AWS profile selection
│   │   ├── refresh-buckets.ts        # Refresh bucket list
│   │   ├── download-object.ts        # Download object command
│   │   ├── upload-object.ts          # Upload object command
│   │   ├── delete-object.ts          # Delete object command
│   │   ├── copy-object.ts            # Copy object command
│   │   ├── view-metadata.ts          # View object metadata
│   │   ├── generate-presigned-url.ts # Generate presigned URL
│   │   ├── sync-local-to-s3.ts       # Local → S3 sync
│   │   ├── sync-s3-to-local.ts       # S3 → Local sync
│   │   ├── sync-bidirectional.ts     # Bidirectional sync
│   │   ├── sync-profiles.ts          # Sync profile CRUD
│   │   ├── watch-mode.ts             # Watch mode start/stop
│   │   └── view-sync-results.ts      # View sync result details
│   ├── services/
│   │   ├── credential-provider.ts    # AWS credential management
│   │   ├── bucket-storage.ts         # Bucket/profile persistence
│   │   ├── s3-service.ts             # Core S3 operations
│   │   ├── sync-service.ts           # Sync logic (741 lines)
│   │   └── file-classifier.ts        # File classification for bidirectional sync
│   ├── models/
│   │   └── s3-models.ts              # TypeScript interfaces
│   ├── views/
│   │   ├── s3-tree-provider.ts       # Tree view provider
│   │   └── object-details-panel.ts   # Webview panel for object details
│   ├── utils/
│   │   ├── validation.ts             # Input validation
│   │   └── webview-sanitizer.ts      # Credential stripping for webview
│   └── tests/
│       ├── unit/                     # Unit and property tests
│       └── e2e/                      # E2E tests with LocalStack
├── package.json                      # Extension manifest
├── tsconfig.json                     # TypeScript configuration
├── jest.config.js                    # Unit test configuration
├── jest.e2e.config.js                # E2E test configuration
└── tsconfig.e2e.json                 # E2E TypeScript configuration
```

---

## Prerequisites

- **VS Code** 1.88.0 or higher
- **Node.js** 18+ and **npm** (or pnpm)
- **AWS Account** with S3 access
- **AWS Credentials** configured via:
  - AWS CLI profiles (`~/.aws/credentials`)
  - Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
  - Manual entry in the extension

### For E2E Tests Only
- **Docker** and **Docker Compose**
- **LocalStack** running locally

---

## Installation

### Option 1: From Source (Development)

1. **Clone the repository:**
   ```bash
   cd /Users/luindc22203/workspace/s3-management-tool
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Compile TypeScript:**
   ```bash
   pnpm run compile
   ```

### Option 2: From VSIX Package

If you have a packaged `.vsix` file:

1. Open VS Code
2. Open Command Palette (`Cmd/Ctrl+Shift+P`)
3. Run `Extensions: Install from VSIX...`
4. Select the `.vsix` file

### Option 3: From Marketplace (Future)

Once published to VS Code Marketplace or OpenVSX:

1. Open VS Code
2. Go to Extensions view (`Cmd/Ctrl+Shift+X`)
3. Search for "AWS S3 Management Tool"
4. Click Install

---

## Local Development Setup

### 1. Install Dependencies

```bash
cd s3-management-tool
pnpm install
```

### 2. Compile TypeScript

```bash
pnpm run compile
```

This compiles all TypeScript files to the `out/` directory.

### 3. Watch Mode (Auto-Compile)

For development, run the TypeScript compiler in watch mode:

```bash
pnpm run watch
```

This automatically recompiles on file changes.

### 4. Open in VS Code

Open the project in VS Code:

```bash
code .
```

---

## Running the Extension

### Method 1: Run Extension Host (Recommended for Development)

1. **Open the project in VS Code**
2. **Press `F5`** or go to **Run → Start Debugging**
3. This launches a new VS Code window (Extension Host) with the extension loaded
4. The original VS Code window remains available for editing code

### Method 2: Load Unpacked Extension

1. Open VS Code
2. Go to **Extensions** view (`Cmd/Ctrl+Shift+X`)
3. Click **...** (More Actions) → **Install from VSIX...**
4. Or use **Developer: Install Extension from Location** and point to the project directory

### Method 3: Package and Install

```bash
# Package the extension
pnpm run package

# This creates a .vsix file that can be installed
```

---

## Using the Extension

### Bucket Management

#### Adding a Bucket

**Method 1: By Name**
1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run `S3: Add Bucket by Name`
3. Enter bucket name (e.g., `my-bucket`)
4. Select AWS region
5. Extension validates access and adds to tree view

**Method 2: By ARN**
1. Run `S3: Add Bucket by ARN`
2. Enter full ARN (e.g., `arn:aws:s3:::my-bucket`)
3. Extension parses ARN and validates access

**Method 3: With Prefix**
1. Run `S3: Add Bucket with Prefix`
2. Enter bucket name, region, and prefix (e.g., `team-data/`)
3. Extension validates access to the specific prefix

#### Removing a Bucket

1. Right-click on bucket in tree view
2. Select **Remove Bucket**
3. This only removes from UI, does NOT delete from AWS

#### Refreshing Buckets

1. Click the **Refresh** icon in the S3 Buckets view toolbar
2. Or run `S3: Refresh Buckets` from Command Palette

---

### Object Operations

#### Browsing Objects

1. Expand a bucket in the tree view
2. Navigate through prefixes (folders) and objects (files)
3. Object nodes display size and last modified date

#### Downloading an Object

1. Right-click on an object in tree view
2. Select **Download Object**
3. Choose save location
4. Progress notification shows download status

#### Uploading an Object

1. Right-click on a prefix (or bucket root)
2. Select **Upload Object**
3. Select file(s) to upload
4. Progress notification shows upload status

#### Deleting an Object

1. Right-click on an object
2. Select **Delete Object**
3. Confirm deletion in dialog
4. Object is removed from tree view

#### Viewing Metadata

1. Right-click on an object
2. Select **View Metadata**
3. Webview panel opens showing:
   - Key, size, last modified
   - Content type, ETag, storage class
   - User-defined metadata

#### Generating Presigned URL

1. Right-click on an object
2. Select **Generate Presigned URL**
3. Enter expiry duration in minutes (default: 60, max: 10080)
4. URL is copied to clipboard

---

### Sync Functionality

#### Local → S3 Sync

1. Run `S3: Sync Local to S3` from Command Palette
2. Select local directory to sync
3. Enter S3 bucket name
4. Enter prefix (optional)
5. Enter AWS region
6. Choose whether to delete missing S3 objects
7. Choose dry-run (preview) or execute
8. Progress notification shows sync status
9. Summary displayed on completion

**Example:**
```
Local: /Users/me/my-project/dist/
Bucket: my-website-bucket
Prefix: production/
Region: us-east-1
Delete Missing: No
Dry Run: Yes - Preview only
```

#### S3 → Local Sync

1. Run `S3: Sync S3 to Local`
2. Enter S3 bucket name
3. Enter prefix (optional)
4. Enter AWS region
5. Select local destination directory
6. Choose whether to delete missing local files
7. Choose dry-run or execute
8. Progress and summary displayed

#### Bidirectional Sync

1. Run `S3: Bidirectional Sync`
2. Select local directory
3. Enter S3 bucket and prefix
4. Enter AWS region
5. Select conflict resolution strategy:
   - **keep-local**: Upload local to S3
   - **keep-remote**: Download S3 to local
   - **keep-both**: Rename local with `.conflict-` suffix, download remote
   - **skip**: Leave both unchanged
6. Choose delete missing option
7. Choose dry-run or execute

---

### Sync Profiles

#### Creating a Profile

1. Run `S3: Create Sync Profile`
2. Enter profile name (e.g., "Website Deployment")
3. Select local directory
4. Enter S3 bucket name
5. Enter prefix (optional)
6. Enter AWS region
7. Select sync direction:
   - **upload**: Local → S3
   - **download**: S3 → Local
   - **bidirectional**: Two-way sync
8. Select conflict resolution strategy
9. Choose delete missing option
10. Profile saved for future use

#### Running a Profile

1. Run `S3: Run Sync Profile`
2. Select profile from list
3. Choose "Execute sync" or "Preview only (dry run)"
4. Progress and summary displayed
5. Profile's `lastSyncAt` timestamp updated (if not dry-run)

#### Editing a Profile

1. Run `S3: Edit Sync Profile`
2. Select profile to edit
3. Update fields as needed
4. Changes saved

#### Deleting a Profile

1. Run `S3: Delete Sync Profile`
2. Select profile to delete
3. Confirm deletion
4. Profile removed

---

### Watch Mode

#### Starting Watch Mode

1. Run `S3: Start Watch Mode`
2. Select local directory to watch (or choose from saved profile)
3. Enter S3 bucket and prefix
4. Status bar shows `🔄 S3 Watch: [profile name]`
5. Any file changes in watched directory are automatically uploaded to S3
6. 500ms debounce prevents redundant uploads from rapid changes

#### Stopping Watch Mode

1. Click the watch mode indicator in status bar
2. Or run `S3: Stop Watch Mode`
3. Status bar indicator removed
4. File watching stopped

#### Viewing Sync Results

1. Run `S3: View Sync Results`
2. Output channel opens with:
   - Sync status (completed/cancelled/failed)
   - Counts: uploaded, downloaded, deleted, skipped, conflicts
   - Detailed error log (if any errors occurred)

---

## Testing

### Unit Tests

Run all unit tests:

```bash
pnpm test
```

Run specific test suite:

```bash
pnpm test -- sync-service
pnpm test -- validation
pnpm test -- credential-provider
```

Run tests in watch mode (auto-rerun on changes):

```bash
pnpm test -- --watch
```

**Expected output:**
```
Test Suites: 15 passed, 2 skipped, 17 total
Tests:       164 passed, 9 skipped, 173 total
```

### Property-Based Tests

Property tests use **fast-check** to verify universal correctness across randomized inputs. They run automatically with `pnpm test`.

Run only property tests:

```bash
pnpm test -- property
```

**Properties tested:**
1. Checksum round-trip correctness
2. ETag normalization strips quotes
3. Multipart ETags never compared as MD5
4. Prefix scope enforcement
5. Bucket name validation
6. ARN parsing round-trip
7. Exclude pattern filtering consistency
8. Dry-run produces zero mutations
9. Conflict classification exhaustive
10. Presigned URL expiry validation
11. Object key UTF-8 length validation
12. Prefix normalization idempotency

### E2E Tests with LocalStack

E2E tests require **LocalStack** running locally to simulate AWS S3.

#### Step 1: Start LocalStack

Create a `docker-compose.yml` file in the project root:

```yaml
version: '3.8'
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3
      - DEBUG=1
      - DEFAULT_REGION=us-east-1
```

Start LocalStack:

```bash
docker-compose up -d
```

Verify LocalStack is running:

```bash
curl http://localhost:4566/_localstack/health
```

#### Step 2: Compile E2E Tests

```bash
pnpm run compile:e2e
```

#### Step 3: Run E2E Tests

Run all E2E tests:

```bash
pnpm run test:e2e
```

Run specific E2E test:

```bash
pnpm run test:e2e -- --testNamePattern="Full Sync Round-Trip"
pnpm run test:e2e -- --testNamePattern="Incremental Sync"
pnpm run test:e2e -- --testNamePattern="Prefix Enforcement"
pnpm run test:e2e -- --testNamePattern="Watch Mode"
```

Run E2E tests in CI mode:

```bash
pnpm run test:e2e:ci
```

**E2E Test Suites:**

| Test File | Description |
|-----------|-------------|
| `sync-roundtrip.e2e.test.ts` | Full sync round-trip: upload → verify → download → verify identical |
| `incremental-sync.e2e.test.ts` | Incremental sync: only modified files are transferred |
| `prefix-enforcement.e2e.test.ts` | Prefix enforcement: operations respect prefix scope |
| `watch-mode.e2e.test.ts` | Watch mode: auto-upload on file changes with debounce |

#### Step 4: Stop LocalStack

```bash
docker-compose down
```

---

## Configuration

### AWS Credentials

The extension supports multiple credential sources in the following priority order:

1. **Environment Variables** (highest priority)
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_SESSION_TOKEN` (optional)

2. **AWS Profile** (from `~/.aws/credentials`)
   - Use the "Select AWS Profile" command to choose a profile
   - The active profile is displayed in the status bar

3. **VS Code SecretStorage** (encrypted storage)
   - Enter credentials manually when prompted
   - Stored securely in VS Code's encrypted storage

4. **IAM Roles** (lowest priority)
   - Automatically detected on EC2/ECS instances

#### Selecting an AWS Profile

1. Click the AWS profile indicator in the status bar, or
2. Open Command Palette and run `S3: Select AWS Profile`
3. Choose from available profiles or enter credentials manually

---

## AWS Credentials

### Configuring AWS CLI Profile

If you have AWS CLI installed:

```bash
# Configure a profile
aws configure --profile my-profile

# Enter:
# AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name: us-east-1
# Default output format: json
```

The extension will automatically detect this profile.

### Using Environment Variables

```bash
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

Then restart VS Code.

---

## IAM Permissions

### Minimum IAM Permissions (Core Functionality)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::bucket-name",
        "arn:aws:s3:::bucket-name/*"
      ]
    }
  ]
}
```

### Optional Permissions (Enhanced Functionality)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketVersioning",
        "s3:GetBucketPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

**Note:** Without `s3:ListAllMyBuckets`, you can still use the extension by manually adding buckets by name, ARN, or prefix.

### Prefix-Level Access (Shared Buckets)

For shared buckets where you only have access to a specific prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::bucket-name",
        "arn:aws:s3:::bucket-name/team-data/*"
      ]
    }
  ]
}
```

When adding the bucket, use **Add Bucket with Prefix** and enter `team-data/` as the prefix.

---

## Troubleshooting

### "Access Denied" Errors

**Symptom:** You see `AccessDeniedException` errors.

**Solutions:**
1. Check that your IAM user/role has the required permissions (see IAM Permissions section)
2. Verify your credentials are correctly configured
3. Check the Output panel (View → Output → "S3 Management Tool") for detailed error messages
4. Test your credentials with AWS CLI: `aws s3 ls s3://bucket-name`

### "Bucket Not Found" Errors

**Symptom:** You get `NoSuchBucket` errors.

**Solutions:**
1. Verify the bucket name is correct
2. Ensure the bucket exists in the selected AWS region
3. Check that you have `s3:ListBucket` permission

### Sync Not Transferring Files

**Symptom:** Files are not being uploaded/downloaded during sync.

**Solutions:**
1. Check that the local directory path is correct
2. Verify the S3 bucket name and prefix are correct
3. Check exclude patterns are not filtering your files
4. Run sync in **dry-run mode** first to preview changes
5. Check the Output panel for error details

### Watch Mode Not Working

**Symptom:** File changes are not being uploaded to S3.

**Solutions:**
1. Verify watch mode is active (check status bar indicator)
2. Ensure the watched directory path is correct
3. Check that file changes are saved (not just opened in editor)
4. Wait for the 500ms debounce window
5. Check Output panel for upload errors

### Network Errors

**Symptom:** Connection timeouts or DNS errors.

**Solutions:**
1. Check your internet connection
2. Verify firewall settings allow AWS S3 access
3. Check if you need to configure a proxy
4. Verify AWS service status at https://status.aws.amazon.com/

### Credential Issues

**Symptom:** Credentials are not working.

**Solutions:**
1. Verify credentials are valid using AWS CLI: `aws sts get-caller-identity`
2. Check the active profile in the status bar
3. Try manually entering credentials via `S3: Select AWS Profile` → "Enter Credentials Manually"
4. Ensure credentials have not expired

### TypeScript Compilation Errors

**Symptom:** `pnpm run compile` fails with TypeScript errors.

**Solutions:**
```bash
# Clean and recompile
rm -rf out/
pnpm run compile

# Check for type errors without emitting
npx tsc --noEmit
```

### Test Failures

**Symptom:** Tests are failing.

**Solutions:**
```bash
# Run tests with verbose output
pnpm test -- --verbose

# Run specific failing test
pnpm test -- sync-service

# Clear Jest cache
pnpm test -- --clearCache
```

---

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm run compile` | Compile TypeScript |
| `pnpm run compile:e2e` | Compile E2E tests |
| `pnpm run watch` | Watch mode (auto-compile on changes) |
| `pnpm test` | Run all unit tests |
| `pnpm test:unit` | Run unit tests only |
| `pnpm run test:e2e` | Run E2E tests (requires LocalStack) |
| `pnpm run test:e2e:ci` | Run E2E tests in CI mode |
| `pnpm run bundle` | Bundle extension with esbuild |
| `pnpm run package` | Package as .vsix file |

---

## Architecture

### Service Layer

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension Host                │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │           extension-standalone.ts                │  │
│  │         (Entry Point & Wiring)                   │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
│         ┌───────────────┼───────────────┐               │
│         ▼               ▼               ▼               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ Credential  │ │   Bucket    │ │    S3       │       │
│  │  Provider   │ │  Storage    │ │  Service    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│         │               │               │               │
│         ▼               │               │               │
│  ┌─────────────┐        │               │               │
│  │    S3       │        │               │               │
│  │   Client    │        │               │               │
│  │  Factory    │        │               │               │
│  └─────────────┘        │               │               │
│                         │               │               │
│                  ┌──────┴──────┐         │               │
│                  │             │         │               │
│           ┌─────────────┐ ┌─────────────┐               │
│           │    Sync     │ │     S3      │               │
│           │  Service    │ │   Tree      │               │
│           │             │ │  Provider   │               │
│           └─────────────┘ └─────────────┘               │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │    AWS S3 API       │
              │  (or LocalStack)    │
              └─────────────────────┘
```

### Data Flow

1. **User Action** → Command Palette or Tree View
2. **Command Handler** → Validates input, calls service
3. **Service Layer** → Executes AWS operations
4. **AWS SDK** → Communicates with S3 API
5. **Response** → Updates UI, shows notification

### Credential Security

- Credentials are **never** exposed to webview panels
- All outbound webview messages pass through `sanitizeForWebview()`
- Credentials stored in VS Code's **SecretStorage** (encrypted)
- AWS SDK clients are recreated on credential changes

---

## Quick Start Examples

### Example 1: Deploy Static Website

```bash
# 1. Build your website
pnpm run build

# 2. In VS Code:
#    - Run: S3: Create Sync Profile
#    - Name: "Website Deployment"
#    - Local: /path/to/dist/
#    - Bucket: my-website-bucket
#    - Prefix: production/
#    - Direction: upload
#
# 3. Deploy:
#    - Run: S3: Run Sync Profile
#    - Select: "Website Deployment"
#    - Choose: "Execute sync"
```

### Example 2: Download Shared Data

```bash
# 1. In VS Code:
#    - Run: S3: Add Bucket with Prefix
#    - Bucket: shared-data-bucket
#    - Prefix: team-data/
#    - Region: us-east-1
#
# 2. Expand bucket in tree view
# 3. Right-click on files/folders → Download Object
```

### Example 3: Real-Time Development Sync

```bash
# 1. In VS Code:
#    - Run: S3: Start Watch Mode
#    - Select: /path/to/project/dist/
#    - Bucket: dev-bucket
#    - Prefix: latest/
#
# 2. Status bar shows: "🔄 S3 Watch: Active"
# 3. Any changes to dist/ are auto-uploaded to S3
# 4. Stop: Click status bar indicator or run: S3: Stop Watch Mode
```

---

## Support

For issues, feature requests, or contributions:

- **GitHub Repository**: https://github.com/chailu2000/s3-management-tool
- **Issues**: https://github.com/chailu2000/s3-management-tool/issues
- **Spec Files**: `.kiro/specs/s3-management-tool/`

---

## License

MIT License - See LICENSE for details.

---

## Changelog

See CHANGELOG.md for release history.
