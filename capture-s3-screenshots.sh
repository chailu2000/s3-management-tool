#!/bin/bash

# capture-s3-screenshots.sh
# Helper script to prepare S3 extension for screenshot capture

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   S3 Extension Screenshot Capture Guide                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Create screenshots directory
SCREENSHOT_DIR="../docs/screenshots"
mkdir -p "$SCREENSHOT_DIR"

echo -e "${YELLOW}Step 1: Compile the extension${NC}"
echo -e "   ${GREEN}cd /Users/luindc22203/workspace/s3-management-tool${NC}"
echo -e "   ${GREEN}pnpm install && pnpm run compile${NC}"
echo ""

echo -e "${YELLOW}Step 2: Open VS Code and start Extension Host${NC}"
echo -e "   ${GREEN}code /Users/luindc22203/workspace/s3-management-tool${NC}"
echo ""
echo -e "${YELLOW}   Then press F5 to launch Extension Development Host${NC}"
echo ""

echo -e "${YELLOW}Step 3: Test with LocalStack (optional)${NC}"
echo -e "   If you want real data for screenshots:"
echo -e "   ${GREEN}./start-localstack-s3.sh${NC}"
echo -e "   ${GREEN}aws --endpoint-url=http://localhost:4566 s3 mb s3://demo-bucket${NC}"
echo -e "   ${GREEN}echo '{\"name\": \"test\", \"value\": 123}' | aws --endpoint-url=http://localhost:4566 s3 cp - s3://demo-bucket/data.json${NC}"
echo ""

echo -e "${YELLOW}Step 4: Capture Screenshots${NC}"
echo -e "   Use macOS shortcuts:"
echo -e "   - ${GREEN}Cmd + Shift + 4${NC} - Select area to screenshot"
echo -e "   - ${GREEN}Cmd + Shift + 4, then Space${NC} - Screenshot a window"
echo ""

echo -e "${YELLOW}Recommended screenshots to capture:${NC}"
echo ""
echo -e "   ${GREEN}1. Main tree view${NC}"
echo -e "      - S3 Buckets panel with expanded folder structure"
echo -e "      - Shows the extension's core functionality"
echo ""
echo -e "   ${GREEN}2. Context menu${NC}"
echo -e "      - Right-click on a file showing available actions"
echo -e "      - Preview, Rename, Download, Copy, etc."
echo ""
echo -e "   ${GREEN}3. Upload dialog${NC}"
echo -e "      - File/folder selection interface"
echo ""
echo -e "   ${GREEN}4. Sync configuration${NC}"
echo -e "      - Sync profile setup panel"
echo ""
echo -e "   ${GREEN}5. Object preview${NC}"
echo -e "      - Content preview in a VS Code editor tab"
echo ""
echo -e "   ${GREEN}6. Bucket info panel${NC}"
echo -e "      - Region, versioning, policy details"
echo ""

echo -e "${YELLOW}Step 5: Save screenshots${NC}"
echo -e "   Save captured screenshots to:"
echo -e "   ${GREEN}$SCREENSHOT_DIR/${NC}"
echo ""
echo -e "   Recommended naming:"
echo -e "   - 01-main-tree-view.png"
echo -e "   - 02-context-menu.png"
echo -e "   - 03-upload-dialog.png"
echo -e "   - 04-sync-config.png"
echo -e "   - 05-object-preview.png"
echo -e "   - 06-bucket-info.png"
echo ""

echo -e "${YELLOW}Step 6: Update README.md${NC}"
echo -e "   Add screenshots to README.md with:"
echo -e "   ${GREEN}![Main tree view](docs/screenshots/01-main-tree-view.png)${NC}"
echo ""

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Ready to capture!                                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Screenshots directory created:${NC} $SCREENSHOT_DIR"
echo ""
echo -e "${YELLOW}Next:${NC}"
echo "  1. Follow the steps above to capture screenshots"
echo "  2. Save them to the screenshots directory"
echo "  3. Update README.md to include them"
echo ""

# Show current screenshots
if [ -d "$SCREENSHOT_DIR" ]; then
    SCREENSHOT_COUNT=$(ls -1 "$SCREENSHOT_DIR"/*.png 2>/dev/null | wc -l)
    if [ "$SCREENSHOT_COUNT" -gt 0 ]; then
        echo -e "${GREEN}Existing screenshots:${NC}"
        ls -lh "$SCREENSHOT_DIR"/*.png 2>/dev/null
        echo ""
    fi
fi
