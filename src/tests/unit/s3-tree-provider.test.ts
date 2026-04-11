/**
 * Unit tests for S3TreeProvider
 * Requirements: 1.4, 6.5
 */

// ---------------------------------------------------------------------------
// Mock vscode before any imports that reference it
// ---------------------------------------------------------------------------

const mockEventEmitterFire = jest.fn();
const mockEventEmitterEvent = jest.fn();

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
        event = mockEventEmitterEvent;
        fire = mockEventEmitterFire;
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
    };
}, { virtual: true });

// ---------------------------------------------------------------------------
// Imports (after mock)
// ---------------------------------------------------------------------------

import {
    S3TreeProvider,
    S3BucketItem,
    S3PrefixItem,
    S3ObjectItem,
    S3ErrorItem,
    formatSize,
} from '../../views/s3-tree-provider';
import { BucketConfig } from '../../models/s3-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBucketConfig(overrides: Partial<BucketConfig> = {}): BucketConfig {
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

function makeStorage(buckets: BucketConfig[] = []) {
    return {
        getBuckets: jest.fn().mockResolvedValue(buckets),
        addBucket: jest.fn(),
        removeBucket: jest.fn(),
        getSyncProfiles: jest.fn().mockResolvedValue([]),
        addSyncProfile: jest.fn(),
        updateSyncProfile: jest.fn(),
        deleteSyncProfile: jest.fn(),
    } as unknown as import('../../services/bucket-storage').BucketStorage;
}

function makeS3Service(listObjectsImpl?: jest.Mock) {
    return {
        listObjects: listObjectsImpl ?? jest.fn().mockResolvedValue({
            objects: [],
            commonPrefixes: [],
            isTruncated: false,
        }),
    } as unknown as import('../../services/s3-service').S3Service;
}

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

describe('formatSize', () => {
    it('formats bytes < 1024 as "X B"', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats bytes in KB range', () => {
        expect(formatSize(1024)).toBe('1 KB');
        expect(formatSize(2048)).toBe('2 KB');
        expect(formatSize(1024 * 1023)).toBe('1023 KB');
    });

    it('formats bytes in MB range', () => {
        expect(formatSize(1024 * 1024)).toBe('1 MB');
        expect(formatSize(5 * 1024 * 1024)).toBe('5 MB');
    });
});

// ---------------------------------------------------------------------------
// Tree item construction
// ---------------------------------------------------------------------------

describe('S3BucketItem', () => {
    it('has contextValue s3Bucket, label = bucket name, description = region', () => {
        const config = makeBucketConfig({ name: 'test-bucket', region: 'eu-west-1' });
        const item = new S3BucketItem(config);
        expect(item.contextValue).toBe('s3Bucket');
        expect(item.label).toBe('test-bucket');
        expect(item.description).toBe('eu-west-1');
        expect((item.iconPath as { id: string }).id).toBe('database');
    });

    it('shows prefix in description when bucket has a prefix scope', () => {
        const config = makeBucketConfig({ name: 'test-bucket', region: 'us-east-1', prefix: 'team-data/' });
        const item = new S3BucketItem(config);
        expect(item.description).toBe('us-east-1 · prefix: team-data/');
        expect(item.tooltip).toContain('Scoped to prefix: team-data/');
    });
});

describe('S3PrefixItem', () => {
    it('has contextValue s3Prefix, label = last segment of prefix', () => {
        const item = new S3PrefixItem('my-bucket', 'us-east-1', 'foo/bar/');
        expect(item.contextValue).toBe('s3Prefix');
        expect(item.label).toBe('bar');
        expect((item.iconPath as { id: string }).id).toBe('folder');
    });

    it('handles top-level prefix (no slash before segment)', () => {
        const item = new S3PrefixItem('my-bucket', 'us-east-1', 'toplevel/');
        expect(item.label).toBe('toplevel');
    });
});

describe('S3ObjectItem', () => {
    it('has contextValue s3Object, label = filename, description includes size and date', () => {
        const date = new Date('2024-06-15');
        const item = new S3ObjectItem('my-bucket', 'us-east-1', 'folder/file.txt', 2048, date);
        expect(item.contextValue).toBe('s3Object');
        expect(item.label).toBe('file.txt');
        expect(item.description).toContain('2 KB');
        expect((item.iconPath as { id: string }).id).toBe('file');
    });

    it('handles key with no slashes', () => {
        const item = new S3ObjectItem('my-bucket', 'us-east-1', 'root-file.txt', 100, new Date());
        expect(item.label).toBe('root-file.txt');
    });
});

describe('S3ErrorItem', () => {
    it('has contextValue s3Error and error icon', () => {
        const item = new S3ErrorItem('Access denied');
        expect(item.contextValue).toBe('s3Error');
        expect(item.label).toBe('Access denied');
        expect((item.iconPath as { id: string }).id).toBe('error');
    });
});

// ---------------------------------------------------------------------------
// S3TreeProvider.getChildren
// ---------------------------------------------------------------------------

describe('S3TreeProvider — empty state', () => {
    it('returns [] when no buckets are configured', async () => {
        const provider = new S3TreeProvider(makeStorage([]), makeS3Service());
        const children = await provider.getChildren(undefined);
        expect(children).toEqual([]);
    });
});

describe('S3TreeProvider — root level', () => {
    it('returns S3BucketItem[] from BucketStorage', async () => {
        const configs = [
            makeBucketConfig({ id: 'b1', name: 'bucket-a', region: 'us-east-1' }),
            makeBucketConfig({ id: 'b2', name: 'bucket-b', region: 'eu-west-1' }),
        ];
        const provider = new S3TreeProvider(makeStorage(configs), makeS3Service());
        const children = await provider.getChildren(undefined);

        expect(children).toHaveLength(2);
        expect(children[0]).toBeInstanceOf(S3BucketItem);
        expect(children[1]).toBeInstanceOf(S3BucketItem);
        expect((children[0] as S3BucketItem).label).toBe('bucket-a');
        expect((children[1] as S3BucketItem).label).toBe('bucket-b');
    });
});

describe('S3TreeProvider — bucket node expansion', () => {
    it('calls listObjects and returns S3PrefixItem[] + S3ObjectItem[]', async () => {
        const config = makeBucketConfig({ name: 'my-bucket', region: 'us-east-1' });
        const listObjects = jest.fn().mockResolvedValue({
            objects: [
                { key: 'file.txt', size: 512, lastModified: new Date('2024-01-01'), etag: '"abc"' },
            ],
            commonPrefixes: ['folder/'],
            isTruncated: false,
        });

        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service(listObjects));
        const bucketItem = new S3BucketItem(config);
        const children = await provider.getChildren(bucketItem);

        expect(listObjects).toHaveBeenCalledWith('my-bucket', '', 'us-east-1', undefined, config);
        expect(children).toHaveLength(2);
        expect(children[0]).toBeInstanceOf(S3PrefixItem);
        expect(children[1]).toBeInstanceOf(S3ObjectItem);
        expect((children[0] as S3PrefixItem).label).toBe('folder');
        expect((children[1] as S3ObjectItem).label).toBe('file.txt');
    });

    it('uses configured prefix when bucket has a prefix scope', async () => {
        const config = makeBucketConfig({ name: 'my-bucket', region: 'us-east-1', prefix: 'data/' });
        const listObjects = jest.fn().mockResolvedValue({
            objects: [],
            commonPrefixes: [],
            isTruncated: false,
        });

        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service(listObjects));
        const bucketItem = new S3BucketItem(config);
        await provider.getChildren(bucketItem);

        expect(listObjects).toHaveBeenCalledWith('my-bucket', 'data/', 'us-east-1', undefined, config);
    });
});

describe('S3TreeProvider — prefix node expansion', () => {
    it('calls listObjects with the prefix and returns children', async () => {
        const config = makeBucketConfig();
        const listObjects = jest.fn().mockResolvedValue({
            objects: [
                { key: 'folder/nested.txt', size: 100, lastModified: new Date(), etag: '"xyz"' },
            ],
            commonPrefixes: [],
            isTruncated: false,
        });

        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service(listObjects));
        const prefixItem = new S3PrefixItem('my-bucket', 'us-east-1', 'folder/', config);
        const children = await provider.getChildren(prefixItem);

        expect(listObjects).toHaveBeenCalledWith('my-bucket', 'folder/', 'us-east-1', undefined, config);
        expect(children).toHaveLength(1);
        expect(children[0]).toBeInstanceOf(S3ObjectItem);
    });
});

describe('S3TreeProvider — object node', () => {
    it('returns [] for object nodes (leaf)', async () => {
        const provider = new S3TreeProvider(makeStorage(), makeS3Service());
        const objectItem = new S3ObjectItem('my-bucket', 'us-east-1', 'file.txt', 100, new Date());
        const children = await provider.getChildren(objectItem);
        expect(children).toEqual([]);
    });
});

describe('S3TreeProvider — AccessDenied renders error node', () => {
    it('returns [S3ErrorItem] when listObjects returns accessDenied:true', async () => {
        const config = makeBucketConfig({ name: 'restricted-bucket', region: 'us-east-1' });
        const listObjects = jest.fn().mockResolvedValue({
            objects: [],
            commonPrefixes: [],
            isTruncated: false,
            accessDenied: true,
        });

        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service(listObjects));
        const bucketItem = new S3BucketItem(config);
        const children = await provider.getChildren(bucketItem);

        expect(children).toHaveLength(1);
        expect(children[0]).toBeInstanceOf(S3ErrorItem);
        expect((children[0] as S3ErrorItem).label).toContain('Access denied');
    });
});

describe('S3TreeProvider — zero-byte folder objects are hidden', () => {
    it('renders CommonPrefixes as folders and filtered objects as files', async () => {
        // The S3Service already filters out zero-byte folder objects.
        // The tree provider just renders whatever listObjects returns.
        const config = makeBucketConfig({ name: 'my-bucket', region: 'us-east-1' });
        const listObjects = jest.fn().mockResolvedValue({
            // After S3Service filtering: no zero-byte "/" keys
            objects: [
                { key: 'logs/app.log', size: 512, lastModified: new Date('2024-01-01'), etag: '"abc"' },
            ],
            commonPrefixes: ['logs/'],
            isTruncated: false,
        });

        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service(listObjects));
        const bucketItem = new S3BucketItem(config);
        const children = await provider.getChildren(bucketItem);

        // 2 items: the folder (from CommonPrefixes) and the file
        expect(children).toHaveLength(2);
        expect(children[0]).toBeInstanceOf(S3PrefixItem);
        expect(children[0].label).toBe('logs');
        expect(children[1]).toBeInstanceOf(S3ObjectItem);
        expect(children[1].label).toBe('app.log');
    });
});

// ---------------------------------------------------------------------------
// S3TreeProvider.refresh
// ---------------------------------------------------------------------------

describe('S3TreeProvider — refresh', () => {
    beforeEach(() => {
        mockEventEmitterFire.mockClear();
    });

    it('fires onDidChangeTreeData with undefined for full tree refresh', () => {
        const provider = new S3TreeProvider(makeStorage(), makeS3Service());
        provider.refresh();
        expect(mockEventEmitterFire).toHaveBeenCalledWith(undefined);
    });

    it('fires onDidChangeTreeData with the specific item for partial refresh', () => {
        const config = makeBucketConfig();
        const provider = new S3TreeProvider(makeStorage([config]), makeS3Service());
        const bucketItem = new S3BucketItem(config);
        provider.refresh(bucketItem);
        expect(mockEventEmitterFire).toHaveBeenCalledWith(bucketItem);
    });
});
