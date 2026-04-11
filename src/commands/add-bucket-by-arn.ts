/**
 * Command: Add bucket by ARN
 * Requirements: 4.2, 4.3
 */

import * as vscode from 'vscode';
import { BucketStorage } from '../services/bucket-storage';
import { S3Service } from '../services/s3-service';
import { S3TreeProvider } from '../views/s3-tree-provider';
import { validateArn, parseArn } from '../utils/validation';

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function addBucketByArn(
    storage: BucketStorage,
    s3Service: S3Service,
    treeProvider: S3TreeProvider,
): Promise<void> {
    const arn = await vscode.window.showInputBox({
        prompt: 'Enter S3 bucket ARN',
        placeHolder: 'arn:aws:s3:::my-bucket',
        validateInput: (value) => {
            const result = validateArn(value);
            return result.valid ? null : result.error ?? 'Invalid ARN';
        },
    });
    if (!arn) {
        return;
    }

    const arnValidation = validateArn(arn);
    if (!arnValidation.valid) {
        vscode.window.showErrorMessage(
            `Invalid ARN format: ${arnValidation.error}. ` +
            `Expected format: arn:aws:s3:::<bucket-name>`,
        );
        return;
    }

    const parsed = parseArn(arn);
    if (!parsed) {
        vscode.window.showErrorMessage('Failed to parse ARN. Expected format: arn:aws:s3:::<bucket-name>');
        return;
    }

    const { bucketName } = parsed;

    const region = await vscode.window.showInputBox({
        prompt: 'Enter AWS region',
        placeHolder: 'us-east-1',
        value: 'us-east-1',
    });
    if (region === undefined) {
        return;
    }

    const effectiveRegion = region.trim() || 'us-east-1';

    const validation = await s3Service.validateBucketAccess(bucketName);
    if (!validation.valid) {
        vscode.window.showErrorMessage(
            `Cannot access bucket "${bucketName}": ${validation.error}\n` +
            `Required permissions: s3:ListObjectsV2`,
        );
        return;
    }

    // Auto-detect the actual bucket region
    const actualRegion = await s3Service.getBucketRegion(bucketName);

    const now = new Date().toISOString();
    await storage.addBucket({
        id: generateId(),
        name: bucketName,
        region: actualRegion,
        addedManually: true,
        createdAt: now,
        updatedAt: now,
    });

    treeProvider.refresh();
    vscode.window.showInformationMessage(`Bucket "${bucketName}" added successfully.`);
}
