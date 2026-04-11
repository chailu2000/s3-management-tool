/**
 * Unit tests for new S3Service versioning methods.
 */

import {
    S3Service,
} from '../../services/s3-service';
import { IS3ClientFactory } from '../../aws/client-factory';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFactory(
    send: jest.Mock,
): IS3ClientFactory {
    return {
        getClient: jest.fn().mockReturnValue({ send }),
        updateCredentials: jest.fn(),
        dispose: jest.fn(),
    };
}

// ---------------------------------------------------------------------------
// S3Service.listObjectVersions
// ---------------------------------------------------------------------------

describe('S3Service.listObjectVersions', () => {
    it('returns versions sorted by lastModified descending', async () => {
        const send = jest.fn().mockResolvedValue({
            Versions: [
                { Key: 'data/file.txt', VersionId: 'v3', IsLatest: true, Size: 100, LastModified: new Date('2024-01-03'), ETag: '"ccc"' },
                { Key: 'data/file.txt', VersionId: 'v1', IsLatest: false, Size: 80, LastModified: new Date('2024-01-01'), ETag: '"aaa"' },
                { Key: 'data/file.txt', VersionId: 'v2', IsLatest: false, Size: 90, LastModified: new Date('2024-01-02'), ETag: '"bbb"' },
            ],
            DeleteMarkers: [],
        });

        const service = new S3Service(makeFactory(send));
        const versions = await service.listObjectVersions('my-bucket', 'data/file.txt', 'us-east-1');

        expect(versions).toHaveLength(3);
        expect(versions.map(v => v.versionId)).toEqual(['v3', 'v2', 'v1']);
        expect(versions[0].isLatest).toBe(true);
    });

    it('filters versions to exact key match', async () => {
        const send = jest.fn().mockResolvedValue({
            Versions: [
                { Key: 'data/file.txt', VersionId: 'v1', IsLatest: true, Size: 100, LastModified: new Date('2024-01-03'), ETag: '"ccc"' },
                { Key: 'data/other.txt', VersionId: 'v2', IsLatest: true, Size: 50, LastModified: new Date('2024-01-02'), ETag: '"bbb"' },
            ],
            DeleteMarkers: [],
        });

        const service = new S3Service(makeFactory(send));
        const versions = await service.listObjectVersions('my-bucket', 'data/file.txt', 'us-east-1');

        expect(versions).toHaveLength(1);
        expect(versions[0].versionId).toBe('v1');
    });

    it('includes delete markers in the results', async () => {
        const send = jest.fn().mockResolvedValue({
            Versions: [
                { Key: 'data/file.txt', VersionId: 'v1', IsLatest: false, Size: 100, LastModified: new Date('2024-01-01'), ETag: '"aaa"' },
            ],
            DeleteMarkers: [
                { Key: 'data/file.txt', VersionId: 'del-1', IsLatest: true, LastModified: new Date('2024-01-02') },
            ],
        });

        const service = new S3Service(makeFactory(send));
        const versions = await service.listObjectVersions('my-bucket', 'data/file.txt', 'us-east-1');

        expect(versions).toHaveLength(2);
        expect(versions[0].deleteMarker).toBe(true);
        expect(versions[0].versionId).toBe('del-1');
        expect(versions[1].deleteMarker).toBe(false);
    });

    it('handles pagination with KeyMarker and VersionIdMarker', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({
                Versions: [
                    { Key: 'obj', VersionId: 'v1', IsLatest: false, Size: 10, LastModified: new Date('2024-01-01'), ETag: '"a"' },
                ],
                DeleteMarkers: [],
                NextKeyMarker: 'obj',
                NextVersionIdMarker: 'v1',
                IsTruncated: true,
            })
            .mockResolvedValueOnce({
                Versions: [
                    { Key: 'obj', VersionId: 'v2', IsLatest: true, Size: 20, LastModified: new Date('2024-01-02'), ETag: '"b"' },
                ],
                DeleteMarkers: [],
            });

        const service = new S3Service(makeFactory(send));
        const versions = await service.listObjectVersions('my-bucket', 'obj', 'us-east-1');

        expect(versions).toHaveLength(2);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('defaults VersionId to "null" when missing', async () => {
        const send = jest.fn().mockResolvedValue({
            Versions: [
                { Key: 'obj', VersionId: undefined, IsLatest: true, Size: 10, LastModified: new Date('2024-01-01'), ETag: '"a"' },
            ],
            DeleteMarkers: [],
        });

        const service = new S3Service(makeFactory(send));
        const versions = await service.listObjectVersions('my-bucket', 'obj', 'us-east-1');

        expect(versions[0].versionId).toBe('null');
    });
});

// ---------------------------------------------------------------------------
// S3Service.restoreVersion
// ---------------------------------------------------------------------------

describe('S3Service.restoreVersion', () => {
    it('calls CopyObjectCommand with correct CopySource', async () => {
        const send = jest.fn().mockResolvedValue({});
        const service = new S3Service(makeFactory(send));

        await service.restoreVersion('my-bucket', 'data/file.txt', 'v123', 'us-east-1');

        expect(send).toHaveBeenCalledTimes(1);
        const cmd = send.mock.calls[0][0];
        expect(cmd.input.Bucket).toBe('my-bucket');
        expect(cmd.input.Key).toBe('data/file.txt');
        expect(cmd.input.CopySource).toContain('my-bucket');
        expect(cmd.input.CopySource).toContain('data/file.txt');
        expect(cmd.input.CopySource).toContain('versionId=v123');
    });
});

// ---------------------------------------------------------------------------
// S3Service.deleteVersion
// ---------------------------------------------------------------------------

describe('S3Service.deleteVersion', () => {
    it('calls DeleteObjectCommand with VersionId', async () => {
        const send = jest.fn().mockResolvedValue({});
        const service = new S3Service(makeFactory(send));

        await service.deleteVersion('my-bucket', 'data/file.txt', 'v456', 'us-east-1');

        expect(send).toHaveBeenCalledTimes(1);
        const cmd = send.mock.calls[0][0];
        expect(cmd.input.Bucket).toBe('my-bucket');
        expect(cmd.input.Key).toBe('data/file.txt');
        expect(cmd.input.VersionId).toBe('v456');
    });
});

// ---------------------------------------------------------------------------
// S3Service.getObject with versionId
// ---------------------------------------------------------------------------

describe('S3Service.getObject with versionId', () => {
    it('passes VersionId to GetObjectCommand when provided', async () => {
        const stream = { pipe: jest.fn() };
        const send = jest.fn().mockResolvedValue({ Body: stream });
        const service = new S3Service(makeFactory(send));

        await service.getObject('my-bucket', 'file.txt', 'us-east-1', 'v789');

        const cmd = send.mock.calls[0][0];
        expect(cmd.input.Bucket).toBe('my-bucket');
        expect(cmd.input.Key).toBe('file.txt');
        expect(cmd.input.VersionId).toBe('v789');
    });

    it('does not pass VersionId when not provided', async () => {
        const stream = { pipe: jest.fn() };
        const send = jest.fn().mockResolvedValue({ Body: stream });
        const service = new S3Service(makeFactory(send));

        await service.getObject('my-bucket', 'file.txt', 'us-east-1');

        const cmd = send.mock.calls[0][0];
        expect(cmd.input.VersionId).toBe(undefined);
    });
});
