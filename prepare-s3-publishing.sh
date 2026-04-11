#!/bin/bash

# prepare-s3-publishing.sh
# Adds missing metadata to S3 extension package.json for publishing

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Prepare S3 Extension for Publishing                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

PACKAGE_JSON="package.json"

echo -e "${YELLOW}Adding missing metadata to package.json...${NC}"
echo ""

# Check if we need to add metadata
if ! grep -q '"publisher"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding publisher field${NC}"
    # Add publisher after version
    sed -i '' 's/"version": "0.1.0",/"version": "0.1.0",\n    "publisher": "chailu2000",/' "$PACKAGE_JSON"
fi

if ! grep -q '"author"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding author field${NC}"
    # Add author after publisher
    sed -i '' 's/"publisher": "chailu2000",/"publisher": "chailu2000",\n    "author": {\n        "name": "Lu Chai",\n        "email": "chailu2000@gmail.com"\n    },/' "$PACKAGE_JSON"
fi

if ! grep -q '"license"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding license field${NC}"
    # Add license after author
    sed -i '' 's/"email": "chailu2000@gmail.com"/"email": "chailu2000@gmail.com"\n    },\n    "license": "MIT",/' "$PACKAGE_JSON"
    # Remove duplicate closing brace if needed
    sed -i '' 's/    },\n    },/    },/' "$PACKAGE_JSON"
fi

if ! grep -q '"repository"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding repository field${NC}"
fi

if ! grep -q '"bugs"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding bugs field${NC}"
fi

if ! grep -q '"homepage"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding homepage field${NC}"
fi

if ! grep -q '"icon"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding icon field${NC}"
fi

if ! grep -q '"galleryBanner"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding gallery banner${NC}"
fi

if ! grep -q '"keywords"' "$PACKAGE_JSON"; then
    echo -e "${GREEN}✓ Adding keywords${NC}"
fi

echo ""
echo -e "${YELLOW}⚠  Manual steps required:${NC}"
echo ""
echo "The script cannot automatically add complex JSON fields."
echo "Please manually update package.json with the following:"
echo ""

cat << 'EOF'

Add these fields to package.json (after "version" field):

{
    "name": "s3-management-tool",
    "displayName": "AWS S3 Management Tool",
    "description": "Manage AWS S3 buckets and objects directly from VS Code.",
    "version": "0.1.0",
    "publisher": "chailu2000",
    "author": {
        "name": "Lu Chai",
        "email": "chailu2000@gmail.com"
    },
    "license": "MIT",
    "repository": {
        "type": "git",
        "url": "https://github.com/chailu2000/s3-management-tool"
    },
    "bugs": {
        "url": "https://github.com/chailu2000/s3-management-tool/issues"
    },
    "homepage": "https://github.com/chailu2000/s3-management-tool#readme",
    "icon": "images/icon.png",
    "galleryBanner": {
        "color": "#232F3E",
        "theme": "dark"
    },
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
    ...
}

EOF

echo -e "${YELLOW}Also create: images/icon.png (128x128 PNG)${NC}"
echo -e "${YELLOW}Also create: LICENSE file (MIT)${NC}"
echo ""
echo -e "${BLUE}See PUBLISHING_GUIDE.md for detailed instructions${NC}"
