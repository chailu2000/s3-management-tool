/**
 * Logger — thin wrapper around a VS Code output channel.
 *
 * debug() output is gated behind the VSCODE_S3_DEBUG=true environment variable
 * so it never appears in production without opt-in.
 */

import * as vscode from 'vscode';

export class Logger {
    private channel: vscode.OutputChannel;
    private static instance: Logger | null = null;

    private constructor() {
        this.channel = vscode.window.createOutputChannel('S3 Management Tool');
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private timestamp(): string {
        return new Date().toISOString();
    }

    log(message: string): void {
        this.channel.appendLine(`[${this.timestamp()}] INFO: ${message}`);
    }

    error(message: string, err?: unknown): void {
        this.channel.appendLine(`[${this.timestamp()}] ERROR: ${message}`);
        if (err instanceof Error) {
            this.channel.appendLine(`  ${err.stack ?? err.message}`);
        } else if (err !== undefined) {
            this.channel.appendLine(`  ${String(err)}`);
        }
    }

    warn(message: string): void {
        this.channel.appendLine(`[${this.timestamp()}] WARN: ${message}`);
    }

    debug(message: string): void {
        if (process.env.VSCODE_S3_DEBUG !== 'true') {
            return;
        }
        this.channel.appendLine(`[${this.timestamp()}] DEBUG: ${message}`);
    }

    show(): void {
        this.channel.show();
    }

    dispose(): void {
        this.channel.dispose();
        Logger.instance = null;
    }
}
