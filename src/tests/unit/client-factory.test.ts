/**
 * Unit tests for S3ClientFactory
 * Requirements: 20.1, 20.4
 */

import { S3Client } from '@aws-sdk/client-s3';
import { S3ClientFactory } from '../../aws/client-factory';
import { AwsCredentials } from '../../models/s3-models';

// Mock the S3Client constructor so we can track instantiation without real AWS calls
jest.mock('@aws-sdk/client-s3', () => {
    const mockDestroy = jest.fn();
    const MockS3Client = jest.fn().mockImplementation(() => ({ destroy: mockDestroy }));
    return { S3Client: MockS3Client };
});

const MockS3Client = S3Client as jest.MockedClass<typeof S3Client>;

const testCredentials: AwsCredentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

beforeEach(() => {
    MockS3Client.mockClear();
    // Reset the destroy mock on each instance
    (MockS3Client as any).mockImplementation(() => ({ destroy: jest.fn() }));
});

describe('S3ClientFactory', () => {
    describe('getClient — cache hit', () => {
        it('returns the same instance for the same region', () => {
            const factory = new S3ClientFactory({ credentials: testCredentials });

            const first = factory.getClient('us-east-1');
            const second = factory.getClient('us-east-1');

            expect(first).toBe(second);
            // S3Client constructor called only once
            expect(MockS3Client).toHaveBeenCalledTimes(1);
        });
    });

    describe('getClient — cache miss', () => {
        it('creates a new client for a different region', () => {
            const factory = new S3ClientFactory({ credentials: testCredentials });

            const east = factory.getClient('us-east-1');
            const west = factory.getClient('us-west-2');

            expect(east).not.toBe(west);
            expect(MockS3Client).toHaveBeenCalledTimes(2);
        });

        it('passes the correct region to S3Client', () => {
            const factory = new S3ClientFactory();

            factory.getClient('eu-west-1');

            expect(MockS3Client).toHaveBeenCalledWith(
                expect.objectContaining({ region: 'eu-west-1' })
            );
        });
    });

    describe('updateCredentials', () => {
        it('clears the cache so subsequent getClient creates a new instance', () => {
            const factory = new S3ClientFactory({ credentials: testCredentials });

            const before = factory.getClient('us-east-1');
            expect(factory.getCacheSize()).toBe(1);

            const newCreds: AwsCredentials = {
                accessKeyId: 'NEWKEYID',
                secretAccessKey: 'NEWSECRET',
            };
            factory.updateCredentials(newCreds);

            expect(factory.getCacheSize()).toBe(0);

            const after = factory.getClient('us-east-1');
            expect(after).not.toBe(before);
            // Two total constructions: one before, one after
            expect(MockS3Client).toHaveBeenCalledTimes(2);
        });

        it('uses new credentials for clients created after the update', () => {
            const factory = new S3ClientFactory({ credentials: testCredentials });
            factory.getClient('us-east-1'); // prime cache

            const newCreds: AwsCredentials = {
                accessKeyId: 'NEWKEYID',
                secretAccessKey: 'NEWSECRET',
            };
            factory.updateCredentials(newCreds);
            factory.getClient('us-east-1');

            const lastCall = MockS3Client.mock.calls[MockS3Client.mock.calls.length - 1][0] as any;
            expect(lastCall.credentials.accessKeyId).toBe('NEWKEYID');
        });
    });

    describe('dispose', () => {
        it('destroys all cached clients and clears the cache', () => {
            const destroyMocks: jest.Mock[] = [];
            (MockS3Client as any).mockImplementation(() => {
                const destroy = jest.fn();
                destroyMocks.push(destroy);
                return { destroy };
            });

            const factory = new S3ClientFactory({ credentials: testCredentials });
            factory.getClient('us-east-1');
            factory.getClient('us-west-2');

            factory.dispose();

            expect(factory.getCacheSize()).toBe(0);
            for (const destroy of destroyMocks) {
                expect(destroy).toHaveBeenCalledTimes(1);
            }
        });
    });
});
