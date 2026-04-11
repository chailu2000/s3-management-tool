/**
 * Shared file-system utilities used by sync, upload, and drag-drop features.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Directory walking
// ---------------------------------------------------------------------------

export interface LocalFile {
    absolutePath: string;
    relativePath: string;  // relative to the chosen root directory
}

/**
 * Recursively walks a directory and returns all files with their
 * absolute path and path relative to the given root.
 */
export function walkDirectory(dir: string, root: string): LocalFile[] {
    const results: LocalFile[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDirectory(abs, root));
        } else if (entry.isFile()) {
            results.push({
                absolutePath: abs,
                relativePath: path.relative(root, abs),
            });
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// Checksum helpers
// ---------------------------------------------------------------------------

/**
 * Computes the MD5 hash of a local file and returns it as a hex string.
 */
export function computeLocalMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Strips surrounding double-quotes from an S3 ETag.
 * S3 returns ETags wrapped in double-quotes, e.g. `"abc123"`.
 */
export function normalizeEtag(etag: string): string {
    return etag.replace(/^"(.*)"$/, '$1');
}

/**
 * Returns true if the ETag represents a multipart upload.
 * Multipart ETags contain a '-' followed by the part count, e.g. "abc123-5".
 */
export function isMultipartEtag(etag: string): boolean {
    return normalizeEtag(etag).includes('-');
}
