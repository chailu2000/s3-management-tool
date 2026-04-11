# S3 Management Tool - Publishing Guide

## Step-by-Step Guide to Publish to VS Code Marketplace

### Prerequisites Checklist

- [ ] Node.js and pnpm installed
- [ ] VS Code installed
- [ ] AWS credentials configured (for testing)
- [ ] Microsoft account (Outlook/Hotmail/Live)
- [ ] Azure DevOps organization created

---

## Phase 1: Install vsce (VS Code Extension Manager)

```bash
cd /Users/luindc22203/workspace/s3-management-tool

# Install vsce globally
pnpm add -g @vscode/vsce

# Verify installation
vsce --version
```

---

## Phase 2: Create Azure DevOps Personal Access Token (PAT)

If you already have a PAT, skip to Phase 3.

### Steps:

1. Go to https://dev.azure.com/
2. Sign in with your Microsoft account
3. Create an organization if you don't have one (use any name, e.g., "chai2000-dev")
4. Click on **User settings** (gear icon in top right) → **Personal access tokens**
5. Click **New Token**
6. Configure:
   - **Name**: `vscode-publishing`
   - **Organization**: All accessible organizations
   - **Expiration**: 90 days (or custom date)
   - **Scopes**: Click "Custom defined" → Select **Marketplace** → Check **Manage**
7. Click **Create**
8. **IMPORTANT**: Copy the PAT immediately - you won't see it again!

---

## Phase 3: Login to VS Code Marketplace

```bash
# Login with your publisher ID
vsce login chailu2000

# You'll be prompted for the PAT you just created
# Paste it and press Enter
```

**Alternative**: You can use the PAT directly in commands:
```bash
vsce publish -p YOUR_PAT_HERE
```

---

## Phase 4: Prepare the Extension

### 1. Update package.json (if needed)

Check these fields in `package.json`:

```json
{
  "name": "s3-management-tool",
  "displayName": "AWS S3 Management Tool",
  "description": "Manage AWS S3 buckets and objects directly from VS Code.",
  "version": "0.1.0",  // Increment for each publish
  "publisher": "chailu2000",  // Your publisher ID
  "author": {
    "name": "Lu Chai",
    "email": "chailu2000@gmail.com"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/chailu2000/s3-management-tool"
  },
  "icon": "images/icon.png",  // Make sure this exists!
  "galleryBanner": {
    "color": "#232F3E",
    "theme": "dark"
  }
}
```

### 2. Create/Verify Icon

You need a 128x128 PNG icon at `images/icon.png`.

If it doesn't exist:
```bash
# Create images directory
mkdir -p images

# Create a simple icon (you should replace this with a proper S3 icon)
# Recommended: Create a custom icon using Canva, Figma, or hire a designer
```

### 3. Add Missing Metadata to package.json

Add these fields if they don't exist:

```json
{
  "keywords": [
    "aws",
    "s3",
    "storage",
    "amazon",
    "cloud",
    "devops",
    "file manager",
    "bucket",
    "sync",
    "upload",
    "download"
  ],
  "categories": [
    "Other"
  ],
  "bugs": {
    "url": "https://github.com/chailu2000/s3-management-tool/issues"
  },
  "homepage": "https://github.com/chailu2000/s3-management-tool#readme"
}
```

---

## Phase 5: Build and Package

### 1. Install Dependencies

```bash
cd /Users/luindc22203/workspace/s3-management-tool
pnpm install
```

### 2. Compile TypeScript

```bash
pnpm run compile
```

### 3. Bundle with esbuild (for production)

```bash
pnpm run bundle
```

### 4. Package into VSIX

```bash
# Package (creates a .vsix file)
vsce package --no-dependencies

# This will create: s3-management-tool-0.1.0.vsix
```

### 5. Test Locally (Recommended)

```bash
# Install the VSIX in your VS Code
code --install-extension s3-management-tool-0.1.0.vsix

# Open VS Code and test the extension:
# - Check if S3 Buckets view appears in Explorer
# - Try adding a bucket
# - Verify all commands work
```

---

## Phase 6: Publish to Marketplace

### Option 1: Using vsce publish (Interactive)

```bash
vsce publish --no-dependencies
```

### Option 2: Using PAT directly

```bash
vsce publish -p YOUR_PAT_HERE --no-dependencies
```

### What Happens:
1. vsce validates the package
2. Uploads to VS Code Marketplace
3. Microsoft validates it (usually within 1-2 hours)
4. You'll receive an email confirmation

---

## Phase 7: Verify Publication

1. Go to https://marketplace.visualstudio.com/
2. Search for "AWS S3 Management Tool"
3. Or go directly to: https://marketplace.visualstudio.com/items?itemName=chailu2000.s3-management-tool

---

## Updating the Extension

To publish a new version:

### 1. Increment version in package.json

```json
{
  "version": "0.2.0"  // Change this
}
```

### 2. Update CHANGELOG.md

Add release notes for the new version.

### 3. Rebuild and Republish

```bash
pnpm install
pnpm run compile
pnpm run bundle
vsce package --no-dependencies
vsce publish --no-dependencies
```

---

## Troubleshooting

### Error: "The extension 'chailu2000.s3-management-tool' already exists"

You need to increment the version number in `package.json`.

### Error: "Icon file not found"

Make sure `images/icon.png` exists and is 128x128 pixels.

### Error: "PAT expired"

Generate a new Personal Access Token from Azure DevOps.

### Error: "No publisher found"

Make sure the `publisher` field is set in `package.json`.

### Marketplace validation takes too long

Usually takes 1-2 hours. Check your email for status updates.

---

## Capture Screenshots for README

Since this is a VS Code extension, you need to manually capture screenshots:

### Method 1: Manual Screenshots (Recommended)

1. **Start Extension Host**:
   ```bash
   cd /Users/luindc22203/workspace/s3-management-tool
   code .
   ```

2. Press **F5** to launch Extension Development Host

3. Test the extension with LocalStack or real AWS

4. Take screenshots using macOS screenshot shortcuts:
   - **Full screen**: `Cmd + Shift + 3`
   - **Selected area**: `Cmd + Shift + 4`
   - **Window**: `Cmd + Shift + 4`, then `Space`

5. Save to: `docs/screenshots/`

### Recommended Screenshots to Capture:

1. **Main tree view** - S3 bucket with files/folders
2. **Context menu** - Right-click showing available actions
3. **Upload dialog** - File upload interface
4. **Sync panel** - Sync configuration
5. **Preview window** - Object content preview
6. **Settings** - AWS profile selection

### Method 2: Using LocalStack for Demo

```bash
# Start LocalStack
docker-compose up -d

# Create test buckets and files
aws --endpoint-url=http://localhost:4566 s3 mb s3://demo-bucket
echo "Hello World" > test.txt
aws --endpoint-url=http://localhost:4566 s3 cp test.txt s3://demo-bucket/

# Use LocalStack profile in VS Code and capture screenshots
```

---

## Quick Reference Commands

```bash
# Navigate to extension directory
cd s3-management-tool

# Install dependencies
pnpm install

# Compile
pnpm run compile

# Bundle
pnpm run bundle

# Package
vsce package --no-dependencies

# Test locally
code --install-extension s3-management-tool-0.1.0.vsix

# Publish
vsce publish --no-dependencies
```

---

## Next Steps After Publishing

1. **Add to README**: Update the main README.md with installation instructions from Marketplace
2. **Share**: Post on Twitter, Reddit, AWS communities
3. **Gather feedback**: Monitor issues and reviews
4. **Iterate**: Release updates based on feedback

---

## Support

- VS Code Extension Publishing Docs: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Azure DevOps: https://dev.azure.com/
- Marketplace: https://marketplace.visualstudio.com/
