/**
 * Property-based tests for SyncService exclude pattern filtering.
 *
 * These tests verify universal correctness across randomized inputs using fast-check.
 */

import * as fc from 'fast-check';
import { matchesExcludePattern } from '../../services/sync-service';

describe('SyncService Property Tests — Exclude Pattern Filtering', () => {
    // -----------------------------------------------------------------------
    // Property 7: Exclude pattern filtering is consistent
    // Validates: Requirements 13.7, 14.7
    // -----------------------------------------------------------------------

    // Feature: s3-management-tool, Property 7: Exclude pattern filtering is consistent
    it('Property 7: Exclude pattern filtering is exhaustive and disjoint', () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 50 })),
                fc.array(
                    fc.oneof(
                        fc.constant('*.log'),
                        fc.constant('*.tmp'),
                        fc.constant('node_modules/**'),
                        fc.constant('.git/**'),
                        fc.constant('**/*.md'),
                        fc.constant('dist/**'),
                        fc.constant('build/**'),
                    ),
                ),
                (filePaths, patterns) => {
                    const matched: string[] = [];
                    const unmatched: string[] = [];

                    for (const filePath of filePaths) {
                        if (matchesExcludePattern(filePath, patterns)) {
                            matched.push(filePath);
                        } else {
                            unmatched.push(filePath);
                        }
                    }

                    // Property: Sets are exhaustive (all files accounted for)
                    expect(matched.length + unmatched.length).toBe(filePaths.length);

                    // Property: Sets are disjoint (no file in both)
                    for (const file of matched) {
                        expect(unmatched).not.toContain(file);
                    }
                    for (const file of unmatched) {
                        expect(matched).not.toContain(file);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('Property 7: Common patterns match expected files', () => {
        // Test specific patterns that should match
        expect(matchesExcludePattern('app.log', ['*.log'])).toBe(true);
        expect(matchesExcludePattern('debug.log', ['*.log'])).toBe(true);
        expect(matchesExcludePattern('node_modules/package/index.js', ['node_modules/**'])).toBe(true);
        expect(matchesExcludePattern('.git/config', ['.git/**'])).toBe(true);
        expect(matchesExcludePattern('docs/README.md', ['**/*.md'])).toBe(true);

        // Test specific patterns that should NOT match
        expect(matchesExcludePattern('app.js', ['*.log'])).toBe(false);
        expect(matchesExcludePattern('src/index.ts', ['node_modules/**'])).toBe(false);
        expect(matchesExcludePattern('package.json', ['.git/**'])).toBe(false);
        expect(matchesExcludePattern('src/main.js', ['**/*.md'])).toBe(false);
    });

    it('Property 7: Empty patterns array matches nothing', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (filePath) => {
                expect(matchesExcludePattern(filePath, [])).toBe(false);
            }),
            { numRuns: 100 },
        );
    });

    it('Property 7: ** matches any path', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (filePath) => {
                expect(matchesExcludePattern(filePath, ['**'])).toBe(true);
            }),
            { numRuns: 100 },
        );
    });
});
