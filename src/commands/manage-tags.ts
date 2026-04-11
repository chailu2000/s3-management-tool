/**
 * Command: Manage Tags for an S3 object
 *
 * Opens a quick input UI to view, add, edit, and remove tags.
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem } from '../views/s3-tree-provider';
import { Tag } from '@aws-sdk/client-s3';

export async function manageTags(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void> {
    // Fetch existing tags
    let existingTags: Tag[];
    try {
        existingTags = await s3Service.getObjectTagging(item.bucket, item.key, item.region);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to fetch tags: ${msg}`);
        return;
    }

    // Build tag string for editing
    const tagLines = existingTags.map(t => `${t.Key}=${t.Value}`);
    const tagText = tagLines.join('\n');

    // Show input for editing tags
    const newTagText = await vscode.window.showInputBox({
        prompt: `Edit tags for ${item.key.split('/').pop()}`,
        value: tagText,
        placeHolder: 'key1=value1\nkey2=value2',
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return null; // Empty is valid (removes all tags)
            }
            const lines = value.trim().split('\n');
            for (const line of lines) {
                const eqIndex = line.indexOf('=');
                if (eqIndex <= 0 || eqIndex === line.length - 1) {
                    return `Invalid format: "${line}". Use key=value format.`;
                }
            }
            return null;
        },
    });

    if (newTagText === undefined) {
        return; // User cancelled
    }

    // Parse new tags
    const newTags: Tag[] = [];
    if (newTagText.trim().length > 0) {
        const lines = newTagText.trim().split('\n');
        for (const line of lines) {
            const eqIndex = line.indexOf('=');
            const key = line.substring(0, eqIndex).trim();
            const value = line.substring(eqIndex + 1).trim();
            if (key && value) {
                newTags.push({ Key: key, Value: value });
            }
        }
    }

    // Validate tag limits (max 10 tags per object)
    if (newTags.length > 10) {
        vscode.window.showErrorMessage('S3 objects can have a maximum of 10 tags.');
        return;
    }

    // Validate tag key/value length (max 128 chars each)
    for (const tag of newTags) {
        if (tag.Key!.length > 128 || tag.Value!.length > 128) {
            vscode.window.showErrorMessage('Tag keys and values must be 128 characters or fewer.');
            return;
        }
    }

    // Validate duplicate keys
    const keys = newTags.map(t => t.Key!);
    const uniqueKeys = new Set(keys);
    if (keys.length !== uniqueKeys.size) {
        vscode.window.showErrorMessage('Tag keys must be unique.');
        return;
    }

    // Save tags
    try {
        await s3Service.putObjectTagging(item.bucket, item.key, item.region, newTags);
        const summary = newTags.length > 0
            ? `Set ${newTags.length} tag(s) on "${item.key.split('/').pop()}"`
            : `Removed all tags from "${item.key.split('/').pop()}"`;
        vscode.window.showInformationMessage(summary);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to save tags: ${msg}`);
    }
}
