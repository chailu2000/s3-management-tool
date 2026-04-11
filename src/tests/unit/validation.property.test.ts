import * as fc from 'fast-check';
import {
    validateBucketName,
    validateArn,
    parseArn,
    formatArn,
    validateObjectKey,
    normalizePrefix,
} from '../../utils/validation';

// ---------------------------------------------------------------------------
// Helper: check if a string satisfies S3 bucket naming rules
// ---------------------------------------------------------------------------
function isValidBucketName(name: string): boolean {
    if (name.length < 3 || name.length > 63) { return false; }
    if (!/^[a-z0-9-]+$/.test(name)) { return false; }
    if (name.startsWith('-') || name.endsWith('-')) { return false; }
    return true;
}

// ---------------------------------------------------------------------------
// Property 5: Bucket name validation rejects invalid names
// Feature: s3-management-tool, Property 5: Bucket name validation rejects invalid names
// Validates: Requirements 19.1
// ---------------------------------------------------------------------------
describe('Property 5: Bucket name validation rejects invalid names', () => {
    it('validator result matches S3 naming rules for arbitrary strings', () => {
        // Feature: s3-management-tool, Property 5: Bucket name validation rejects invalid names
        fc.assert(
            fc.property(fc.string(), (name) => {
                const result = validateBucketName(name);
                const expected = isValidBucketName(name);
                return result.valid === expected;
            }),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 6: ARN parsing round-trip
// Feature: s3-management-tool, Property 6: ARN parsing round-trip
// Validates: Requirements 4.2, 19.2
// ---------------------------------------------------------------------------
describe('Property 6: ARN parsing round-trip', () => {
    it('parse then re-format produces the original ARN for valid bucket names', () => {
        // Feature: s3-management-tool, Property 6: ARN parsing round-trip
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
                (bucketName) => {
                    const arn = formatArn(bucketName);
                    const parsed = parseArn(arn);
                    if (parsed === null) { return false; }
                    return formatArn(parsed.bucketName) === arn;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 11: Object key UTF-8 length validation
// Feature: s3-management-tool, Property 11: Object key UTF-8 length validation
// Validates: Requirements 19.3
// ---------------------------------------------------------------------------
describe('Property 11: Object key UTF-8 length validation', () => {
    it('rejects iff null byte present or UTF-8 byte length > 1024', () => {
        // Feature: s3-management-tool, Property 11: Object key UTF-8 length validation
        fc.assert(
            fc.property(fc.string(), (key) => {
                const result = validateObjectKey(key);
                const hasNullByte = key.includes('\0');
                const byteLength = Buffer.byteLength(key, 'utf8');
                const shouldBeInvalid = hasNullByte || byteLength > 1024;
                return result.valid === !shouldBeInvalid;
            }),
            { numRuns: 100 }
        );
    });

    it('rejects strings with null bytes', () => {
        // Feature: s3-management-tool, Property 11: Object key UTF-8 length validation
        fc.assert(
            fc.property(
                fc.tuple(fc.string(), fc.string()),
                ([prefix, suffix]) => {
                    const key = prefix + '\0' + suffix;
                    return validateObjectKey(key).valid === false;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('rejects strings whose UTF-8 byte length exceeds 1024', () => {
        // Feature: s3-management-tool, Property 11: Object key UTF-8 length validation
        fc.assert(
            fc.property(
                fc.string({ minLength: 1025, maxLength: 2048 }).filter(
                    (s) => Buffer.byteLength(s, 'utf8') > 1024 && !s.includes('\0')
                ),
                (key) => {
                    return validateObjectKey(key).valid === false;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 12: Prefix normalization is idempotent
// Feature: s3-management-tool, Property 12: Prefix normalization is idempotent
// Validates: Requirements 19.4
// ---------------------------------------------------------------------------
describe('Property 12: Prefix normalization is idempotent', () => {
    it('normalizePrefix(normalizePrefix(s)) === normalizePrefix(s) for any string', () => {
        // Feature: s3-management-tool, Property 12: Prefix normalization is idempotent
        fc.assert(
            fc.property(fc.string(), (s) => {
                return normalizePrefix(normalizePrefix(s)) === normalizePrefix(s);
            }),
            { numRuns: 100 }
        );
    });
});
