/**
 * Command: Display Bucket Info
 *
 * Opens a webview panel showing bucket name, region, versioning status,
 * bucket policy, and configured prefix scope.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3BucketItem } from '../views/s3-tree-provider';
import { VersioningStatus } from '../models/s3-models';

export async function bucketInfo(
    item: S3BucketItem,
    s3Service: S3Service,
): Promise<void> {
    const { name, region, prefix } = item.config;

    // Fetch versioning and policy in parallel — each catches its own errors
    const [versioning, policy] = await Promise.allSettled([
        s3Service.getBucketVersioning(name),
        s3Service.getBucketPolicy(name),
    ]);

    const versioningStatus = versioning.status === 'fulfilled'
        ? versioning.value
        : 'Unknown' as VersioningStatus;

    const policyText = policy.status === 'fulfilled'
        ? (policy.value ? formatJson(policy.value) : null)
        : null;

    const panel = vscode.window.createWebviewPanel(
        's3BucketInfo',
        `Bucket Info: ${name}`,
        vscode.ViewColumn.One,
        { enableScripts: false },
    );

    panel.webview.html = buildHtml({
        name,
        region,
        prefix: prefix ?? '',
        versioningStatus,
        policyText,
        addedManually: item.config.addedManually,
    });
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

interface BucketInfoData {
    name: string;
    region: string;
    prefix: string;
    versioningStatus: VersioningStatus;
    policyText: string | null;
    addedManually: boolean;
}

function buildHtml(data: BucketInfoData): string {
    const versioningBadge = versioningBadgeHtml(data.versioningStatus);
    const policySection = data.policyText
        ? `<details><summary class="details-summary">Bucket Policy</summary><pre class="policy-json">${esc(data.policyText)}</pre></details>`
        : `<p class="muted">— No policy or access denied —</p>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 16px;
    max-width: 700px;
  }
  h2 { margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.label { font-weight: bold; width: 200px; color: var(--vscode-descriptionForeground); }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }
  .badge-enabled { background: #1a7f37; color: #fff; }
  .badge-suspended { background: #9a6700; color: #fff; }
  .badge-notenabled { background: var(--vscode-badge-background); color: var(--vscode-foreground); }
  .badge-unknown { background: var(--vscode-badge-background); color: var(--vscode-descriptionForeground); }
  .policy-json {
    background: var(--vscode-textCodeBlock-background);
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.5;
  }
  .muted { color: var(--vscode-descriptionForeground); font-style: italic; }
  .details-summary { cursor: pointer; font-weight: bold; margin-bottom: 8px; }
  .details-summary:hover { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
<h2>🪣 Bucket Info</h2>
<table>
  <tr><td class="label">Bucket Name</td><td>${esc(data.name)}</td></tr>
  <tr><td class="label">Region</td><td>${esc(data.region)}</td></tr>
  <tr><td class="label">Versioning</td><td>${versioningBadge}</td></tr>
  <tr><td class="label">Prefix Scope</td><td>${esc(data.prefix || '—')}</td></tr>
  <tr><td class="label">Added Manually</td><td>${data.addedManually ? 'Yes' : 'No (auto-discovered)'}</td></tr>
</table>
<h3>Bucket Policy</h3>
${policySection}
</body>
</html>`;
}

function versioningBadgeHtml(status: VersioningStatus): string {
    const cls = `badge badge-${status.toLowerCase()}`;
    return `<span class="${cls}">${esc(status)}</span>`;
}

function formatJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
