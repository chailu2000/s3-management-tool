/**
 * Unit tests for BucketStorage
 * Requirements: 4.5, 4.6, 4.7, 16.2
 */

import { BucketStorage } from '../../services/bucket-storage';
import { BucketConfig, SyncProfile } from '../../models/s3-models';

// ---------------------------------------------------------------------------
// Minimal in-memory mock for vscode.ExtensionContext
// ---------------------------------------------------------------------------

function makeContext() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
            update: (key: string, value: unknown): Thenable<void> => {
                store.set(key, value);
                return Promise.resolve();
            },
        },
    } as any; // cast to vscode.ExtensionContext
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBucket(overrides: Partial<BucketConfig> = {}): BucketConfig {
    return {
        id: 'bucket-1',
        name: 'my-bucket',
        region: 'us-east-1',
        addedManually: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeProfile(overrides: Partial<SyncProfile> = {}): SyncProfile {
    return {
        id: 'profile-1',
        name: 'My Profile',
        localPath: '/tmp/local',
        bucket: 'my-bucket',
        region: 'us-east-1',
        direction: 'upload',
        deleteMissing: false,
        excludePatterns: [],
        conflictStrategy: 'skip',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BucketStorage — buckets', () => {
    it('add bucket succeeds and is retrievable', async () => {
        const storage = new BucketStorage(makeContext());
        const bucket = makeBucket();

        await storage.addBucket(bucket);
        const buckets = await storage.getBuckets();

        expect(buckets).toHaveLength(1);
        expect(buckets[0]).toEqual(bucket);
    });

    it('add duplicate bucket (same name + region) throws an informational error', async () => {
        const storage = new BucketStorage(makeContext());
        const bucket = makeBucket();

        await storage.addBucket(bucket);

        await expect(
            storage.addBucket({ ...bucket, id: 'bucket-2' })
        ).rejects.toThrow(/already configured/i);
    });

    it('allows two buckets with the same name but different regions', async () => {
        const storage = new BucketStorage(makeContext());

        await storage.addBucket(makeBucket({ id: 'b1', region: 'us-east-1' }));
        await storage.addBucket(makeBucket({ id: 'b2', region: 'eu-west-1' }));

        const buckets = await storage.getBuckets();
        expect(buckets).toHaveLength(2);
    });

    it('remove bucket by ID removes it from the list', async () => {
        const storage = new BucketStorage(makeContext());
        await storage.addBucket(makeBucket({ id: 'b1' }));
        await storage.addBucket(makeBucket({ id: 'b2', region: 'eu-west-1' }));

        await storage.removeBucket('b1');

        const buckets = await storage.getBuckets();
        expect(buckets).toHaveLength(1);
        expect(buckets[0].id).toBe('b2');
    });

    it('remove non-existent ID is a no-op (no error)', async () => {
        const storage = new BucketStorage(makeContext());
        await storage.addBucket(makeBucket());

        await expect(storage.removeBucket('does-not-exist')).resolves.toBeUndefined();

        const buckets = await storage.getBuckets();
        expect(buckets).toHaveLength(1);
    });
});

describe('BucketStorage — sync profiles', () => {
    it('add sync profile and getSyncProfiles returns it', async () => {
        const storage = new BucketStorage(makeContext());
        const profile = makeProfile();

        await storage.addSyncProfile(profile);
        const profiles = await storage.getSyncProfiles();

        expect(profiles).toHaveLength(1);
        expect(profiles[0]).toEqual(profile);
    });

    it('update sync profile merges fields and updates updatedAt', async () => {
        const storage = new BucketStorage(makeContext());
        const profile = makeProfile({ updatedAt: '2024-01-01T00:00:00.000Z' });
        await storage.addSyncProfile(profile);

        const before = Date.now();
        await storage.updateSyncProfile('profile-1', { name: 'Renamed', deleteMissing: true });
        const after = Date.now();

        const profiles = await storage.getSyncProfiles();
        expect(profiles[0].name).toBe('Renamed');
        expect(profiles[0].deleteMissing).toBe(true);
        // Other fields preserved
        expect(profiles[0].localPath).toBe('/tmp/local');
        // updatedAt is a fresh ISO timestamp
        const updatedMs = new Date(profiles[0].updatedAt).getTime();
        expect(updatedMs).toBeGreaterThanOrEqual(before);
        expect(updatedMs).toBeLessThanOrEqual(after);
    });

    it('update sync profile does not change the id', async () => {
        const storage = new BucketStorage(makeContext());
        await storage.addSyncProfile(makeProfile());

        await storage.updateSyncProfile('profile-1', { id: 'hacked-id' } as any);

        const profiles = await storage.getSyncProfiles();
        expect(profiles[0].id).toBe('profile-1');
    });

    it('update non-existent profile throws', async () => {
        const storage = new BucketStorage(makeContext());

        await expect(
            storage.updateSyncProfile('ghost', { name: 'X' })
        ).rejects.toThrow(/not found/i);
    });

    it('delete sync profile removes it', async () => {
        const storage = new BucketStorage(makeContext());
        await storage.addSyncProfile(makeProfile({ id: 'p1' }));
        await storage.addSyncProfile(makeProfile({ id: 'p2', name: 'Second' }));

        await storage.deleteSyncProfile('p1');

        const profiles = await storage.getSyncProfiles();
        expect(profiles).toHaveLength(1);
        expect(profiles[0].id).toBe('p2');
    });
});
