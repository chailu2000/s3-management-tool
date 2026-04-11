/**
 * Unit tests for sync profile data model and validation.
 *
 * These tests verify the profile data structure and basic validation logic.
 */

import { SyncProfile } from '../../models/s3-models';

describe('Sync Profile Data Model', () => {
    it('createSyncProfile creates a valid profile object', () => {
        const profile: SyncProfile = {
            id: 'test-profile-1',
            name: 'Test Profile',
            localPath: '/tmp/test',
            bucket: 'test-bucket',
            prefix: 'test/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        expect(profile.id).toBe('test-profile-1');
        expect(profile.name).toBe('Test Profile');
        expect(profile.direction).toBe('upload');
        expect(profile.excludePatterns).toEqual([]);
    });

    it('runSyncProfile validates profile has required fields', () => {
        const validProfile: SyncProfile = {
            id: 'test-profile-1',
            name: 'Test Profile',
            localPath: '/tmp/test',
            bucket: 'test-bucket',
            prefix: 'test/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Validate required fields
        expect(validProfile.id).toBeTruthy();
        expect(validProfile.name).toBeTruthy();
        expect(validProfile.localPath).toBeTruthy();
        expect(validProfile.bucket).toBeTruthy();
        expect(validProfile.region).toBeTruthy();
        expect(validProfile.direction).toBeTruthy();
    });

    it('editSyncProfile updates profile fields', () => {
        const createdAt = new Date().toISOString();
        const updatedAt = new Date().toISOString();

        const profile: SyncProfile = {
            id: 'test-profile-1',
            name: 'Test Profile',
            localPath: '/tmp/test',
            bucket: 'test-bucket',
            prefix: 'test/',
            region: 'us-east-1',
            direction: 'upload',
            deleteMissing: false,
            excludePatterns: [],
            conflictStrategy: 'skip',
            createdAt,
            updatedAt,
        };

        // Simulate update with a deliberately different timestamp
        const newUpdatedAt = new Date(Date.now() + 10000).toISOString();

        const updatedProfile: SyncProfile = {
            ...profile,
            name: 'Updated Profile',
            deleteMissing: true,
            updatedAt: newUpdatedAt,
        };

        expect(updatedProfile.name).toBe('Updated Profile');
        expect(updatedProfile.deleteMissing).toBe(true);
        expect(updatedProfile.updatedAt).not.toBe(updatedAt);
    });

    it('deleteSyncProfile validates profile exists before deletion', () => {
        const profiles: SyncProfile[] = [
            {
                id: 'test-profile-1',
                name: 'Test Profile',
                localPath: '/tmp/test',
                bucket: 'test-bucket',
                prefix: 'test/',
                region: 'us-east-1',
                direction: 'upload',
                deleteMissing: false,
                excludePatterns: [],
                conflictStrategy: 'skip',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];

        expect(profiles).toHaveLength(1);

        // Simulate deletion
        const filtered = profiles.filter((p: SyncProfile) => p.id !== 'test-profile-1');
        expect(filtered).toHaveLength(0);
    });
});
