/**
 * E2E Test: Incremental Sync
 *
 * Tests:
 * 1. Perform initial sync
 * 2. Modify one fixture file
 * 3. Re-run syncLocalToS3
 * 4. Assert only the modified file was uploaded
 *
 * Requirements: 13.4
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SyncService, CancellationToken } from '../../services/sync-service';
import { SyncOptions } from '../../models/s3-models';
import {
    createLocalStackS3Client,
    createTestBucket,
    deleteTestBucket,
    generateTestBucketName,
} from './localstack-helper';

describe('E2E: Incremental Sync', () => {
    let s3Client: S3Client;
    let syncService: SyncService;
    let testBucketName: string;
    let tempLocalDir: string;

    beforeAll(async () => {
        s3Client = createLocalStackS3Client();
        testBucketName = generateTestBucketName();

        // Create temp directory with test files
        tempLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-sync-'));
        fs.writeFileSync(path.join(tempLocalDir, 'unchanged.txt'), 'This file will not change');
        fs.writeFileSync(path.join(tempLocalDir, 'modified.txt'), 'Original content');
        fs.writeFileSync(path.join(tempLocalDir, 'new.txt'), 'This is a new file');

        // Create test bucket
        await createTestBucket(s3Client, testBucketName);
    });

    afterAll(async () => {
        await deleteTestBucket(s3Client, testBucketName);
        fs.rmSync(tempLocalDir, { recursive: true, force: true });
        s3Client.destroy();
    });

    it('should perform initial sync', async () => {
        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: '',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => {});

        expect(result.status).toBe('completed');
        expect(result.uploaded).toBe(3); // All 3 files uploaded
        expect(result.skipped).toBe(0);
        expect(result.errors).toHaveLength(0);
    });

    it('should only upload modified file on second sync', async () => {
        // Modify one file
        fs.writeFileSync(path.join(tempLocalDir, 'modified.txt'), 'Modified content - this is different');

        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: '',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => {});

        // Only the modified file should be uploaded
        expect(result.uploaded).toBe(1);
        expect(result.skipped).toBe(2); // unchanged.txt and new.txt
        expect(result.errors).toHaveLength(0);

        // Verify the modified content is in S3
        const response = await s3Client.send(
            new GetObjectCommand({
                Bucket: testBucketName,
                Key: 'modified.txt',
            }),
        );

        const bodyBuffer = await streamToBuffer(response.Body as any);
        expect(bodyBuffer.toString()).toBe('Modified content - this is different');
    });

    it('should upload new files and skip unchanged files', async () => {
        // Add a new file
        fs.writeFileSync(path.join(tempLocalDir, 'another-new.txt'), 'Another new file');

        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: '',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => {});

        // Only the new file should be uploaded
        expect(result.uploaded).toBe(1);
        expect(result.skipped).toBe(3); // The other 3 files unchanged
        expect(result.errors).toHaveLength(0);
    });
});

/**
 * Creates a mock S3Service that uses LocalStack S3 client directly
 */
function createMockS3Service(s3Client: S3Client, bucketName: string) {
    return {
        listObjects: async (bucket: string, prefix: string, region: string, continuationToken?: string) => {
            const response = await s3Client.send(
                new ListObjectsV2Command({
                    Bucket: bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                }),
            );

            return {
                objects: (response.Contents || []).map((obj) => ({
                    key: obj.Key!,
                    size: obj.Size || 0,
                    lastModified: obj.LastModified || new Date(),
                    etag: obj.ETag || '',
                    storageClass: obj.StorageClass || 'STANDARD',
                })),
                commonPrefixes: response.CommonPrefixes?.map((p) => p.Prefix!) || [],
                nextContinuationToken: response.NextContinuationToken,
                isTruncated: response.IsTruncated || false,
            };
        },

        getObject: async (bucket: string, key: string, region: string) => {
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
            return response.Body;
        },

        putObject: async (bucket: string, key: string, body: Buffer, region: string) => {
            await s3Client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                }),
            );
        },

        deleteObject: async (bucket: string, key: string, region: string) => {
            await s3Client.send(
                new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
        },
    };
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
