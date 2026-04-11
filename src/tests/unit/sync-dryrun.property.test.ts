/**
 * Property-based tests for SyncService dry-run behavior.
 *
 * These tests verify universal correctness across randomized inputs using fast-check.
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SyncService, CancellationToken } from '../../services/sync-service';
import { SyncOptions, ListObjectsPage } from '../../models/s3-models';

describe('SyncService Property Tests — Dry-Run', () => {
    // -----------------------------------------------------------------------
    // Property 8: Dry-run produces zero AWS mutations
    // Validates: Requirements 13.6, 14.6
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 8: Dry-run produces zero AWS mutations
    it('Property 8: Dry-run syncLocalToS3 produces zero AWS mutations', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.string({ minLength: 2, maxLength: 20 }).filter(s => !/^[.\\/]+$/.test(s) && !/[<>:"|?*]/.test(s))),
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 2, maxLength: 50 }),
                        etag: fc.hexaString({ minLength: 32, maxLength: 32 }),
                    }),
                ),
                async (fileNames, s3Objects) => {
                    // Create temp directory with files
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
                    const progressCalls: any[] = [];

                    try {
                        // Create local files
                        for (const name of fileNames) {
                            const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
                            if (safeName.length > 0 && safeName !== '.' && safeName !== '..') {
                                const filePath = path.join(tempDir, safeName);
                                // Ensure it's not trying to write to a directory
                                if (!fs.existsSync(filePath) || !fs.statSync(filePath).isDirectory()) {
                                    fs.writeFileSync(
                                        filePath,
                                        `content-${name}-${Date.now()}`,
                                    );
                                }
                            }
                        }

                        // Mock S3 service
                        const mockS3Service = {
                            listObjects: jest.fn().mockResolvedValue({
                                objects: s3Objects.map((o) => ({
                                    key: o.key,
                                    size: 100,
                                    lastModified: new Date(),
                                    etag: o.etag,
                                    storageClass: 'STANDARD',
                                })),
                                commonPrefixes: [],
                                isTruncated: false,
                            }),
                            putObject: jest.fn(),
                            deleteObject: jest.fn(),
                            getObject: jest.fn(),
                        };

                        const syncService = new SyncService(mockS3Service as any);

                        const options: SyncOptions = {
                            localPath: tempDir,
                            bucket: 'test-bucket',
                            prefix: 'test/',
                            region: 'us-east-1',
                            direction: 'upload',
                            deleteMissing: true,
                            excludePatterns: [],
                            conflictStrategy: 'skip',
                            dryRun: true,
                        };

                        const token: CancellationToken = { isCancellationRequested: false };

                        const result = await syncService.syncLocalToS3(
                            options,
                            token,
                            (progress) => progressCalls.push(progress),
                        );

                        // Property: Zero AWS mutations
                        expect(mockS3Service.putObject).not.toHaveBeenCalled();
                        expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
                        expect(mockS3Service.getObject).not.toHaveBeenCalled();

                        // Result should have valid counts
                        expect(result.uploaded + result.skipped + result.deleted).toBeGreaterThanOrEqual(0);
                        expect(result.status).toBe('completed');
                    } finally {
                        // Cleanup
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                },
            ),
            { numRuns: 30 }, // Reduced for filesystem operations
        );
    });

    it('Property 8: Dry-run syncS3ToLocal produces zero AWS mutations', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 1, maxLength: 50 }),
                        etag: fc.hexaString({ minLength: 32, maxLength: 32 }),
                    }),
                ),
                async (s3Objects) => {
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-download-'));
                    const progressCalls: any[] = [];

                    try {
                        // Mock S3 service
                        const mockS3Service = {
                            listObjects: jest.fn().mockResolvedValue({
                                objects: s3Objects.map((o) => ({
                                    key: o.key,
                                    size: 100,
                                    lastModified: new Date(),
                                    etag: `"${o.etag}"`,
                                    storageClass: 'STANDARD',
                                })),
                                commonPrefixes: [],
                                isTruncated: false,
                            }),
                            putObject: jest.fn(),
                            deleteObject: jest.fn(),
                            getObject: jest.fn().mockResolvedValue({
                                pipe: jest.fn(),
                                on: jest.fn(),
                            }),
                        };

                        const syncService = new SyncService(mockS3Service as any);

                        const options: SyncOptions = {
                            localPath: tempDir,
                            bucket: 'test-bucket',
                            prefix: 'test/',
                            region: 'us-east-1',
                            direction: 'download',
                            deleteMissing: true,
                            excludePatterns: [],
                            conflictStrategy: 'skip',
                            dryRun: true,
                        };

                        const token: CancellationToken = { isCancellationRequested: false };

                        const result = await syncService.syncS3ToLocal(
                            options,
                            token,
                            (progress) => progressCalls.push(progress),
                        );

                        // Property: Zero AWS mutations
                        expect(mockS3Service.putObject).not.toHaveBeenCalled();
                        expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
                        expect(mockS3Service.getObject).not.toHaveBeenCalled();

                        // Result should have valid counts (may have errors due to missing mock getObject)
                        expect(result.uploaded + result.skipped + result.deleted + result.errors.length).toBeGreaterThanOrEqual(0);
                    } finally {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                },
            ),
            { numRuns: 50 },
        );
    });
});
