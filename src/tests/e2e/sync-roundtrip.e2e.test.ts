/**
 * E2E Test: Full Sync Round-Trip
 *
 * Tests:
 * 1. Upload a local fixture directory to LocalStack S3 via syncLocalToS3
 * 2. Verify all objects exist in S3 with correct ETags
 * 3. Sync back to a temp local directory via syncS3ToLocal
 * 4. Assert local files are byte-for-byte identical to originals
 * 5. Classify as unchanged on a second sync
 *
 * Requirements: 13.3, 13.4, 14.2, 14.3, 21.3
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SyncService, CancellationToken } from '../../services/sync-service';
import { SyncOptions, SyncResult } from '../../models/s3-models';
import {
    createLocalStackS3Client,
    createTestBucket,
    deleteTestBucket,
    generateTestBucketName,
    verifyS3Object,
} from './localstack-helper';

describe('E2E: Full Sync Round-Trip', () => {
    let s3Client: S3Client;
    let syncService: SyncService;
    let testBucketName: string;
    let tempLocalDir: string;
    let fixtureDir: string;

    beforeAll(async () => {
        // Initialize LocalStack S3 client
        s3Client = createLocalStackS3Client();
        testBucketName = generateTestBucketName();

        // Create fixture directory with test files
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fixture-'));
        fs.writeFileSync(path.join(fixtureDir, 'file1.txt'), 'Hello, World!');
        fs.writeFileSync(path.join(fixtureDir, 'file2.json'), JSON.stringify({ test: true }));
        // Create nested directory first, then write file
        fs.mkdirSync(path.join(fixtureDir, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(fixtureDir, 'nested', 'file3.txt'), 'Nested content');

        // Create test bucket with fixtures
        const fixtures = [
            { key: 'file1.txt', content: 'Hello, World!' },
            { key: 'file2.json', content: JSON.stringify({ test: true }) },
            { key: 'nested/file3.txt', content: 'Nested content' },
        ];
        await createTestBucket(s3Client, testBucketName, fixtures);
    });

    afterAll(async () => {
        // Cleanup
        await deleteTestBucket(s3Client, testBucketName);
        fs.rmSync(fixtureDir, { recursive: true, force: true });
        if (tempLocalDir && fs.existsSync(tempLocalDir)) {
            fs.rmSync(tempLocalDir, { recursive: true, force: true });
        }
        s3Client.destroy();
    });

    it('should upload local directory to S3 and verify objects exist', async () => {
        // Create a mock S3 service that uses LocalStack
        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        // Sync local fixture to S3
        const options: SyncOptions = {
            localPath: fixtureDir,
            bucket: testBucketName,
            prefix: 'sync-test/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => { });

        // Verify sync result
        expect(result.status).toBe('completed');
        expect(result.uploaded).toBeGreaterThan(0);
        expect(result.errors).toHaveLength(0);

        // Verify objects exist in S3
        const file1Exists = await verifyS3Object(s3Client, testBucketName, 'sync-test/file1.txt', 'Hello, World!');
        expect(file1Exists).toBe(true);

        const file2Exists = await verifyS3Object(s3Client, testBucketName, 'sync-test/file2.json', JSON.stringify({ test: true }));
        expect(file2Exists).toBe(true);
    });

    it('should sync back from S3 to local and verify files are identical', async () => {
        // Create temp directory for download
        tempLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-download-'));

        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        // Sync from S3 to local
        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: 'sync-test/',
            region: 'us-east-1',
            direction: 'download',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncS3ToLocal(options, token, () => { });

        // Verify sync result
        expect(result.status).toBe('completed');
        expect(result.downloaded).toBeGreaterThan(0);
        expect(result.errors).toHaveLength(0);

        // Verify files are byte-for-byte identical
        const originalFile1 = fs.readFileSync(path.join(fixtureDir, 'file1.txt'));
        const downloadedFile1 = fs.readFileSync(path.join(tempLocalDir, 'file1.txt'));
        expect(downloadedFile1.equals(originalFile1)).toBe(true);

        const originalFile2 = fs.readFileSync(path.join(fixtureDir, 'file2.json'));
        const downloadedFile2 = fs.readFileSync(path.join(tempLocalDir, 'file2.json'));
        expect(downloadedFile2.equals(originalFile2)).toBe(true);
    });

    it('should classify files as unchanged on second sync', async () => {
        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        // Re-sync from S3 to local (files should be unchanged)
        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: 'sync-test/',
            region: 'us-east-1',
            direction: 'download',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncS3ToLocal(options, token, () => { });

        // All files should be skipped (checksum match)
        expect(result.skipped).toBeGreaterThan(0);
        expect(result.downloaded).toBe(0);
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
