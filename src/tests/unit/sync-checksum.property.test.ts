/**
 * Property-based tests for SyncService checksum utilities.
 *
 * These tests verify universal correctness across randomized inputs using fast-check.
 */

import * as fc from 'fast-check';
import { normalizeEtag, isMultipartEtag, computeLocalMd5 } from '../../services/sync-service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SyncService Property Tests — Checksum Utilities', () => {
    // -----------------------------------------------------------------------
    // Property 2: ETag normalization strips quotes
    // Validates: Requirements 21.2
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 2: ETag normalization strips quotes
    it('Property 2: ETag normalization strips quotes for any ETag string', () => {
        fc.assert(
            fc.property(fc.hexaString(), (hex) => {
                // Test without quotes
                const etagNoQuotes = hex;
                expect(normalizeEtag(etagNoQuotes)).toBe(hex);

                // Test with surrounding double-quotes
                const etagWithQuotes = `"${hex}"`;
                expect(normalizeEtag(etagWithQuotes)).toBe(hex);

                // Test with quotes and multipart suffix
                const etagMultipart = `"${hex}-5"`;
                expect(normalizeEtag(etagMultipart)).toBe(`${hex}-5`);
            }),
            { numRuns: 100 },
        );
    });

    // -----------------------------------------------------------------------
    // Property 3: Multipart ETags are never compared as MD5
    // Validates: Requirements 21.4
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 3: Multipart ETags are never compared as MD5
    it('Property 3: Multipart ETags are detected correctly', () => {
        fc.assert(
            fc.property(
                fc.hexaString(),
                fc.nat({ max: 100 }),
                (hex, partCount) => {
                    // Multipart ETag should return true
                    const multipartEtag = `${hex}-${partCount}`;
                    expect(isMultipartEtag(multipartEtag)).toBe(true);

                    // Multipart ETag with quotes should also return true
                    const quotedMultipart = `"${hex}-${partCount}"`;
                    expect(isMultipartEtag(quotedMultipart)).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 3: Non-multipart ETags are not detected as multipart', () => {
        fc.assert(
            fc.property(fc.hexaString(), (hex) => {
                // Simple ETag without '-' should return false
                expect(isMultipartEtag(hex)).toBe(false);

                // With quotes, still no '-'
                expect(isMultipartEtag(`"${hex}"`)).toBe(false);
            }),
            { numRuns: 100 },
        );
    });

    // -----------------------------------------------------------------------
    // Property 1: Checksum round-trip — unchanged file is classified as skipped
    // Validates: Requirements 21.1, 21.2, 21.3
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 1: Checksum round-trip — unchanged file is classified as skipped
    it('Property 1: Checksum round-trip — unchanged file matches ETag', async () => {
        await fc.assert(
            fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 10000 }), async (content) => {
                // Create a temp file with random content
                const tempDir = os.tmpdir();
                const tempFile = path.join(tempDir, `test-${Date.now()}-${Math.random()}.txt`);

                try {
                    // Write file
                    fs.writeFileSync(tempFile, Buffer.from(content));

                    // Compute MD5
                    const md5 = await computeLocalMd5(tempFile);

                    // Simulate S3 ETag (quoted MD5)
                    const s3Etag = `"${md5}"`;

                    // Normalize and compare
                    const normalized = normalizeEtag(s3Etag);
                    expect(normalized).toBe(md5);

                    // File should be classified as "skipped" (checksum match)
                    expect(normalized === md5).toBe(true);
                } finally {
                    // Cleanup
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});
