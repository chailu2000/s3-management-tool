/**
 * S3ClientFactory
 *
 * Creates and caches one S3Client per AWS region.
 * On credential update, all cached clients are disposed and the cache is cleared
 * so subsequent calls to getClient() create fresh clients with the new credentials.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
 */

import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { AwsCredentials } from '../models/s3-models';

export interface IS3ClientFactory {
    getClient(region: string): S3Client;
    updateCredentials(credentials: AwsCredentials): void;
    dispose(): void;
}

export class S3ClientFactory implements IS3ClientFactory {
    private readonly cache: Map<string, S3Client> = new Map();
    private credentials: AwsCredentials | undefined;

    constructor(options: { credentials?: AwsCredentials } = {}) {
        this.credentials = options.credentials;
    }

    /**
     * Returns a cached S3Client for the given region, creating one if needed.
     */
    getClient(region: string): S3Client {
        const cached = this.cache.get(region);
        if (cached) {
            return cached;
        }

        const config: S3ClientConfig = { region };
        if (this.credentials) {
            config.credentials = {
                accessKeyId: this.credentials.accessKeyId,
                secretAccessKey: this.credentials.secretAccessKey,
                sessionToken: this.credentials.sessionToken,
            };
        }

        const client = new S3Client(config);
        this.cache.set(region, client);
        return client;
    }

    /**
     * Disposes all cached clients, clears the cache, and stores new credentials
     * so that subsequent getClient() calls use the updated credentials.
     */
    updateCredentials(credentials: AwsCredentials): void {
        this.dispose();
        this.credentials = credentials;
    }

    /**
     * Destroys all cached S3Client instances and clears the cache.
     */
    dispose(): void {
        for (const client of this.cache.values()) {
            client.destroy();
        }
        this.cache.clear();
    }

    /** Visible for testing */
    getCacheSize(): number {
        return this.cache.size;
    }
}
