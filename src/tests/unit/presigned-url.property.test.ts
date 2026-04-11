// Feature: s3-management-tool, Property 10: Presigned URL expiry validation

// Mock vscode before importing modules that depend on it
jest.mock('vscode', () => ({
    window: {
        showInputBox: jest.fn(),
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
    },
    env: { clipboard: { writeText: jest.fn() } },
}), { virtual: true });

import * as fc from 'fast-check';
import { validateExpiryMinutes } from '../../commands/generate-presigned-url';

/**
 * Property 10: Presigned URL expiry validation
 * Validates: Requirements 12.1, 12.4
 */
describe('Property 10: Presigned URL expiry validation', () => {
    it('rejects values > 10080', () => {
        // Feature: s3-management-tool, Property 10: Presigned URL expiry validation
        fc.assert(
            fc.property(fc.integer({ min: 10081 }), (minutes) => {
                const result = validateExpiryMinutes(minutes);
                return result.valid === false;
            }),
            { numRuns: 100 },
        );
    });

    it('accepts values in range 1–10080', () => {
        // Feature: s3-management-tool, Property 10: Presigned URL expiry validation
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 10080 }), (minutes) => {
                const result = validateExpiryMinutes(minutes);
                return result.valid === true;
            }),
            { numRuns: 100 },
        );
    });

    it('rejects values < 1 (zero and negative)', () => {
        // Feature: s3-management-tool, Property 10: Presigned URL expiry validation
        fc.assert(
            fc.property(fc.integer({ max: 0 }), (minutes) => {
                const result = validateExpiryMinutes(minutes);
                return result.valid === false;
            }),
            { numRuns: 100 },
        );
    });
});
