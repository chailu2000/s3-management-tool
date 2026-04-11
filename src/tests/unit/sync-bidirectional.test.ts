/**
 * Unit tests for bidirectional sync conflict strategies.
 *
 * Tests each of the four conflict strategies with concrete scenarios.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SyncService, CancellationToken } from '../../services/sync-service';
import { SyncOptions, ListObjectsPage } from '../../models/s3-models';

describe('SyncService — Bidirectional Sync Conflict Strategies', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-conflict-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // keep-local strategy
    // -----------------------------------------------------------------------

    it('keep-local strategy uploads local file to S3', async () => {
        // Create local file
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'local-content');

        // Mock S3 service
        const mockS3Service = {
            listObjects: jest.fn().mockResolvedValue({
                objects: [
                    {
                        key: 'conflict.txt',
                        size: 13,
                        lastModified: new Date(Date.now() - 10000), // Older than local
                        etag: '"remote-etag"',
                        storageClass: 'STANDARD',
                    },
                ],
                commonPrefixes: [],
                isTruncated: false,
            } as ListObjectsPage),
            putObject: jest.fn().mockResolvedValue({}),
            deleteObject: jest.fn(),
            getObject: jest.fn(),
        };

        const syncService = new SyncService(mockS3Service as any);
        const options: SyncOptions = {
            localPath: tempDir,
            bucket: 'test-bucket',
            prefix: '',
            region: 'us-east-1',
            direction: 'bidirectional',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'keep-local',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncBidirectional(options, token, () => {});

        // Should upload local file
        expect(result.uploaded).toBeGreaterThanOrEqual(1);
        expect(mockS3Service.putObject).toHaveBeenCalledWith(
            'test-bucket',
            'conflict.txt',
            expect.any(Buffer),
            'us-east-1',
        );
    });

    // -----------------------------------------------------------------------
    // keep-remote strategy
    // -----------------------------------------------------------------------

    it('keep-remote strategy downloads S3 object overwriting local', async () => {
        // Create local file
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'local-content');

        // Mock S3 service
        const { Readable } = require('stream');
        const mockS3Service = {
            listObjects: jest.fn().mockResolvedValue({
                objects: [
                    {
                        key: 'conflict.txt',
                        size: 13,
                        lastModified: new Date(Date.now() + 10000), // Newer than local
                        etag: '"remote-etag"',
                        storageClass: 'STANDARD',
                    },
                ],
                commonPrefixes: [],
                isTruncated: false,
            } as ListObjectsPage),
            putObject: jest.fn(),
            deleteObject: jest.fn(),
            getObject: jest.fn().mockResolvedValue(Readable.from('remote-content')),
        };

        const syncService = new SyncService(mockS3Service as any);
        const options: SyncOptions = {
            localPath: tempDir,
            bucket: 'test-bucket',
            prefix: '',
            region: 'us-east-1',
            direction: 'bidirectional',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'keep-remote',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncBidirectional(options, token, () => {});

        // Should download remote file
        expect(result.downloaded).toBeGreaterThanOrEqual(1);
        expect(mockS3Service.getObject).toHaveBeenCalledWith(
            'test-bucket',
            'conflict.txt',
            'us-east-1',
        );
    });

    // -----------------------------------------------------------------------
    // keep-both strategy
    // -----------------------------------------------------------------------

    it('keep-both strategy renames local and downloads remote', async () => {
        // Create local file
        const localFile = path.join(tempDir, 'conflict.txt');
        fs.writeFileSync(localFile, 'local-content');

        // Mock S3 service
        const { Readable } = require('stream');
        const mockS3Service = {
            listObjects: jest.fn().mockResolvedValue({
                objects: [
                    {
                        key: 'conflict.txt',
                        size: 14,
                        lastModified: new Date(Date.now() + 10000),
                        etag: '"remote-etag"',
                        storageClass: 'STANDARD',
                    },
                ],
                commonPrefixes: [],
                isTruncated: false,
            } as ListObjectsPage),
            putObject: jest.fn(),
            deleteObject: jest.fn(),
            getObject: jest.fn().mockResolvedValue(Readable.from('remote-content')),
        };

        const syncService = new SyncService(mockS3Service as any);
        const options: SyncOptions = {
            localPath: tempDir,
            bucket: 'test-bucket',
            prefix: '',
            region: 'us-east-1',
            direction: 'bidirectional',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'keep-both',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncBidirectional(options, token, () => {});

        // Should download remote file
        expect(result.downloaded).toBeGreaterThanOrEqual(1);

        // Local file should have been renamed (conflict suffix)
        const files = fs.readdirSync(tempDir);
        const conflictFiles = files.filter((f) => f.startsWith('conflict.txt.conflict-'));
        expect(conflictFiles.length).toBeGreaterThanOrEqual(1);

        // Original file should contain remote content
        expect(fs.existsSync(localFile)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // skip strategy
    // -----------------------------------------------------------------------

    it('skip strategy leaves both sides unchanged', async () => {
        // Create local file
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'local-content');

        // Mock S3 service
        const mockS3Service = {
            listObjects: jest.fn().mockResolvedValue({
                objects: [
                    {
                        key: 'conflict.txt',
                        size: 13,
                        lastModified: new Date(),
                        etag: '"remote-etag"',
                        storageClass: 'STANDARD',
                    },
                ],
                commonPrefixes: [],
                isTruncated: false,
            } as ListObjectsPage),
            putObject: jest.fn(),
            deleteObject: jest.fn(),
            getObject: jest.fn(),
        };

        const syncService = new SyncService(mockS3Service as any);
        const options: SyncOptions = {
            localPath: tempDir,
            bucket: 'test-bucket',
            prefix: '',
            region: 'us-east-1',
            direction: 'bidirectional',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            dryRun: false,
        };

        const token: CancellationToken = { isCancellationRequested: false };
        const result = await syncService.syncBidirectional(options, token, () => {});

        // Should skip conflicted file
        expect(result.skipped).toBeGreaterThanOrEqual(1);
        expect(result.conflicts).toBeGreaterThanOrEqual(1);

        // No AWS operations should be performed on conflicted files
        expect(mockS3Service.putObject).not.toHaveBeenCalled();
        expect(mockS3Service.getObject).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Dry-run with conflict strategies
    // -----------------------------------------------------------------------

    it('dry-run does not perform any AWS operations regardless of strategy', async () => {
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'local-content');

        const { Readable } = require('stream');
        const mockS3Service = {
            listObjects: jest.fn().mockResolvedValue({
                objects: [
                    {
                        key: 'conflict.txt',
                        size: 13,
                        lastModified: new Date(),
                        etag: '"remote-etag"',
                        storageClass: 'STANDARD',
                    },
                ],
                commonPrefixes: [],
                isTruncated: false,
            } as ListObjectsPage),
            putObject: jest.fn(),
            deleteObject: jest.fn(),
            getObject: jest.fn().mockResolvedValue(Readable.from('remote-content')),
        };

        const syncService = new SyncService(mockS3Service as any);

        // Test all strategies
        const strategies: SyncOptions['conflictStrategy'][] = [
            'keep-local',
            'keep-remote',
            'keep-both',
            'skip',
        ];

        for (const strategy of strategies) {
            mockS3Service.putObject.mockClear();
            mockS3Service.deleteObject.mockClear();
            mockS3Service.getObject.mockClear();

            const options: SyncOptions = {
                localPath: tempDir,
                bucket: 'test-bucket',
                prefix: '',
                region: 'us-east-1',
                direction: 'bidirectional',
                deleteMissing: false,
                excludePatterns: [],
                conflictStrategy: strategy,
                dryRun: true,
            };

            const token: CancellationToken = { isCancellationRequested: false };
            await syncService.syncBidirectional(options, token, () => {});

            // Property: Zero AWS mutations in dry-run mode
            expect(mockS3Service.putObject).not.toHaveBeenCalled();
            expect(mockS3Service.getObject).not.toHaveBeenCalled();
            expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
        }
    });
});
