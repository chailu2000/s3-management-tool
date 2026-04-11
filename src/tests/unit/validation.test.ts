import {
    validateBucketName,
    validateArn,
    parseArn,
    formatArn,
    validateObjectKey,
    normalizePrefix,
} from '../../utils/validation';

// ---------------------------------------------------------------------------
// validateBucketName
// ---------------------------------------------------------------------------

describe('validateBucketName', () => {
    describe('valid names', () => {
        it('accepts a simple lowercase name', () => {
            expect(validateBucketName('my-bucket').valid).toBe(true);
        });

        it('accepts a 3-character name', () => {
            expect(validateBucketName('abc').valid).toBe(true);
        });

        it('accepts a 63-character name', () => {
            expect(validateBucketName('a'.repeat(63)).valid).toBe(true);
        });

        it('accepts names with numbers', () => {
            expect(validateBucketName('bucket123').valid).toBe(true);
        });

        it('accepts names with hyphens in the middle', () => {
            expect(validateBucketName('my-bucket-name').valid).toBe(true);
        });
    });

    describe('invalid names', () => {
        it('rejects names shorter than 3 characters', () => {
            const result = validateBucketName('ab');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('rejects names longer than 63 characters', () => {
            const result = validateBucketName('a'.repeat(64));
            expect(result.valid).toBe(false);
        });

        it('rejects names with uppercase letters', () => {
            expect(validateBucketName('MyBucket').valid).toBe(false);
        });

        it('rejects names starting with a hyphen', () => {
            expect(validateBucketName('-bucket').valid).toBe(false);
        });

        it('rejects names ending with a hyphen', () => {
            expect(validateBucketName('bucket-').valid).toBe(false);
        });

        it('rejects names with underscores', () => {
            expect(validateBucketName('my_bucket').valid).toBe(false);
        });

        it('rejects names with spaces', () => {
            expect(validateBucketName('my bucket').valid).toBe(false);
        });

        it('rejects empty string', () => {
            expect(validateBucketName('').valid).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// validateArn
// ---------------------------------------------------------------------------

describe('validateArn', () => {
    it('accepts a valid ARN', () => {
        expect(validateArn('arn:aws:s3:::my-bucket').valid).toBe(true);
    });

    it('rejects ARN with wrong prefix', () => {
        expect(validateArn('arn:aws:sqs:::my-bucket').valid).toBe(false);
    });

    it('rejects ARN with extra segments', () => {
        expect(validateArn('arn:aws:s3:us-east-1::my-bucket').valid).toBe(false);
    });

    it('rejects plain bucket name without ARN prefix', () => {
        expect(validateArn('my-bucket').valid).toBe(false);
    });

    it('rejects ARN with invalid bucket name (uppercase)', () => {
        expect(validateArn('arn:aws:s3:::MyBucket').valid).toBe(false);
    });

    it('rejects empty string', () => {
        expect(validateArn('').valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// parseArn
// ---------------------------------------------------------------------------

describe('parseArn', () => {
    it('parses a valid ARN and returns bucket name', () => {
        expect(parseArn('arn:aws:s3:::my-bucket')).toEqual({ bucketName: 'my-bucket' });
    });

    it('returns null for an invalid ARN', () => {
        expect(parseArn('not-an-arn')).toBeNull();
    });

    it('returns null for an ARN with invalid bucket name', () => {
        expect(parseArn('arn:aws:s3:::MyBucket')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// formatArn
// ---------------------------------------------------------------------------

describe('formatArn', () => {
    it('formats a bucket name as an ARN', () => {
        expect(formatArn('my-bucket')).toBe('arn:aws:s3:::my-bucket');
    });

    it('round-trips with parseArn', () => {
        const bucketName = 'test-bucket-123';
        const arn = formatArn(bucketName);
        const parsed = parseArn(arn);
        expect(parsed?.bucketName).toBe(bucketName);
    });
});

// ---------------------------------------------------------------------------
// validateObjectKey
// ---------------------------------------------------------------------------

describe('validateObjectKey', () => {
    it('accepts a normal key', () => {
        expect(validateObjectKey('path/to/object.txt').valid).toBe(true);
    });

    it('accepts an empty key', () => {
        expect(validateObjectKey('').valid).toBe(true);
    });

    it('accepts a key exactly 1024 bytes long', () => {
        expect(validateObjectKey('a'.repeat(1024)).valid).toBe(true);
    });

    it('rejects a key with a null byte', () => {
        const result = validateObjectKey('path/to/\0file');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('null');
    });

    it('rejects a key exceeding 1024 UTF-8 bytes', () => {
        const result = validateObjectKey('a'.repeat(1025));
        expect(result.valid).toBe(false);
    });

    it('rejects a key with multibyte chars exceeding 1024 bytes', () => {
        // Each '€' is 3 bytes in UTF-8; 342 × 3 = 1026 bytes
        const result = validateObjectKey('€'.repeat(342));
        expect(result.valid).toBe(false);
    });

    it('accepts a key with multibyte chars within 1024 bytes', () => {
        // 341 × 3 = 1023 bytes
        expect(validateObjectKey('€'.repeat(341)).valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// normalizePrefix
// ---------------------------------------------------------------------------

describe('normalizePrefix', () => {
    it('appends / to a non-empty prefix without trailing slash', () => {
        expect(normalizePrefix('my/prefix')).toBe('my/prefix/');
    });

    it('leaves a prefix that already ends with / unchanged', () => {
        expect(normalizePrefix('my/prefix/')).toBe('my/prefix/');
    });

    it('returns empty string unchanged', () => {
        expect(normalizePrefix('')).toBe('');
    });

    it('is idempotent', () => {
        const prefix = 'some/path';
        expect(normalizePrefix(normalizePrefix(prefix))).toBe(normalizePrefix(prefix));
    });

    it('handles a single slash', () => {
        expect(normalizePrefix('/')).toBe('/');
    });
});
