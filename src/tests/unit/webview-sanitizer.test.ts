/**
 * Unit tests for sanitizeForWebview.
 *
 * Tests that accessKeyId, secretAccessKey, and sessionToken fields are stripped
 * from nested payloads.
 *
 * Requirements: 2.6
 */

import { sanitizeForWebview } from '../../utils/webview-sanitizer';

describe('sanitizeForWebview', () => {
    it('strips accessKeyId from top-level object', () => {
        const input = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', name: 'test' };
        const result = sanitizeForWebview(input) as Record<string, unknown>;

        expect(result).not.toHaveProperty('accessKeyId');
        expect(result).toHaveProperty('name', 'test');
    });

    it('strips secretAccessKey from top-level object', () => {
        const input = { secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', bucket: 'my-bucket' };
        const result = sanitizeForWebview(input) as Record<string, unknown>;

        expect(result).not.toHaveProperty('secretAccessKey');
        expect(result).toHaveProperty('bucket', 'my-bucket');
    });

    it('strips sessionToken from top-level object', () => {
        const input = { sessionToken: 'FwoGZXIvYXdzE...', key: 'file.txt' };
        const result = sanitizeForWebview(input) as Record<string, unknown>;

        expect(result).not.toHaveProperty('sessionToken');
        expect(result).toHaveProperty('key', 'file.txt');
    });

    it('strips all credential fields from nested objects', () => {
        const input = {
            bucket: 'my-bucket',
            credentials: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                sessionToken: 'FwoGZXIvYXdzE...',
            },
            object: {
                key: 'file.txt',
                size: 1024,
            },
        };

        const result = sanitizeForWebview(input) as any;

        expect(result).toHaveProperty('bucket', 'my-bucket');
        expect(result.credentials).not.toHaveProperty('accessKeyId');
        expect(result.credentials).not.toHaveProperty('secretAccessKey');
        expect(result.credentials).not.toHaveProperty('sessionToken');
        expect(result.object).toHaveProperty('key', 'file.txt');
        expect(result.object).toHaveProperty('size', 1024);
    });

    it('strips credential fields from arrays', () => {
        const input = {
            buckets: [
                { name: 'bucket1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE' },
                { name: 'bucket2', secretAccessKey: 'wJalrXUtnFEMI' },
            ],
        };

        const result = sanitizeForWebview(input) as any;

        expect(result.buckets[0]).not.toHaveProperty('accessKeyId');
        expect(result.buckets[0]).toHaveProperty('name', 'bucket1');
        expect(result.buckets[1]).not.toHaveProperty('secretAccessKey');
        expect(result.buckets[1]).toHaveProperty('name', 'bucket2');
    });

    it('handles null and undefined correctly', () => {
        expect(sanitizeForWebview(null)).toBeNull();
        expect(sanitizeForWebview(undefined)).toBeUndefined();
    });

    it('handles primitive values correctly', () => {
        expect(sanitizeForWebview(42)).toBe(42);
        expect(sanitizeForWebview('test')).toBe('test');
        expect(sanitizeForWebview(true)).toBe(true);
    });

    it('does not mutate the original object', () => {
        const input = {
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            name: 'test',
            nested: {
                secretAccessKey: 'wJalrXUtnFEMI',
                value: 123,
            },
        };

        const originalCopy = JSON.parse(JSON.stringify(input));
        sanitizeForWebview(input);

        expect(input).toEqual(originalCopy);
    });

    it('strips credentials from deeply nested structures', () => {
        const input = {
            level1: {
                level2: {
                    level3: {
                        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                        secretAccessKey: 'wJalrXUtnFEMI',
                        sessionToken: 'FwoGZXIvYXdzE',
                        data: 'keep this',
                    },
                },
            },
        };

        const result = sanitizeForWebview(input) as any;

        expect(result.level1.level2.level3).not.toHaveProperty('accessKeyId');
        expect(result.level1.level2.level3).not.toHaveProperty('secretAccessKey');
        expect(result.level1.level2.level3).not.toHaveProperty('sessionToken');
        expect(result.level1.level2.level3).toHaveProperty('data', 'keep this');
    });

    it('handles ObjectMetadata with credential fields', () => {
        const input = {
            key: 'path/to/file.txt',
            size: 1024,
            lastModified: new Date(),
            contentType: 'text/plain',
            etag: '"abc123"',
            storageClass: 'STANDARD',
            userMetadata: {},
            // These should be stripped if accidentally included
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI',
        };

        const result = sanitizeForWebview(input) as any;

        expect(result).toHaveProperty('key', 'path/to/file.txt');
        expect(result).toHaveProperty('size', 1024);
        expect(result).toHaveProperty('etag', '"abc123"');
        expect(result).not.toHaveProperty('accessKeyId');
        expect(result).not.toHaveProperty('secretAccessKey');
    });
});
