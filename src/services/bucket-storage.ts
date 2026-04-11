/**
 * BucketStorage — persists BucketConfig[] and SyncProfile[] in VS Code globalState.
 * Requirements: 4.5, 4.6, 4.7, 16.2, 16.4
 */

import * as vscode from 'vscode';
import { BucketConfig, SyncProfile } from '../models/s3-models';

const BUCKETS_KEY = 's3-tool-buckets';
const PROFILES_KEY = 's3-tool-sync-profiles';

export class BucketStorage {
    constructor(private readonly context: vscode.ExtensionContext) { }

    // -------------------------------------------------------------------------
    // Buckets
    // -------------------------------------------------------------------------

    async getBuckets(): Promise<BucketConfig[]> {
        return this.context.globalState.get<BucketConfig[]>(BUCKETS_KEY) ?? [];
    }

    async addBucket(config: BucketConfig): Promise<void> {
        const buckets = await this.getBuckets();
        const duplicate = buckets.find(
            (b) => b.name === config.name && b.region === config.region
        );
        if (duplicate) {
            throw new Error(
                `Bucket "${config.name}" in region "${config.region}" is already configured.`
            );
        }
        buckets.push(config);
        await this.context.globalState.update(BUCKETS_KEY, buckets);
    }

    async removeBucket(id: string): Promise<void> {
        const buckets = await this.getBuckets();
        const filtered = buckets.filter((b) => b.id !== id);
        await this.context.globalState.update(BUCKETS_KEY, filtered);
    }

    // -------------------------------------------------------------------------
    // Sync Profiles
    // -------------------------------------------------------------------------

    async getSyncProfiles(): Promise<SyncProfile[]> {
        return this.context.globalState.get<SyncProfile[]>(PROFILES_KEY) ?? [];
    }

    async addSyncProfile(profile: SyncProfile): Promise<void> {
        const profiles = await this.getSyncProfiles();
        profiles.push(profile);
        await this.context.globalState.update(PROFILES_KEY, profiles);
    }

    async updateSyncProfile(id: string, updates: Partial<SyncProfile>): Promise<void> {
        const profiles = await this.getSyncProfiles();
        const index = profiles.findIndex((p) => p.id === id);
        if (index === -1) {
            throw new Error(`Sync profile with id "${id}" not found.`);
        }
        profiles[index] = {
            ...profiles[index],
            ...updates,
            id,                              // id is immutable
            updatedAt: new Date().toISOString(),
        };
        await this.context.globalState.update(PROFILES_KEY, profiles);
    }

    async deleteSyncProfile(id: string): Promise<void> {
        const profiles = await this.getSyncProfiles();
        const filtered = profiles.filter((p) => p.id !== id);
        await this.context.globalState.update(PROFILES_KEY, filtered);
    }
}
