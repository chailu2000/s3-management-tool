/**
 * Unit tests for CredentialProvider
 * Requirements: 2.1, 2.2
 */

import { CredentialProvider } from '../../services/credential-provider';

// ---------------------------------------------------------------------------
// Mock @aws-sdk/credential-providers
// ---------------------------------------------------------------------------
jest.mock('@aws-sdk/credential-providers', () => ({
    fromIni: jest.fn(),
    fromInstanceMetadata: jest.fn(),
}));

import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
const mockFromIni = fromIni as jest.Mock;
const mockFromInstanceMetadata = fromInstanceMetadata as jest.Mock;

// ---------------------------------------------------------------------------
// Mock vscode.SecretStorage
// ---------------------------------------------------------------------------
function makeSecretStorage(initial: Record<string, string> = {}): {
    store: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
    onDidChange: jest.Mock;
} {
    const store: Record<string, string> = { ...initial };
    return {
        store: jest.fn(async (key: string, value: string) => { store[key] = value; }),
        get: jest.fn(async (key: string) => store[key]),
        delete: jest.fn(async (key: string) => { delete store[key]; }),
        onDidChange: jest.fn(),
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ORIGINAL_ENV = process.env;

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockFromIni.mockReset();
    mockFromInstanceMetadata.mockReset();
    // Default: IAM role fails (so it doesn't interfere with other tests)
    mockFromInstanceMetadata.mockReturnValue(() => Promise.reject(new Error('no metadata')));
});

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// Priority chain — env vars
// ---------------------------------------------------------------------------

describe('getCredentials — env var priority', () => {
    it('returns env var credentials when AWS_ACCESS_KEY_ID is set', async () => {
        process.env.AWS_ACCESS_KEY_ID = 'ENV_KEY';
        process.env.AWS_SECRET_ACCESS_KEY = 'ENV_SECRET';
        delete process.env.AWS_SESSION_TOKEN;

        const provider = new CredentialProvider(makeSecretStorage() as any);
        const creds = await provider.getCredentials();

        expect(creds.accessKeyId).toBe('ENV_KEY');
        expect(creds.secretAccessKey).toBe('ENV_SECRET');
        expect(creds.sessionToken).toBeUndefined();
    });

    it('includes session token from env when present', async () => {
        process.env.AWS_ACCESS_KEY_ID = 'ENV_KEY';
        process.env.AWS_SECRET_ACCESS_KEY = 'ENV_SECRET';
        process.env.AWS_SESSION_TOKEN = 'ENV_TOKEN';

        const provider = new CredentialProvider(makeSecretStorage() as any);
        const creds = await provider.getCredentials();

        expect(creds.sessionToken).toBe('ENV_TOKEN');
    });

    it('does not call fromIni when env vars are present', async () => {
        process.env.AWS_ACCESS_KEY_ID = 'ENV_KEY';
        process.env.AWS_SECRET_ACCESS_KEY = 'ENV_SECRET';

        const provider = new CredentialProvider(makeSecretStorage() as any);
        await provider.getCredentials('my-profile');

        expect(mockFromIni).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Priority chain — profile
// ---------------------------------------------------------------------------

describe('getCredentials — profile priority', () => {
    it('falls through to profile when env vars are absent', async () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;

        mockFromIni.mockReturnValue(() =>
            Promise.resolve({ accessKeyId: 'PROFILE_KEY', secretAccessKey: 'PROFILE_SECRET' })
        );

        const provider = new CredentialProvider(makeSecretStorage() as any);
        const creds = await provider.getCredentials('my-profile');

        expect(creds.accessKeyId).toBe('PROFILE_KEY');
        expect(creds.profile).toBe('my-profile');
    });
});

// ---------------------------------------------------------------------------
// SecretStorage — store and retrieve
// ---------------------------------------------------------------------------

describe('storeCredentials / getCredentials — SecretStorage', () => {
    it('stores credentials and retrieves them on the next call', async () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;

        const secretStorage = makeSecretStorage();
        const provider = new CredentialProvider(secretStorage as any);

        await provider.storeCredentials({
            accessKeyId: 'STORED_KEY',
            secretAccessKey: 'STORED_SECRET',
        });

        const creds = await provider.getCredentials();

        expect(creds.accessKeyId).toBe('STORED_KEY');
        expect(creds.secretAccessKey).toBe('STORED_SECRET');
    });

    it('stores session token when provided', async () => {
        const secretStorage = makeSecretStorage();
        const provider = new CredentialProvider(secretStorage as any);

        await provider.storeCredentials({
            accessKeyId: 'KEY',
            secretAccessKey: 'SECRET',
            sessionToken: 'TOKEN',
        });

        expect(secretStorage.store).toHaveBeenCalledWith(
            's3-tool-credentials',
            expect.stringContaining('TOKEN')
        );
    });

    it('clearCredentials removes stored credentials', async () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;

        const secretStorage = makeSecretStorage();
        const provider = new CredentialProvider(secretStorage as any);

        await provider.storeCredentials({ accessKeyId: 'KEY', secretAccessKey: 'SECRET' });
        await provider.clearCredentials();

        expect(secretStorage.delete).toHaveBeenCalledWith('s3-tool-credentials');
    });
});

// ---------------------------------------------------------------------------
// listProfiles — parses profile names from credentials file content
// ---------------------------------------------------------------------------

describe('listProfiles — parseProfileNames', () => {
    it('extracts profile names from credentials file content', () => {
        const content = `
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = secret

[dev]
aws_access_key_id = AKIA...
aws_secret_access_key = secret

[prod]
aws_access_key_id = AKIA...
aws_secret_access_key = secret
`;
        const provider = new CredentialProvider(makeSecretStorage() as any);
        const profiles = provider.parseProfileNames(content);

        expect(profiles).toEqual(['default', 'dev', 'prod']);
    });

    it('returns empty array for empty content', () => {
        const provider = new CredentialProvider(makeSecretStorage() as any);
        expect(provider.parseProfileNames('')).toEqual([]);
    });

    it('handles a single profile', () => {
        const provider = new CredentialProvider(makeSecretStorage() as any);
        const profiles = provider.parseProfileNames('[only-profile]\naws_access_key_id = KEY\n');
        expect(profiles).toEqual(['only-profile']);
    });

    it('handles profile names with hyphens and underscores', () => {
        const provider = new CredentialProvider(makeSecretStorage() as any);
        const profiles = provider.parseProfileNames('[my-profile_1]\n[another_profile-2]\n');
        expect(profiles).toEqual(['my-profile_1', 'another_profile-2']);
    });
});

// ---------------------------------------------------------------------------
// Error case — no credentials available
// ---------------------------------------------------------------------------

describe('getCredentials — no credentials', () => {
    it('throws when no credentials are available from any source', async () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;

        const provider = new CredentialProvider(makeSecretStorage() as any);

        await expect(provider.getCredentials()).rejects.toThrow(/No AWS credentials found/);
    });
});
