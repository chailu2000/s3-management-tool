/**
 * Unit tests for command-level bug fixes
 *
 * Covers:
 * 1. removeBucket receives S3BucketItem and extracts config correctly (no more "undefined" in messages)
 * 2. addBucketByName auto-detects bucket region instead of using user input
 * 3. addBucketWithPrefix auto-detects bucket region
 * 4. addBucketByArn auto-detects bucket region
 */

// ---------------------------------------------------------------------------
// Mock vscode before any imports that reference it
// ---------------------------------------------------------------------------

const mockShowWarningMessage = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockShowInputBox = jest.fn();

jest.mock('vscode', () => {
    class TreeItem {
        label: string;
        collapsibleState: number;
        description?: string;
        iconPath?: unknown;
        tooltip?: string;
        contextValue?: string;

        constructor(label: string, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }

    class ThemeIcon {
        id: string;
        constructor(id: string) { this.id = id; }
    }

    class EventEmitter {
        event = jest.fn();
        fire = jest.fn();
    }

    return {
        TreeItem,
        ThemeIcon,
        EventEmitter,
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2,
        },
        window: {
            showWarningMessage: (...args: any[]) => mockShowWarningMessage(...args),
            showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
            showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
            showInputBox: (...args: any[]) => mockShowInputBox(...args),
        },
    };
}, { virtual: true });

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockRemoveBucket = jest.fn();
const mockAddBucket = jest.fn();
const mockRefresh = jest.fn();
const mockValidateBucketAccess = jest.fn();
const mockGetBucketRegion = jest.fn();

jest.mock('../../services/bucket-storage', () => ({
    BucketStorage: jest.fn().mockImplementation(() => ({
        removeBucket: mockRemoveBucket,
        addBucket: mockAddBucket,
        getBuckets: jest.fn().mockResolvedValue([]),
    })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
    S3BucketItem,
    S3PrefixItem,
    S3ObjectItem,
    S3ErrorItem,
} from '../../views/s3-tree-provider';
import { BucketConfig } from '../../models/s3-models';

// Import commands - these need to be re-imported per test to reset mocks
async function importRemoveBucket() {
    return await import('../../commands/remove-bucket');
}

async function importAddBucketByName() {
    return await import('../../commands/add-bucket-by-name');
}

async function importAddBucketWithPrefix() {
    return await import('../../commands/add-bucket-with-prefix');
}

async function importAddBucketByArn() {
    return await import('../../commands/add-bucket-by-arn');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBucketConfig(overrides: Partial<BucketConfig> = {}): BucketConfig {
    return {
        id: 'test-bucket-id',
        name: 'my-test-bucket',
        region: 'us-east-1',
        addedManually: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeMockStorage(addBucketImpl?: jest.Mock) {
    return {
        removeBucket: mockRemoveBucket,
        addBucket: addBucketImpl ?? mockAddBucket,
        getBuckets: jest.fn().mockResolvedValue([]),
    } as any;
}

function makeMockS3Service(overrides: Partial<Record<string, jest.Mock>> = {}) {
    return {
        validateBucketAccess: overrides.validateBucketAccess ?? mockValidateBucketAccess,
        getBucketRegion: overrides.getBucketRegion ?? mockGetBucketRegion,
    } as any;
}

function makeMockTreeProvider() {
    return {
        refresh: mockRefresh,
    } as any;
}

// ---------------------------------------------------------------------------
// Bug Fix 1: removeBucket handles S3BucketItem correctly
// ---------------------------------------------------------------------------

describe('Bug Fix 1: removeBucket handles S3BucketItem', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShowWarningMessage.mockResolvedValue('Remove');
    });

    it('extracts config from S3BucketItem and shows correct bucket name', async () => {
        const { removeBucket } = await importRemoveBucket();
        const item = new S3BucketItem(makeBucketConfig({ name: 'my-bucket' }));

        await removeBucket(item, makeMockStorage(), makeMockTreeProvider());

        expect(mockRemoveBucket).toHaveBeenCalledWith('test-bucket-id');
        expect(mockRefresh).toHaveBeenCalled();
        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "my-bucket" removed from the extension.'
        );
    });

    it('extracts config from S3BucketItem with prefix and shows correct name', async () => {
        const { removeBucket } = await importRemoveBucket();
        const item = new S3BucketItem(makeBucketConfig({
            name: 'prefixed-bucket',
            prefix: 'logs/',
        }));

        await removeBucket(item, makeMockStorage(), makeMockTreeProvider());

        expect(mockRemoveBucket).toHaveBeenCalledWith('test-bucket-id');
        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "prefixed-bucket" removed from the extension.'
        );
    });

    it('accepts raw BucketConfig and processes correctly', async () => {
        const { removeBucket } = await importRemoveBucket();
        const config = makeBucketConfig({ name: 'raw-config-bucket', id: 'config-id' });

        await removeBucket(config, makeMockStorage(), makeMockTreeProvider());

        expect(mockRemoveBucket).toHaveBeenCalledWith('config-id');
        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "raw-config-bucket" removed from the extension.'
        );
    });

    it('shows confirmation dialog with correct bucket name', async () => {
        const { removeBucket } = await importRemoveBucket();
        const item = new S3BucketItem(makeBucketConfig({ name: 'confirm-test-bucket' }));

        await removeBucket(item, makeMockStorage(), makeMockTreeProvider());

        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            "Remove bucket 'confirm-test-bucket'? This will not delete the bucket from AWS.",
            { modal: true },
            'Remove',
        );
    });

    it('does nothing when user cancels confirmation', async () => {
        const { removeBucket } = await importRemoveBucket();
        mockShowWarningMessage.mockResolvedValue(undefined);
        const item = new S3BucketItem(makeBucketConfig({ name: 'cancel-bucket' }));

        await removeBucket(item, makeMockStorage(), makeMockTreeProvider());

        expect(mockRemoveBucket).not.toHaveBeenCalled();
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Bug Fix 2: addBucketByName auto-detects region
// ---------------------------------------------------------------------------

describe('Bug Fix 2: addBucketByName auto-detects region', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShowInputBox.mockReset();

        // Default: user enters us-east-1 but bucket is actually in us-east-2
        mockShowInputBox
            .mockResolvedValueOnce('my-bucket')     // bucket name
            .mockResolvedValueOnce('us-east-1');    // user enters wrong region

        mockValidateBucketAccess.mockResolvedValue({ valid: true });
        mockGetBucketRegion.mockResolvedValue('us-east-2');
    });

    it('auto-detects actual bucket region instead of using user input', async () => {
        const { addBucketByName } = await importAddBucketByName();
        const addBucketMock = jest.fn();

        await addBucketByName(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        // Should have called validateBucketAccess
        expect(mockValidateBucketAccess).toHaveBeenCalledWith('my-bucket');

        // Should have auto-detected the region
        expect(mockGetBucketRegion).toHaveBeenCalledWith('my-bucket');

        // Should have stored with the ACTUAL region (us-east-2), not user input (us-east-1)
        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'my-bucket',
                region: 'us-east-2',  // Auto-detected, not user input
                addedManually: true,
            })
        );
    });

    it('stores bucket with correct name', async () => {
        const { addBucketByName } = await importAddBucketByName();
        const addBucketMock = jest.fn();

        await addBucketByName(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'my-bucket',
            })
        );
    });

    it('refreshes tree provider after adding bucket', async () => {
        const { addBucketByName } = await importAddBucketByName();
        const addBucketMock = jest.fn();

        await addBucketByName(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(mockRefresh).toHaveBeenCalled();
    });

    it('shows success message with bucket name', async () => {
        const { addBucketByName } = await importAddBucketByName();
        const addBucketMock = jest.fn();

        await addBucketByName(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "my-bucket" added successfully.'
        );
    });

    it('does not add bucket if validation fails', async () => {
        mockValidateBucketAccess.mockResolvedValue({
            valid: false,
            error: 'Access denied',
        });

        const { addBucketByName } = await importAddBucketByName();
        const addBucketMock = jest.fn();

        await addBucketByName(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).not.toHaveBeenCalled();
        expect(mockGetBucketRegion).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Bug Fix 3: addBucketWithPrefix auto-detects region
// ---------------------------------------------------------------------------

describe('Bug Fix 3: addBucketWithPrefix auto-detects region', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShowInputBox.mockReset();

        mockShowInputBox
            .mockResolvedValueOnce('my-prefix-bucket')  // bucket name
            .mockResolvedValueOnce('us-east-1')         // user enters wrong region
            .mockResolvedValueOnce('files/');           // prefix

        mockValidateBucketAccess.mockResolvedValue({ valid: true });
        mockGetBucketRegion.mockResolvedValue('eu-west-1');
    });

    it('auto-detects actual bucket region instead of using user input', async () => {
        const { addBucketWithPrefix } = await importAddBucketWithPrefix();
        const addBucketMock = jest.fn();

        await addBucketWithPrefix(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        // Should have called validateBucketAccess with prefix
        expect(mockValidateBucketAccess).toHaveBeenCalledWith('my-prefix-bucket', 'files/');

        // Should have auto-detected the region
        expect(mockGetBucketRegion).toHaveBeenCalledWith('my-prefix-bucket');

        // Should have stored with the ACTUAL region (eu-west-1), not user input (us-east-1)
        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'my-prefix-bucket',
                region: 'eu-west-1',  // Auto-detected
                prefix: 'files/',
                addedManually: true,
            })
        );
    });

    it('stores bucket with correct prefix', async () => {
        const { addBucketWithPrefix } = await importAddBucketWithPrefix();
        const addBucketMock = jest.fn();

        await addBucketWithPrefix(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                prefix: 'files/',
            })
        );
    });

    it('shows success message with bucket name and prefix', async () => {
        const { addBucketWithPrefix } = await importAddBucketWithPrefix();
        const addBucketMock = jest.fn();

        await addBucketWithPrefix(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "my-prefix-bucket" (prefix: files/) added successfully.'
        );
    });

    it('does not add bucket if validation fails', async () => {
        mockValidateBucketAccess.mockResolvedValue({
            valid: false,
            error: 'Access denied',
        });

        const { addBucketWithPrefix } = await importAddBucketWithPrefix();
        const addBucketMock = jest.fn();

        await addBucketWithPrefix(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).not.toHaveBeenCalled();
        expect(mockGetBucketRegion).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Bug Fix 4: addBucketByArn auto-detects region
// ---------------------------------------------------------------------------

describe('Bug Fix 4: addBucketByArn auto-detects region', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShowInputBox.mockReset();

        mockShowInputBox
            .mockResolvedValueOnce('arn:aws:s3:::my-arn-bucket')  // ARN
            .mockResolvedValueOnce('us-east-1');                    // user enters wrong region

        mockValidateBucketAccess.mockResolvedValue({ valid: true });
        mockGetBucketRegion.mockResolvedValue('ap-southeast-1');
    });

    it('auto-detects actual bucket region instead of using user input', async () => {
        const { addBucketByArn } = await importAddBucketByArn();
        const addBucketMock = jest.fn();

        await addBucketByArn(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        // Should have called validateBucketAccess with extracted bucket name
        expect(mockValidateBucketAccess).toHaveBeenCalledWith('my-arn-bucket');

        // Should have auto-detected the region
        expect(mockGetBucketRegion).toHaveBeenCalledWith('my-arn-bucket');

        // Should have stored with the ACTUAL region (ap-southeast-1), not user input (us-east-1)
        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'my-arn-bucket',
                region: 'ap-southeast-1',  // Auto-detected
                addedManually: true,
            })
        );
    });

    it('extracts bucket name from ARN correctly', async () => {
        const { addBucketByArn } = await importAddBucketByArn();
        const addBucketMock = jest.fn();

        await addBucketByArn(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'my-arn-bucket',
            })
        );
    });

    it('shows success message with bucket name', async () => {
        const { addBucketByArn } = await importAddBucketByArn();
        const addBucketMock = jest.fn();

        await addBucketByArn(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(mockShowInformationMessage).toHaveBeenCalledWith(
            'Bucket "my-arn-bucket" added successfully.'
        );
    });

    it('does not add bucket if validation fails', async () => {
        mockValidateBucketAccess.mockResolvedValue({
            valid: false,
            error: 'Access denied',
        });

        const { addBucketByArn } = await importAddBucketByArn();
        const addBucketMock = jest.fn();

        await addBucketByArn(
            makeMockStorage(addBucketMock),
            makeMockS3Service(),
            makeMockTreeProvider(),
        );

        expect(addBucketMock).not.toHaveBeenCalled();
        expect(mockGetBucketRegion).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Tree item tests for S3BucketItem.config property
// ---------------------------------------------------------------------------

describe('S3BucketItem.config property', () => {
    it('exposes config property with correct name', () => {
        const config = makeBucketConfig({ name: 'test-bucket' });
        const item = new S3BucketItem(config);

        expect(item.config).toBe(config);
        expect(item.config.name).toBe('test-bucket');
        expect(item.label).toBe('test-bucket');
    });

    it('exposes config property with prefix', () => {
        const config = makeBucketConfig({
            name: 'prefix-bucket',
            prefix: 'logs/2024/',
        });
        const item = new S3BucketItem(config);

        expect(item.config.prefix).toBe('logs/2024/');
        expect(item.config.name).toBe('prefix-bucket');
    });

    it('exposes config property with region', () => {
        const config = makeBucketConfig({
            name: 'region-bucket',
            region: 'us-west-2',
        });
        const item = new S3BucketItem(config);

        expect(item.config.region).toBe('us-west-2');
        expect(item.description).toBe('us-west-2');
    });
});
