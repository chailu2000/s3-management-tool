// Feature: s3-management-tool, Property 4: Prefix scope enforcement — no out-of-scope keys reach the API

/**
 * Property 4: Prefix scope enforcement — no out-of-scope keys reach the API
 *
 * For any BucketConfig with a non-empty prefix, and for any user-supplied object key,
 * if the key does not begin with the configured prefix then S3Service should return
 * an error and make zero AWS API calls.
 *
 * Validates: Requirements 18.1, 18.2, 18.3
 */

import * as fc from 'fast-check';
import { S3Service } from '../../services/s3-service';
import { IS3ClientFactory } from '../../aws/client-factory';
import { BucketConfig } from '../../models/s3-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFactory(send: jest.Mock): IS3ClientFactory {
    const client = { send } as unknown as import('@aws-sdk/client-s3').S3Client;
    return {
        getClient: jest.fn().mockReturnValue(client),
        updateCredentials: jest.fn(),
        dispose: jest.fn(),
    };
}

/**
 * Generates a valid non-empty prefix (lowercase letters, ends with '/').
 * e.g. "data/", "team/"
 */
const prefixArb = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,20}$/)
    .map(s => `${s}/`);

/**
 * Generates a BucketConfig with a non-empty prefix.
 */
const bucketConfigArb = prefixArb.map((prefix): BucketConfig => ({
    id: 'test-id',
    name: 'test-bucket',
    region: 'us-east-1',
    prefix,
    addedManually: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
}));

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Property 4: Prefix scope enforcement — no out-of-scope keys reach the API', () => {
    it('assertKeyInScope throws for out-of-scope keys and makes zero AWS calls', () => {
        fc.assert(
            fc.property(
                bucketConfigArb,
                fc.stringMatching(/^[a-z][a-z0-9/_-]{0,50}$/),
                (bucketConfig, rawKey) => {
                    const prefix = bucketConfig.prefix!;
                    // Ensure the key does NOT start with the configured prefix
                    const key = rawKey.startsWith(prefix)
                        ? `zzz-out-of-scope/${rawKey}`
                        : rawKey;

                    // If key still starts with prefix after transformation, skip this run
                    if (key.startsWith(prefix)) { return; }

                    const send = jest.fn();
                    const service = new S3Service(makeFactory(send));

                    // The key is out of scope — assertKeyInScope must throw
                    expect(() => service.assertKeyInScope(key, bucketConfig)).toThrow(
                        /outside the configured prefix scope/,
                    );

                    // Zero AWS API calls must have been made
                    expect(send).not.toHaveBeenCalled();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('assertKeyInScope does not throw for in-scope keys', () => {
        fc.assert(
            fc.property(
                bucketConfigArb,
                fc.string({ minLength: 0, maxLength: 50 }),
                (bucketConfig, suffix) => {
                    const prefix = bucketConfig.prefix!;
                    // Key starts with the configured prefix — always in scope
                    const key = `${prefix}${suffix}`;

                    const send = jest.fn();
                    const service = new S3Service(makeFactory(send));

                    expect(() => service.assertKeyInScope(key, bucketConfig)).not.toThrow();
                    // Still no AWS calls (assertKeyInScope is a guard, not an API call)
                    expect(send).not.toHaveBeenCalled();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('listObjects filters out keys not starting with configured prefix', async () => {
        await fc.assert(
            fc.asyncProperty(
                bucketConfigArb,
                fc.array(
                    fc.record({
                        keySuffix: fc.stringMatching(/^[a-z][a-z0-9/_-]{1,40}$/),
                        inScope: fc.boolean(),
                    }),
                    { minLength: 1, maxLength: 10 },
                ),
                async (bucketConfig, keySpecs) => {
                    const prefix = bucketConfig.prefix!;

                    // Build S3 Contents: some keys in scope, some out of scope
                    const contents = keySpecs.map(({ keySuffix, inScope }) => ({
                        Key: inScope ? `${prefix}${keySuffix}` : `zzz-other/${keySuffix}`,
                        Size: 100,
                        LastModified: new Date(),
                        ETag: '"abc123"',
                    }));

                    const send = jest.fn().mockResolvedValue({
                        Contents: contents,
                        CommonPrefixes: [],
                        IsTruncated: false,
                    });

                    const service = new S3Service(makeFactory(send));
                    const page = await service.listObjects(
                        'test-bucket',
                        prefix,
                        'us-east-1',
                        undefined,
                        bucketConfig,
                    );

                    // Every returned object key must start with the configured prefix
                    for (const obj of page.objects) {
                        expect(obj.key.startsWith(prefix)).toBe(true);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
