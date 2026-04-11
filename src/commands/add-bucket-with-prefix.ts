/**
 * Command: Add bucket with prefix scope
 * Requirements: 4.4, 19.4
 */

import * as vscode from 'vscode';
import { BucketStorage } from '../services/bucket-storage';
import { S3Service } from '../services/s3-service';
import { S3TreeProvider } from '../views/s3-tree-provider';
import { validateBucketName, normalizePrefix } from '../utils/validation';

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function addBucketWithPrefix(
    storage: BucketStorage,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter S3 bucket name',
        placeHolder: 'my-bucket',
        validateInput: (value) => {
            const result = validateBucketName(value);
            return result.valid ? null : result.error ?? 'Invalid bucket name';
        },
    });
    if (!name) {
        return;
    }

    const nameValidation = validateBucketName(name);
    if (!nameValidation.valid) {
        vscode.window.showErrorMessage(`Invalid bucket name: ${nameValidation.error}`);
        return;
    }

    const region = await vscode.window.showInputBox({
        prompt: 'Enter AWS region',
        placeHolder: 'us-east-1',
        value: 'us-east-1',
    });
    if (region === undefined) {
        return;
    }

    const effectiveRegion = region.trim() || 'us-east-1';

    const rawPrefix = await vscode.window.showInputBox({
        prompt: 'Enter prefix scope (e.g. "logs/" or "data/2024/")',
        placeHolder: 'my-prefix/',
    });
    if (rawPrefix === undefined) {
        return;
    }

    const prefix = normalizePrefix(rawPrefix.trim());

    const validation = await s3Service.validateBucketAccess(name, prefix || undefined);
    if (!validation.valid) {
        vscode.window.showErrorMessage(
            `Cannot access bucket "${name}" with prefix "${prefix}": ${validation.error}\n` +
            `Required permissions: s3:ListObjectsV2`,
        );
        return;
    }

    // Auto-detect the actual bucket region
    const actualRegion = await s3Service.getBucketRegion(name);

    const now = new Date().toISOString();
    await storage.addBucket({
        id: generateId(),
        name,
        region: actualRegion,
        prefix: prefix || undefined,
        addedManually: true,
        createdAt: now,
        updatedAt: now,
    });

    treeProvider.refresh();
    const label = prefix ? `"${name}" (prefix: ${prefix})` : `"${name}"`;
    vscode.window.showInformationMessage(`Bucket ${label} added successfully.`);
}
