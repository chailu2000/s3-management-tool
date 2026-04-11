/**
 * Webview Panel: Object Details
 * Requirements: 11.2, 2.6, 23.3
 *
 * Displays object metadata and provides action buttons for download, delete, copy,
 * presigned URL generation, and upload to prefix.
 */

import * as vscode from 'vscode';
import { ObjectMetadata } from '../models/s3-models';
import { sanitizeForWebview } from '../utils/webview-sanitizer';

export class ObjectDetailsPanel {
    private panel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onCommand: (command: string, args: any) => Promise<void>,
    ) { }

    /**
     * Shows the object details panel with metadata
     */
    public showObjectDetails(metadata: ObjectMetadata): void {
        // Create panel if it doesn't exist
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                's3ObjectDetails',
                'S3 Object Details',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this.extensionUri],
                },
            );

            this.panel.onDidDispose(
                () => {
                    this.panel = undefined;
                    this.disposables.forEach((d) => d.dispose());
                    this.disposables = [];
                },
                null,
                this.disposables,
            );

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(
                async (message) => {
                    const sanitizedMessage = sanitizeForWebview(message) as Record<string, unknown>;
                    await this.onCommand(sanitizedMessage.command as string, sanitizedMessage.args);
                },
                undefined,
                this.disposables,
            );
        }

        // Update panel title and content
        this.panel.title = `S3: ${metadata.key.split('/').pop()}`;
        this.panel.webview.html = this.getHtmlForWebview(metadata, this.panel.webview);
        this.panel.reveal();
    }

    /**
     * Generates the HTML for the webview
     */
    private getHtmlForWebview(metadata: ObjectMetadata, webview: vscode.Webview): string {
        const sanitizedMetadata = sanitizeForWebview(metadata) as ObjectMetadata & { bucket?: string };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${this.getNonce()}';">
    <title>S3 Object Details</title>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        h2 {
            margin-top: 0;
            font-size: 1.5em;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .metadata-grid {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 8px;
            margin-bottom: 20px;
        }
        .metadata-label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
        }
        .metadata-value {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 20px;
        }
        .vscode-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 2px;
        }
        .vscode-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .vscode-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .vscode-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .user-metadata {
            margin-top: 20px;
        }
        .user-metadata h3 {
            margin-bottom: 10px;
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h2>Object Details</h2>
    
    <div class="metadata-grid">
        <div class="metadata-label">Key:</div>
        <div class="metadata-value">${this.escapeHtml(sanitizedMetadata.key)}</div>
        
        <div class="metadata-label">Size:</div>
        <div class="metadata-value">${this.formatBytes(sanitizedMetadata.size)}</div>
        
        <div class="metadata-label">Last Modified:</div>
        <div class="metadata-value">${new Date(sanitizedMetadata.lastModified).toLocaleString()}</div>
        
        <div class="metadata-label">Content Type:</div>
        <div class="metadata-value">${this.escapeHtml(sanitizedMetadata.contentType || 'Unknown')}</div>
        
        <div class="metadata-label">ETag:</div>
        <div class="metadata-value">${this.escapeHtml(sanitizedMetadata.etag)}</div>
        
        <div class="metadata-label">Storage Class:</div>
        <div class="metadata-value">${this.escapeHtml(sanitizedMetadata.storageClass || 'Unknown')}</div>
    </div>

    ${Object.keys(sanitizedMetadata.userMetadata || {}).length > 0 ? `
    <div class="user-metadata">
        <h3>User Metadata</h3>
        <pre>${this.escapeHtml(JSON.stringify(sanitizedMetadata.userMetadata, null, 2))}</pre>
    </div>
    ` : ''}

    <div class="actions">
        <button class="vscode-button" onclick="downloadObject()">⬇ Download</button>
        <button class="vscode-button secondary" onclick="copyObject()">📋 Copy</button>
        <button class="vscode-button secondary" onclick="generatePresignedUrl()">🔗 Presigned URL</button>
        <button class="vscode-button secondary" onclick="uploadToPrefix()">⬆ Upload to Prefix</button>
        <button class="vscode-button" style="background: var(--vscode-errorForeground);" onclick="deleteObject()">🗑 Delete</button>
    </div>

    <script nonce="${this.getNonce()}">
        const vscode = acquireVsCodeApi();
        const metadata = ${JSON.stringify(sanitizedMetadata)};

        function downloadObject() {
            vscode.postMessage({
                command: 'downloadObject',
                args: { bucket: metadata.bucket, key: metadata.key }
            });
        }

        function copyObject() {
            vscode.postMessage({
                command: 'copyObject',
                args: { bucket: metadata.bucket, key: metadata.key }
            });
        }

        function generatePresignedUrl() {
            vscode.postMessage({
                command: 'generatePresignedUrl',
                args: { bucket: metadata.bucket, key: metadata.key }
            });
        }

        function uploadToPrefix() {
            const prefix = metadata.key.includes('/') 
                ? metadata.key.substring(0, metadata.key.lastIndexOf('/') + 1)
                : '';
            vscode.postMessage({
                command: 'uploadToPrefix',
                args: { bucket: metadata.bucket, prefix }
            });
        }

        function deleteObject() {
            if (confirm('Are you sure you want to delete this object?')) {
                vscode.postMessage({
                    command: 'deleteObject',
                    args: { bucket: metadata.bucket, key: metadata.key }
                });
            }
        }
    </script>
</body>
</html>`;
    }

    /**
     * Formats bytes to human-readable string
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) { return '0 B'; }
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Escapes HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    /**
     * Generates a nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Disposes the panel
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
