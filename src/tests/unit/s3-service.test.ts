/**
 * Unit tests for S3Service
 *
 * Tests:
 * - tryListBuckets with AccessDenied returns { buckets: [], hasPermission: false }
 * - validateBucketAccess success and failure paths
 * - Retry logic: mock 2 ThrottlingException then success, assert 3 total calls
 * - Prefix scope enforcement: key outside prefix returns error, zero AWS calls made
 */

import { S3Service } from '../../services/s3-service';
import { IS3ClientFactory } from '../../aws/client-factory';
import { BucketConfig } from '../../models/s3-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(name: string, message = name): Error & Record<string, unknown> {
    const err = new Error(message) as Error & Record<string, unknown>;
    err['name'] = name;
    return err;
}

function makeMockClient(sendImpl: jest.Mock) {
    return { send: sendImpl } as unknown as import('@aws-sdk/client-s3').S3Client;
}

function makeFactory(sendImpl: jest.Mock): IS3ClientFactory {
    const client = makeMockClient(sendImpl);
    return {
        getClient: jest.fn().mockReturnValue(client),
        updateCredentials: jest.fn(),
        dispose: jest.fn(),
    };
}

// ---------------------------------------------------------------------------
// tryListBuckets
// ---------------------------------------------------------------------------

describe('S3Service.tryListBuckets', () => {
    it('returns buckets and hasPermission:true on success', async () => {
        const send = jest.fn().mockResolvedValue({
            Buckets: [
                { Name: 'my-bucket', CreationDate: new Date('2024-01-01') },
            ],
        });
        const service = new S3Service(makeFactory(send));
        const result = await service.tryListBuckets();
        expect(result.hasPermission).toBe(true);
        expect(result.buckets).toHaveLength(1);
        expect(result.buckets[0].name).toBe('my-bucket');
    });

    it('returns { buckets: [], hasPermission: false } on AccessDenied', async () => {
        const send = jest.fn().mockRejectedValue(makeError('AccessDenied'));
        const service = new S3Service(makeFactory(send));
        const result = await service.tryListBuckets();
        expect(result.hasPermission).toBe(false);
        expect(result.buckets).toEqual([]);
    });

    it('returns { buckets: [], hasPermission: false } on AccessDeniedException', async () => {
        const send = jest.fn().mockRejectedValue(makeError('AccessDeniedException'));
        const service = new S3Service(makeFactory(send));
        const result = await service.tryListBuckets();
        expect(result.hasPermission).toBe(false);
        expect(result.buckets).toEqual([]);
    });

    it('wraps and rethrows non-access-denied errors', async () => {
        const send = jest.fn().mockRejectedValue(makeError('InternalError', 'boom'));
        const service = new S3Service(makeFactory(send));
        await expect(service.tryListBuckets()).rejects.toThrow('boom');
    });
});

// ---------------------------------------------------------------------------
// validateBucketAccess
// ---------------------------------------------------------------------------

describe('S3Service.validateBucketAccess', () => {
    it('returns { valid: true } when ListObjectsV2 succeeds', async () => {
        // validateBucketAccess calls getBucketRegion (1x GetBucketLocation) then ListObjectsV2
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'eu-west-1' }) // GetBucketLocation
            .mockResolvedValueOnce({ Contents: [] });                    // ListObjectsV2

        const service = new S3Service(makeFactory(send));
        const result = await service.validateBucketAccess('my-bucket');
        expect(result.valid).toBe(true);
    });

    it('returns { valid: false } with message on AccessDenied', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'eu-west-1' }) // GetBucketLocation
            .mockRejectedValueOnce(makeError('AccessDenied'));           // ListObjectsV2

        const service = new S3Service(makeFactory(send));
        const result = await service.validateBucketAccess('my-bucket');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Access denied/i);
    });

    it('returns { valid: false } with message on generic error', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'eu-west-1' })
            .mockRejectedValueOnce(makeError('NoSuchBucket', 'Bucket does not exist'));

        const service = new S3Service(makeFactory(send));
        const result = await service.validateBucketAccess('missing-bucket');
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe('S3Service retry logic', () => {
    it('retries on ThrottlingException and succeeds on 3rd attempt', async () => {
        jest.useFakeTimers();
        const throttle = makeError('ThrottlingException');
        const send = jest.fn()
            .mockRejectedValueOnce(throttle)   // attempt 1
            .mockRejectedValueOnce(throttle)   // attempt 2
            .mockResolvedValueOnce({ Buckets: [] }); // attempt 3 — success

        const service = new S3Service(makeFactory(send));

        // Run the promise and advance timers concurrently
        const promise = service.tryListBuckets();
        // Advance past 1s + 2s delays
        await jest.runAllTimersAsync();
        const result = await promise;

        expect(send).toHaveBeenCalledTimes(3);
        expect(result.hasPermission).toBe(true);
        jest.useRealTimers();
    });

    it('throws after exhausting all retries', async () => {
        jest.useFakeTimers();
        const throttle = makeError('ThrottlingException');
        const send = jest.fn().mockRejectedValue(throttle);
        const service = new S3Service(makeFactory(send));

        let caughtError: Error | undefined;
        // Attach .catch immediately to prevent unhandled rejection
        const p = service.tryListBuckets().catch(e => { caughtError = e as Error; });
        await jest.runAllTimersAsync();
        await p;

        expect(caughtError).toBeDefined();
        expect(caughtError!.message).toMatch(/ThrottlingException/);
        // 1 initial + 3 retries = 4 calls
        expect(send).toHaveBeenCalledTimes(4);
        jest.useRealTimers();
    });
});

// ---------------------------------------------------------------------------
// Prefix scope enforcement
// ---------------------------------------------------------------------------

describe('S3Service prefix scope enforcement', () => {
    it('assertKeyInScope throws and makes zero AWS calls when key is outside prefix', () => {
        const send = jest.fn();
        const service = new S3Service(makeFactory(send));

        const bucketConfig: BucketConfig = {
            id: 'test-id',
            name: 'my-bucket',
            region: 'us-east-1',
            prefix: 'allowed/',
            addedManually: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        expect(() => service.assertKeyInScope('forbidden/key.txt', bucketConfig)).toThrow(
            /outside the configured prefix scope/,
        );
        expect(send).not.toHaveBeenCalled();
    });

    it('assertKeyInScope does not throw when key starts with configured prefix', () => {
        const send = jest.fn();
        const service = new S3Service(makeFactory(send));

        const bucketConfig: BucketConfig = {
            id: 'test-id',
            name: 'my-bucket',
            region: 'us-east-1',
            prefix: 'allowed/',
            addedManually: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        expect(() => service.assertKeyInScope('allowed/file.txt', bucketConfig)).not.toThrow();
        expect(send).not.toHaveBeenCalled();
    });

    it('assertKeyInScope allows any key when no prefix is configured', () => {
        const send = jest.fn();
        const service = new S3Service(makeFactory(send));

        const bucketConfig: BucketConfig = {
            id: 'test-id',
            name: 'my-bucket',
            region: 'us-east-1',
            addedManually: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        expect(() => service.assertKeyInScope('any/key.txt', bucketConfig)).not.toThrow();
    });

    it('listObjects prepends configured prefix and filters out-of-scope keys', async () => {
        const send = jest.fn().mockResolvedValue({
            Contents: [
                { Key: 'allowed/file.txt', Size: 100, LastModified: new Date(), ETag: '"abc"' },
                { Key: 'other/file.txt', Size: 200, LastModified: new Date(), ETag: '"def"' },
            ],
            CommonPrefixes: [],
            IsTruncated: false,
        });

        const service = new S3Service(makeFactory(send));

        const bucketConfig: BucketConfig = {
            id: 'test-id',
            name: 'my-bucket',
            region: 'us-east-1',
            prefix: 'allowed/',
            addedManually: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const page = await service.listObjects('my-bucket', 'allowed/', 'us-east-1', undefined, bucketConfig);
        // Only the key starting with 'allowed/' should be returned
        expect(page.objects).toHaveLength(1);
        expect(page.objects[0].key).toBe('allowed/file.txt');
    });

    it('listObjects returns accessDenied:true on AccessDenied error', async () => {
        const send = jest.fn().mockRejectedValue(makeError('AccessDenied'));
        const service = new S3Service(makeFactory(send));

        const page = await service.listObjects('my-bucket', '', 'us-east-1');
        expect(page.accessDenied).toBe(true);
        expect(page.objects).toEqual([]);
        expect(page.commonPrefixes).toEqual([]);
        expect(page.isTruncated).toBe(false);
    });

    it('listObjects filters out zero-byte folder placeholder objects (key ends with "/")', async () => {
        const send = jest.fn().mockResolvedValue({
            Contents: [
                // Zero-byte folder placeholder — should be filtered out
                { Key: 'logs/', Size: 0, LastModified: new Date(), ETag: '"d41d8cd98f00b204e9800998ecf8427e"' },
                // Real file — should be kept
                { Key: 'logs/app.log', Size: 512, LastModified: new Date(), ETag: '"abc"' },
                // Zero-byte real file (should be kept — key doesn't end with /)
                { Key: 'empty.txt', Size: 0, LastModified: new Date(), ETag: '"d41d8cd98f00b204e9800998ecf8427e"' },
            ],
            CommonPrefixes: [{ Prefix: 'logs/' }],
            IsTruncated: false,
        });

        const service = new S3Service(makeFactory(send));
        const page = await service.listObjects('my-bucket', '', 'us-east-1');

        expect(page.objects).toHaveLength(2);
        expect(page.objects.map(o => o.key)).toEqual(['logs/app.log', 'empty.txt']);
        expect(page.commonPrefixes).toEqual(['logs/']);
    });
});

// ---------------------------------------------------------------------------
// getBucketVersioning
// ---------------------------------------------------------------------------

describe('S3Service.getBucketVersioning', () => {
    it('returns Enabled when versioning is enabled', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'us-east-1' })
            .mockResolvedValueOnce({ Status: 'Enabled' });
        const service = new S3Service(makeFactory(send));
        expect(await service.getBucketVersioning('my-bucket')).toBe('Enabled');
    });

    it('returns Unknown on AccessDenied', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'us-east-1' })
            .mockRejectedValueOnce(makeError('AccessDenied'));
        const service = new S3Service(makeFactory(send));
        expect(await service.getBucketVersioning('my-bucket')).toBe('Unknown');
    });
});

// ---------------------------------------------------------------------------
// getBucketPolicy
// ---------------------------------------------------------------------------

describe('S3Service.getBucketPolicy', () => {
    it('returns null on NoSuchBucketPolicy', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'us-east-1' })
            .mockRejectedValueOnce(makeError('NoSuchBucketPolicy'));
        const service = new S3Service(makeFactory(send));
        expect(await service.getBucketPolicy('my-bucket')).toBeNull();
    });

    it('returns policy string when policy exists', async () => {
        const policy = JSON.stringify({ Version: '2012-10-17', Statement: [] });
        const send = jest.fn()
            .mockResolvedValueOnce({ LocationConstraint: 'us-east-1' })
            .mockResolvedValueOnce({ Policy: policy });
        const service = new S3Service(makeFactory(send));
        expect(await service.getBucketPolicy('my-bucket')).toBe(policy);
    });
});
