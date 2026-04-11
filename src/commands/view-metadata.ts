/**
 * Command: View object metadata
 * Requirements: 11.1, 11.2, 11.3
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem } from '../views/s3-tree-provider';
import { ObjectMetadata } from '../models/s3-models';

export async function viewMetadata(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void> {
    let metadata: ObjectMetadata;
    try {
        metadata = await s3Service.headObject(item.bucket, item.key, item.region);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to get metadata for "${item.key}": ${msg}`);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        's3ObjectMetadata',
        `Metadata: ${item.key}`,
        vscode.ViewColumn.One,
        { enableScripts: false },
    );

    panel.webview.html = buildHtml(metadata);
}

function buildHtml(meta: ObjectMetadata): string {
    const userMetaRows = Object.entries(meta.userMetadata)
        .map(([k, v]) => `<tr><td class="label">x-amz-meta-${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.label { font-weight: bold; width: 200px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h2>Object Metadata</h2>
<table>
  <tr><td class="label">Key</td><td>${esc(meta.key)}</td></tr>
  <tr><td class="label">Size</td><td>${formatSize(meta.size)}</td></tr>
  <tr><td class="label">Last Modified</td><td>${esc(meta.lastModified.toISOString())}</td></tr>
  <tr><td class="label">Content Type</td><td>${esc(meta.contentType ?? '—')}</td></tr>
  <tr><td class="label">ETag</td><td>${esc(meta.etag)}</td></tr>
  <tr><td class="label">Storage Class</td><td>${esc(meta.storageClass ?? 'STANDARD')}</td></tr>
  ${userMetaRows}
</table>
</body>
</html>`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}
