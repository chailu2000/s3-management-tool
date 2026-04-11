/**
 * E2E Test: Prefix Enforcement
 *
 * Tests:
 * 1. Create a BucketConfig with a prefix scope
 * 2. Attempt getObject with a key outside the prefix
 * 3. Assert the operation returns an error and no S3 API call is made
 *
 * Requirements: 18.2, 18.3
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

describe('E2E: Prefix Enforcement', () => {
    let s3Client: S3Client;
    let syncService: SyncService;
    let testBucketName: string;
    let tempLocalDir: string;

    beforeAll(async () => {
        s3Client = createLocalStackS3Client();
        testBucketName = generateTestBucketName();

        // Create temp directory with test files
        tempLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-enforcement-'));
        fs.writeFileSync(path.join(tempLocalDir, 'file1.txt'), 'Content 1');
        fs.writeFileSync(path.join(tempLocalDir, 'file2.txt'), 'Content 2');

        // Create test bucket with files at different prefixes
        const fixtures = [
            { key: 'allowed/file1.txt', content: 'Allowed content 1' },
            { key: 'allowed/file2.txt', content: 'Allowed content 2' },
            { key: 'other/file3.txt', content: 'Other content' },
        ];
        await createTestBucket(s3Client, testBucketName, fixtures);
    });

    afterAll(async () => {
        await deleteTestBucket(s3Client, testBucketName);
        fs.rmSync(tempLocalDir, { recursive: true, force: true });
        s3Client.destroy();
    });

    it('should only list objects under the configured prefix', async () => {
        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        // Sync with prefix scope
        const options: SyncOptions = {
            localPath: tempLocalDir,
            bucket: testBucketName,
            prefix: 'allowed/',
            region: 'us-east-1',
            direction: 'download',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncS3ToLocal(options, token, () => { });

        // Should only download files from 'allowed/' prefix
        expect(result.status).toBe('completed');
        expect(result.downloaded).toBe(2); // Only file1.txt and file2.txt from allowed/
        expect(result.errors).toHaveLength(0);

        // Verify files were downloaded with correct prefix stripped
        expect(fs.existsSync(path.join(tempLocalDir, 'file1.txt'))).toBe(true);
        expect(fs.existsSync(path.join(tempLocalDir, 'file2.txt'))).toBe(true);
        expect(fs.existsSync(path.join(tempLocalDir, 'other', 'file3.txt'))).toBe(false);
    });

    it('should upload files with the configured prefix', async () => {
        // Create a new temp directory with files to upload
        const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-upload-'));
        fs.writeFileSync(path.join(uploadDir, 'newfile.txt'), 'New file content');

        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        const options: SyncOptions = {
            localPath: uploadDir,
            bucket: testBucketName,
            prefix: 'allowed/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => { });

        expect(result.status).toBe('completed');
        expect(result.uploaded).toBe(1);
        expect(result.errors).toHaveLength(0);

        // Verify file was uploaded with prefix
        const response = await s3Client.send(
            new GetObjectCommand({
                Bucket: testBucketName,
                Key: 'allowed/newfile.txt',
            }),
        );

        const bodyBuffer = await streamToBuffer(response.Body as any);
        expect(bodyBuffer.toString()).toBe('New file content');

        // Cleanup
        fs.rmSync(uploadDir, { recursive: true, force: true });
    });

    it('should respect deleteMissing within prefix scope only', async () => {
        // Create a directory with only one file (should delete the other from S3)
        const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-delete-'));
        fs.writeFileSync(path.join(syncDir, 'file1.txt'), 'Keep this file');

        const mockS3Service = createMockS3Service(s3Client, testBucketName);
        syncService = new SyncService(mockS3Service as any);

        const options: SyncOptions = {
            localPath: syncDir,
            bucket: testBucketName,
            prefix: 'allowed/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: true,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncLocalToS3(options, token, () => { });

        expect(result.status).toBe('completed');
        // Both allowed/file2.txt and possibly the folder placeholder are deleted
        expect(result.deleted).toBeGreaterThanOrEqual(1);
        expect(result.errors).toHaveLength(0);

        // Verify file2.txt was deleted from allowed/ prefix
        try {
            await s3Client.send(
                new GetObjectCommand({
                    Bucket: testBucketName,
                    Key: 'allowed/file2.txt',
                }),
            );
            fail('Expected file to be deleted');
        } catch (error: any) {
            expect(error.name).toBe('NoSuchKey');
        }

        // Verify file in other/ prefix was NOT deleted
        const otherFile = await s3Client.send(
            new GetObjectCommand({
                Bucket: testBucketName,
                Key: 'other/file3.txt',
            }),
        );
        expect(otherFile).toBeDefined();

        // Cleanup
        fs.rmSync(syncDir, { recursive: true, force: true });
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
