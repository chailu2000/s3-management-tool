# S3 Extension Publishing Checklist ✅

## Status: Ready for Manual Steps

---

## ✅ Completed (Automated)

- [x] Added publisher field (`chailu2000`)
- [x] Added author information (Lu Chai)
- [x] Added license field (MIT)
- [x] Added repository URLs
- [x] Added bugs URL
- [x] Added homepage URL
- [x] Added icon path reference
- [x] Added gallery banner colors (AWS dark blue theme)
- [x] Added comprehensive keywords
- [x] Set categories to ["Other"]
- [x] Created LICENSE file (MIT)

---

## ⚠️ Manual Steps Required

### 1. Create Extension Icon (Required)

You need a 128x128 PNG icon at: `images/icon.png`

**Options:**

#### Option A: Use Canva (Easiest - 15 minutes)
1. Go to https://www.canva.com/
2. Create a 128x128 design
3. Use S3 bucket icon + your branding
4. Export as PNG
5. Save to: `images/icon.png`

#### Option B: Download from Flaticon (10 minutes)
1. Go to https://www.flaticon.com/
2. Search "S3 bucket" or "cloud storage"
3. Download PNG (128x128 or larger)
4. Save to: `images/icon.png`

#### Option C: Design in Figma (30 minutes)
1. Create 128x128 frame
2. Design custom icon
3. Export as PNG

#### Option D: Use AWS S3 Logo (Quick but check licensing)
1. Download from AWS brand resources
2. Ensure you have permission to use it
3. Save to: `images/icon.png`

---

### 2. Set Up Azure DevOps (15-20 minutes)

#### Step 1: Create Microsoft Account
- Use existing Outlook/Hotmail/Live account OR create new one

#### Step 2: Create Azure DevOps Organization
1. Go to https://dev.azure.com/
2. Click "Create organization"
3. Follow the wizard (organization name: e.g., "chai2000-dev")

#### Step 3: Create Personal Access Token (PAT)
1. Go to https://dev.azure.com/chai2000 (replace with your org)
2. Click **User settings** (gear icon, top right)
3. Select **Personal access tokens**
4. Click **New Token**
5. Configure:
   - **Name**: `vscode-publishing`
   - **Organization**: All accessible organizations
   - **Expiration**: 90 days
   - **Scopes**: Custom defined → **Marketplace** → **Manage** ✓
6. Click **Create**
7. **COPY THE TOKEN IMMEDIATELY** - you won't see it again!

#### Step 4: Create Publisher (if not exists)
1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your Microsoft account
3. Create a publisher:
   - **Publisher ID**: `chailu2000` (must match package.json)
   - **Display name**: `Lu Chai`
   - **Email**: `chailu2000@gmail.com`

---

### 3. Capture Screenshots for README (30 minutes)

Since this is a VS Code extension, you need to manually capture screenshots.

#### Setup for Screenshots

**Option A: Use LocalStack (Recommended for demo)**

```bash
# Start LocalStack
cd /Users/luindc22203/workspace/s3-management-tool
docker-compose up -d

# Create demo bucket
aws --endpoint-url=http://localhost:4566 s3 mb s3://my-demo-bucket

# Upload some sample files
echo '{"name": "John", "age": 30}' > user.json
aws --endpoint-url=http://localhost:4566 s3 cp user.json s3://my-demo-bucket/data/user.json

echo '<h1>Hello World</h1>' > index.html
aws --endpoint-url=http://localhost:4566 s3 cp index.html s3://my-demo-bucket/website/index.html

# Create AWS profile for LocalStack
cat >> ~/.aws/credentials << EOF
[localstack]
aws_access_key_id = test
aws_secret_access_key = test
EOF

cat >> ~/.aws/config << EOF
[profile localstack]
region = us-east-1
endpoint_url = http://localhost:4566
EOF
```

**Option B: Use Real AWS Account**

Use your actual AWS account with real S3 buckets.

#### Capture Screenshots

1. **Open the extension in VS Code**:
   ```bash
   cd /Users/luindc22203/workspace/s3-management-tool
   code .
   ```

2. **Start Extension Host**:
   - Press `F5`
   - A new VS Code window opens with the extension loaded

3. **Configure AWS Profile**:
   - `Cmd+Shift+P` → "Select AWS Profile"
   - Choose `localstack` or your AWS profile

4. **Add Bucket**:
   - `Cmd+Shift+P` → "Add Bucket by Name"
   - Enter: `my-demo-bucket`

5. **Capture these screenshots** (using `Cmd+Shift+4`):

   **Screenshot 1: Main Tree View**
   - Expand the bucket to show folders/files
   - Shows the core UI
   - Save as: `docs/screenshots/01-main-tree-view.png`

   **Screenshot 2: Context Menu**
   - Right-click on a file
   - Shows available actions (Preview, Download, etc.)
   - Save as: `docs/screenshots/02-context-menu.png`

   **Screenshot 3: Object Preview**
   - Right-click file → "Preview Content"
   - Shows file content in editor
   - Save as: `docs/screenshots/03-object-preview.png`

   **Screenshot 4: Upload Dialog**
   - Right-click folder → "Upload Object"
   - Shows file selection dialog
   - Save as: `docs/screenshots/04-upload-dialog.png`

   **Screenshot 5: Bucket Info**
   - Right-click bucket → "Bucket Info"
   - Shows bucket details panel
   - Save as: `docs/screenshots/05-bucket-info.png`

   **Screenshot 6: Multi-Select**
   - Select multiple files with Ctrl+Click
   - Shows batch operations
   - Save as: `docs/screenshots/06-multi-select.png`

6. **Save screenshots** to: `docs/screenshots/`

---

### 4. Build and Test (10-15 minutes)

```bash
cd /Users/luindc22203/workspace/s3-management-tool

# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Bundle for production
pnpm run bundle

# Package into VSIX
pnpm add -g @vscode/vsce
vsce package --no-dependencies

# Test locally
code --install-extension s3-management-tool-0.1.0.vsix
```

**Test checklist:**
- [ ] S3 Buckets view appears in Explorer
- [ ] Can add bucket by name
- [ ] Can view files/folders in tree
- [ ] Can preview file content
- [ ] Context menus work
- [ ] Commands work from Command Palette

---

### 5. Publish to Marketplace (5 minutes)

```bash
# Login to marketplace
vsce login chailu2000
# Enter your PAT when prompted

# Publish!
vsce publish --no-dependencies
```

**What happens next:**
1. vsce validates the package (1 minute)
2. Uploads to VS Code Marketplace (1 minute)
3. Microsoft validates it (1-2 hours)
4. You receive email confirmation
5. Extension appears in Marketplace!

---

## Quick Commands Reference

```bash
# Navigate to extension
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
vsce login chailu2000
vsce publish --no-dependencies
```

---

## Estimated Time

| Task | Time |
|------|------|
| Create icon | 15-30 min |
| Azure DevOps setup | 15-20 min |
| Capture screenshots | 30 min |
| Build and test | 10-15 min |
| Publish | 5 min |
| **Total** | **1.5-2 hours** |

---

## Files Created

- ✅ `PUBLISHING_GUIDE.md` - Comprehensive step-by-step guide
- ✅ `LICENSE` - MIT license
- ✅ `package.json` - Updated with all required metadata
- ✅ `docs/screenshots/` - Directory for screenshots
- ✅ `capture-s3-screenshots.sh` - Screenshot capture helper

---

## What You Need to Do

1. **Create icon** → `images/icon.png` (128x128 PNG)
2. **Set up Azure DevOps** → Get PAT token
3. **Capture screenshots** → Follow guide above
4. **Build and test** → Run commands above
5. **Publish!** → `vsce publish`

---

## After Publishing

1. **Update README.md** with:
   - Installation instructions from Marketplace
   - Screenshots you captured
   - Link to marketplace listing

2. **Share the extension**:
   - Twitter/LinkedIn
   - Reddit (r/aws, r/devops)
   - AWS Developer Forums
   - Dev.to, Medium articles

3. **Monitor**:
   - GitHub issues
   - Marketplace reviews
   - Usage metrics

4. **Iterate**:
   - Release v0.2.0 with improvements
   - Add features based on feedback

---

## Troubleshooting

### "Icon file not found"
- Make sure `images/icon.png` exists
- Must be PNG format, 128x128 pixels

### "Publisher not found"
- Make sure `publisher` field in package.json matches your Azure DevOps publisher ID
- Must create publisher at https://marketplace.visualstudio.com/manage

### "PAT expired"
- Generate new token at Azure DevOps
- Update with: `vsce login chailu2000`

### "Extension already exists"
- Increment version number in package.json
- `"version": "0.2.0"`

### Marketplace validation takes too long
- Usually 1-2 hours
- Check email for status
- If rejected, fix issues and republish

---

## Support Resources

- VS Code Extension Docs: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- vsce CLI: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#vsce
- Azure DevOps: https://dev.azure.com/
- VS Code Marketplace: https://marketplace.visualstudio.com/

---

**Status**: ✅ All automated tasks complete!
**Next**: Complete the manual steps above to publish 🚀
