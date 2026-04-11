/**
 * Command: Generate presigned URL
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import * as vscode from 'vscode';
import { S3Service } from '../services/s3-service';
import { S3ObjectItem } from '../views/s3-tree-provider';
import { ValidationResult } from '../models/s3-models';

const MIN_EXPIRY_MINUTES = 1;
const MAX_EXPIRY_MINUTES = 10080; // 7 days

/**
 * Validates that the given number is an integer in the range [1, 10080].
 * Exported for property-based testing.
 */
export function validateExpiryMinutes(minutes: number): ValidationResult {
    if (!Number.isInteger(minutes)) {
        return { valid: false, error: 'Expiry must be a whole number of minutes.' };
    }
    if (minutes < MIN_EXPIRY_MINUTES || minutes > MAX_EXPIRY_MINUTES) {
        return {
            valid: false,
            error: `Expiry must be between ${MIN_EXPIRY_MINUTES} and ${MAX_EXPIRY_MINUTES} minutes.`,
        };
    }
    return { valid: true };
}

export async function generatePresignedUrl(
    item: S3ObjectItem,
    s3Service: S3Service,
): Promise<void> {
    const input = await vscode.window.showInputBox({
        prompt: `Expiry in minutes (1–${MAX_EXPIRY_MINUTES})`,
        value: '60',
        validateInput: (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed)) {
                return 'Please enter a whole number.';
            }
            const result = validateExpiryMinutes(parsed);
            return result.valid ? null : result.error ?? 'Invalid expiry';
        },
    });

    if (input === undefined) {
        return;
    }

    const minutes = parseInt(input, 10);
    const validation = validateExpiryMinutes(minutes);
    if (!validation.valid) {
        vscode.window.showErrorMessage(validation.error ?? 'Invalid expiry value.');
        return;
    }

    try {
        const url = await s3Service.getPresignedUrl(
            item.bucket,
            item.key,
            item.region,
            minutes * 60,
        );
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(
            `Presigned URL copied to clipboard (expires in ${minutes} minute${minutes === 1 ? '' : 's'})`,
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to generate presigned URL: ${msg}`);
    }
}
