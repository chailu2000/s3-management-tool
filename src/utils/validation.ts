import { ValidationResult } from '../models/s3-models';

/**
 * Validates an S3 bucket name against AWS naming rules.
 * Rules: 3–63 chars, lowercase letters/numbers/hyphens only,
 * must not start or end with a hyphen.
 */
export function validateBucketName(name: string): ValidationResult {
    if (name.length < 3 || name.length > 63) {
        return { valid: false, error: `Bucket name must be between 3 and 63 characters (got ${name.length})` };
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
        return { valid: false, error: 'Bucket name may only contain lowercase letters, numbers, and hyphens' };
    }
    if (name.startsWith('-') || name.endsWith('-')) {
        return { valid: false, error: 'Bucket name must not start or end with a hyphen' };
    }
    return { valid: true };
}

/**
 * Validates an S3 ARN of the form arn:aws:s3:::<bucket-name>.
 */
export function validateArn(arn: string): ValidationResult {
    const match = /^arn:aws:s3:::([a-z0-9][a-z0-9-]{1,61}[a-z0-9]|[a-z0-9]{1,2})$/.exec(arn);
    if (!match) {
        return { valid: false, error: 'ARN must be in the format arn:aws:s3:::<bucket-name> with a valid bucket name' };
    }
    // Also validate the embedded bucket name
    const bucketResult = validateBucketName(match[1]);
    if (!bucketResult.valid) {
        return { valid: false, error: `ARN contains invalid bucket name: ${bucketResult.error}` };
    }
    return { valid: true };
}

/**
 * Parses a valid S3 ARN and returns the bucket name, or null if invalid.
 */
export function parseArn(arn: string): { bucketName: string } | null {
    if (!validateArn(arn).valid) {
        return null;
    }
    const bucketName = arn.slice('arn:aws:s3:::'.length);
    return { bucketName };
}

/**
 * Formats a bucket name as an S3 ARN.
 */
export function formatArn(bucketName: string): string {
    return `arn:aws:s3:::${bucketName}`;
}

/**
 * Validates an S3 object key.
 * Rejects keys containing null bytes or whose UTF-8 byte length exceeds 1024.
 */
export function validateObjectKey(key: string): ValidationResult {
    if (key.includes('\0')) {
        return { valid: false, error: 'Object key must not contain null bytes' };
    }
    const byteLength = Buffer.byteLength(key, 'utf8');
    if (byteLength > 1024) {
        return { valid: false, error: `Object key UTF-8 byte length must not exceed 1024 (got ${byteLength})` };
    }
    return { valid: true };
}

/**
 * Normalizes a prefix by appending '/' if non-empty and not already ending with '/'.
 * Idempotent: calling twice produces the same result as calling once.
 */
export function normalizePrefix(prefix: string): string {
    if (prefix.length === 0) {
        return prefix;
    }
    if (prefix.endsWith('/')) {
        return prefix;
    }
    return prefix + '/';
}
