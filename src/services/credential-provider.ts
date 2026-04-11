/**
 * Credential Provider for the S3 Management Tool
 *
 * Priority chain:
 *  1. Environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 *  2. AWS profile file (~/.aws/credentials)
 *  3. VS Code SecretStorage (key: 's3-tool-credentials')
 *  4. IAM role (EC2/ECS instance metadata)
 *
 * Raw credentials are never exposed outside this service.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { AwsCredentials } from '../models/s3-models';

const SECRET_STORAGE_KEY = 's3-tool-credentials';

export interface ICredentialProvider {
    getCredentials(profile?: string): Promise<AwsCredentials>;
    storeCredentials(credentials: AwsCredentials): Promise<void>;
    clearCredentials(): Promise<void>;
    listProfiles(): Promise<string[]>;
}

export class CredentialProvider implements ICredentialProvider {
    constructor(private readonly secretStorage: vscode.SecretStorage) { }

    /**
     * Returns credentials from the first available source in the priority chain.
     */
    async getCredentials(profile?: string): Promise<AwsCredentials> {
        // 1. Environment variables
        const envCreds = this.getCredentialsFromEnv();
        if (envCreds) {
            return envCreds;
        }

        // 2. AWS profile file
        if (profile) {
            const profileCreds = await this.getCredentialsFromProfile(profile);
            if (profileCreds) {
                return profileCreds;
            }
        }

        // 3. VS Code SecretStorage
        const storedCreds = await this.getCredentialsFromSecretStorage();
        if (storedCreds) {
            return storedCreds;
        }

        // 4. IAM role (instance metadata)
        const iamCreds = await this.getCredentialsFromIAMRole();
        if (iamCreds) {
            return iamCreds;
        }

        throw new Error(
            'No AWS credentials found. Configure credentials via environment variables, ' +
            'an AWS profile, or the "Select AWS Profile" command.'
        );
    }

    /**
     * Persist credentials in VS Code SecretStorage (encrypted at rest).
     * Stored as a JSON blob under a single key to minimise storage entries.
     */
    async storeCredentials(credentials: AwsCredentials): Promise<void> {
        // Only store the fields needed — never log or expose them
        const payload: AwsCredentials = {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
        };
        if (credentials.sessionToken) {
            payload.sessionToken = credentials.sessionToken;
        }
        if (credentials.profile) {
            payload.profile = credentials.profile;
        }
        await this.secretStorage.store(SECRET_STORAGE_KEY, JSON.stringify(payload));
    }

    /**
     * Remove stored credentials from SecretStorage.
     */
    async clearCredentials(): Promise<void> {
        await this.secretStorage.delete(SECRET_STORAGE_KEY);
    }

    /**
     * Parse ~/.aws/credentials and return all profile names.
     */
    async listProfiles(): Promise<string[]> {
        const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
        try {
            if (!fs.existsSync(credentialsPath)) {
                return [];
            }
            const content = fs.readFileSync(credentialsPath, 'utf-8');
            return this.parseProfileNames(content);
        } catch {
            return [];
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private getCredentialsFromEnv(): AwsCredentials | null {
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        if (accessKeyId && secretAccessKey) {
            const creds: AwsCredentials = { accessKeyId, secretAccessKey };
            if (process.env.AWS_SESSION_TOKEN) {
                creds.sessionToken = process.env.AWS_SESSION_TOKEN;
            }
            return creds;
        }
        return null;
    }

    private async getCredentialsFromProfile(profileName: string): Promise<AwsCredentials | null> {
        try {
            const provider = fromIni({ profile: profileName });
            const creds = await provider();
            return {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken,
                profile: profileName,
            };
        } catch {
            return null;
        }
    }

    private async getCredentialsFromSecretStorage(): Promise<AwsCredentials | null> {
        try {
            const raw = await this.secretStorage.get(SECRET_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw) as AwsCredentials;
            if (parsed.accessKeyId && parsed.secretAccessKey) {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }

    private async getCredentialsFromIAMRole(): Promise<AwsCredentials | null> {
        try {
            const provider = fromInstanceMetadata({ timeout: 1000, maxRetries: 1 });
            const creds = await provider();
            return {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken,
            };
        } catch {
            return null;
        }
    }

    /** Visible for testing */
    parseProfileNames(content: string): string[] {
        const profiles: string[] = [];
        const regex = /^\[([^\]]+)\]/gm;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            profiles.push(match[1]);
        }
        return profiles;
    }
}
