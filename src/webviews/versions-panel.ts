/**
 * Webview panel for displaying and managing object versions.
 *
 * Shows a table of all versions of an S3 object with actions:
 * Restore, Delete, Download.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '../services/s3-service';
import { ObjectVersion } from '../models/s3-models';

interface VersionsPanelArgs {
    bucket: string;
    key: string;
    region: string;
    s3Service: S3Service;
    treeProvider: { refresh: (item?: any) => void };
}

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------

export class VersionsPanel {
    private panel: vscode.WebviewPanel;
    private disposeHandler: vscode.Disposable;

    private constructor(
        extensionUri: vscode.Uri,
        private readonly args: VersionsPanelArgs,
        private readonly versions: ObjectVersion[],
    ) {
        this.panel = vscode.window.createWebviewPanel(
            's3ObjectVersions',
            `Versions: ${shortKey(args.key)}`,
            vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [] },
        );

        this.panel.webview.html = this.buildHtml(versions);

        this.disposeHandler = this.panel.onDidDispose(async () => {
            this.disposeHandler.dispose();
        });

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            await this.handleMessage(msg);
        });
    }

    // -----------------------------------------------------------------------
    // Static factory
    // -----------------------------------------------------------------------

    static async create(
        extensionUri: vscode.Uri,
        args: VersionsPanelArgs,
    ): Promise<VersionsPanel | null> {
        // Check versioning is enabled
        const status = await args.s3Service.getBucketVersioning(args.bucket);
        if (status !== 'Enabled') {
            vscode.window.showErrorMessage(
                `Versioning is not enabled for bucket "${args.bucket}". Cannot view versions.`,
            );
            return null;
        }

        const versions = await args.s3Service.listObjectVersions(
            args.bucket,
            args.key,
            args.region,
        );

        if (versions.length === 0) {
            vscode.window.showInformationMessage(`No versions found for "${args.key}".`);
            return null;
        }

        return new VersionsPanel(extensionUri, args, versions);
    }

    // -----------------------------------------------------------------------
    // Message handling
    // -----------------------------------------------------------------------

    private async handleMessage(msg: {
        command: string;
        versionId: string;
    }): Promise<void> {
        const { s3Service, bucket, key, region, treeProvider } = this.args;

        try {
            switch (msg.command) {
                case 'refresh': {
                    const updated = await s3Service.listObjectVersions(bucket, key, region);
                    this.versions.length = 0;
                    this.versions.push(...updated);
                    this.panel.webview.html = this.buildHtml(this.versions);
                    break;
                }

                case 'restore': {
                    const confirm = await vscode.window.showWarningMessage(
                        `Restore version ${shortId(msg.versionId)} of ${shortKey(key)}? This will overwrite the current object.`,
                        { modal: true },
                        'Restore',
                    );
                    if (!confirm) return;

                    await s3Service.restoreVersion(bucket, key, msg.versionId, region);
                    vscode.window.showInformationMessage(
                        `Restored version ${shortId(msg.versionId)} of ${shortKey(key)}`,
                    );

                    // Refresh versions list and tree
                    const updated = await s3Service.listObjectVersions(bucket, key, region);
                    this.versions.length = 0;
                    this.versions.push(...updated);
                    this.panel.webview.html = this.buildHtml(this.versions);
                    treeProvider.refresh();
                    break;
                }

                case 'delete': {
                    const confirm = await vscode.window.showWarningMessage(
                        `Delete version ${shortId(msg.versionId)} of ${shortKey(key)}? This cannot be undone.`,
                        { modal: true },
                        'Delete',
                    );
                    if (!confirm) return;

                    await s3Service.deleteVersion(bucket, key, msg.versionId, region);
                    vscode.window.showInformationMessage(
                        `Deleted version ${shortId(msg.versionId)} of ${shortKey(key)}`,
                    );

                    const updated = await s3Service.listObjectVersions(bucket, key, region);
                    this.versions.length = 0;
                    this.versions.push(...updated);
                    this.panel.webview.html = this.buildHtml(this.versions);
                    treeProvider.refresh();
                    break;
                }

                case 'download': {
                    await this.downloadVersion(msg.versionId);
                    break;
                }
            }
        } catch (error) {
            const msg_text = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`${msg.command}: ${msg_text}`);
        }
    }

    // -----------------------------------------------------------------------
    // Download a specific version
    // -----------------------------------------------------------------------

    private async downloadVersion(versionId: string): Promise<void> {
        const { s3Service, bucket, key, region } = this.args;
        const defaultName = path.basename(key);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultName),
            title: `Save version ${shortId(versionId)} of ${shortKey(key)}`,
        });
        if (!uri) return;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading version ${shortId(versionId)}…`,
            },
            async () => {
                const stream = await s3Service.getObject(bucket, key, region, versionId);
                const writeStream = fs.createWriteStream(uri.fsPath);
                await new Promise<void>((resolve, reject) => {
                    stream.pipe(writeStream);
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                    stream.on('error', reject);
                });
            },
        );

        vscode.window.showInformationMessage(
            `Downloaded version ${shortId(versionId)} to ${uri.fsPath}`,
        );
    }

    // -----------------------------------------------------------------------
    // HTML builder
    // -----------------------------------------------------------------------

    private buildHtml(versions: ObjectVersion[]): string {
        const rows = versions.map((v) => {
            const latestBadge = v.isLatest
                ? '<span class="badge badge-latest">● Latest</span>'
                : '';
            const deleteMarkerBadge = v.deleteMarker
                ? '<span class="badge badge-delete-marker">Delete Marker</span>'
                : '';

            return `<tr>
                <td class="col-version"><code title="${esc(v.versionId)}">${shortId(v.versionId)}</code>${latestBadge}${deleteMarkerBadge}</td>
                <td class="col-size">${formatSize(v.size)}</td>
                <td class="col-date">${esc(v.lastModified.toLocaleString())}</td>
                <td class="col-actions">
                    <button class="btn btn-warn" onclick="post('delete','${esc(v.versionId)}')">Delete</button>
                    <button class="btn" onclick="post('download','${esc(v.versionId)}')">Download</button>
                    ${!v.deleteMarker && !v.isLatest ? `
                    <button class="btn" onclick="post('restore','${esc(v.versionId)}')">Restore</button>
                    ` : ''}
                </td>
            </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 16px;
  }
  h2 { margin-top: 0; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; padding: 6px 10px; border-bottom: 2px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  code { font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; margin-left: 6px; }
  .badge-latest { background: #1a7f37; color: #fff; }
  .badge-delete-marker { background: #cf222e; color: #fff; }
  .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer;
    font-size: 12px; margin-right: 4px;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-warn { background: var(--vscode-errorForeground); color: #fff; }
  .muted { color: var(--vscode-descriptionForeground); font-style: italic; }
  .col-version { max-width: 250px; }
  .col-size { width: 80px; }
  .col-date { width: 160px; }
  .col-actions { white-space: nowrap; }
</style>
</head>
<body>
<h2>📋 Object Versions</h2>
<p class="subtitle">s3://${esc(this.args.bucket)}/${esc(this.args.key)}</p>
<table>
  <thead><tr><th>Version ID</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>
  function post(command, versionId) {
    acquireVsCodeApi().postMessage({ command, versionId });
  }
</script>
</body>
</html>`;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function shortKey(key: string): string {
    const parts = key.split('/');
    const name = parts[parts.length - 1];
    return name.length > 40 ? `${name.slice(0, 37)}…` : name;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
