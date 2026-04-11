/**
 * Property-based tests for bidirectional sync conflict classification.
 *
 * These tests verify universal correctness across randomized inputs using fast-check.
 */

import * as fc from 'fast-check';
import { classifyFile } from '../../services/file-classifier';
import { FileClassification } from '../../models/s3-models';

describe('SyncService Property Tests — Conflict Classification', () => {
    // -----------------------------------------------------------------------
    // Property 9: Conflict classification covers all cases
    // Validates: Requirements 15.2
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 9: Conflict classification covers all cases
    it('Property 9: Classification is always exactly one valid value', () => {
        fc.assert(
            fc.property(
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                (localMtime, remoteMtime, lastSyncAt) => {
                    const classification = classifyFile(
                        localMtime ?? undefined,
                        remoteMtime ?? undefined,
                        lastSyncAt ?? undefined,
                    );

                    const validClassifications: FileClassification[] = [
                        'local-only',
                        'remote-only',
                        'unchanged',
                        'local-newer',
                        'remote-newer',
                        'conflicted',
                    ];

                    // Property: Result is always one of the 6 valid values
                    expect(validClassifications).toContain(classification);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: Classification is never undefined', () => {
        fc.assert(
            fc.property(
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                (localMtime, remoteMtime, lastSyncAt) => {
                    const classification = classifyFile(
                        localMtime ?? undefined,
                        remoteMtime ?? undefined,
                        lastSyncAt ?? undefined,
                    );

                    // Property: Never returns undefined
                    expect(classification).toBeDefined();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: Classification is never two values simultaneously', () => {
        fc.assert(
            fc.property(
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                (localMtime, remoteMtime, lastSyncAt) => {
                    const classification = classifyFile(
                        localMtime ?? undefined,
                        remoteMtime ?? undefined,
                        lastSyncAt ?? undefined,
                    );

                    const validClassifications: FileClassification[] = [
                        'local-only',
                        'remote-only',
                        'unchanged',
                        'local-newer',
                        'remote-newer',
                        'conflicted',
                    ];

                    // Property: Count how many valid values match the result
                    const matchCount = validClassifications.filter((v) => v === classification).length;

                    // Property: Exactly one match
                    expect(matchCount).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    });

    // -----------------------------------------------------------------------
    // Specific classification scenarios
    // -----------------------------------------------------------------------

    it('Property 9: local-only when file exists only locally', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e12 }),
                fc.option(fc.integer({ min: 0, max: 1e12 })),
                (localMtime, lastSyncAt) => {
                    const classification = classifyFile(localMtime, undefined, lastSyncAt ?? undefined);
                    expect(classification).toBe('local-only');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: remote-only when file exists only in S3', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e12 }),
                (remoteMtime) => {
                    // localMtime = undefined means file doesn't exist locally
                    const classification = classifyFile(undefined, remoteMtime, undefined);
                    expect(classification).toBe('remote-only');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: conflicted on first sync when both exist', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e12 }),
                fc.integer({ min: 0, max: 1e12 }),
                (localMtime, remoteMtime) => {
                    // lastSyncAt = undefined means first sync
                    const classification = classifyFile(localMtime, remoteMtime, undefined);
                    expect(classification).toBe('conflicted');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: local-newer when only local modified after sync', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 1e9, max: 1e12 }),
                (localMtime, remoteMtime, lastSyncAt) => {
                    // Ensure: localMtime > lastSyncAt > remoteMtime
                    const local = lastSyncAt + 1;
                    const remote = Math.min(remoteMtime, lastSyncAt - 1);

                    const classification = classifyFile(local, remote, lastSyncAt);
                    expect(classification).toBe('local-newer');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: remote-newer when only remote modified after sync', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 1e9, max: 1e12 }),
                (localMtime, remoteMtime, lastSyncAt) => {
                    // Ensure: remoteMtime > lastSyncAt > localMtime
                    const local = Math.min(localMtime, lastSyncAt - 1);
                    const remote = lastSyncAt + 1;

                    const classification = classifyFile(local, remote, lastSyncAt);
                    expect(classification).toBe('remote-newer');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: conflicted when both modified after sync', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 0, max: 1e9 }),
                (localMtime, remoteMtime, lastSyncAt) => {
                    // Ensure: both > lastSyncAt
                    const local = lastSyncAt + 1;
                    const remote = lastSyncAt + 2;

                    const classification = classifyFile(local, remote, lastSyncAt);
                    expect(classification).toBe('conflicted');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 9: unchanged when neither modified after sync', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 0, max: 1e9 }),
                fc.integer({ min: 1e9, max: 1e12 }),
                (localMtime, remoteMtime, lastSyncAt) => {
                    // Ensure: both < lastSyncAt
                    const local = Math.min(localMtime, lastSyncAt - 1);
                    const remote = Math.min(remoteMtime, lastSyncAt - 1);

                    const classification = classifyFile(local, remote, lastSyncAt);
                    expect(classification).toBe('unchanged');
                },
            ),
            { numRuns: 100 },
        );
    });
});
