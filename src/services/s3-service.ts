/**
 * S3Service — core operations
 *
 * Wraps all AWS S3 API calls. Implements exponential backoff retry for
 * ThrottlingException and ServiceUnavailable (max 3 retries).
 * Never exposes raw SDK errors to callers — wraps them in human-readable S3ToolError.
 *
 * Requirements: 3.1, 3.2, 3.4, 3.5, 5.1–5.5, 6.1–6.5, 7.2, 8.3, 9.2,
 *               10.2, 10.3, 11.1, 12.2, 18.1–18.3, 23.1, 23.2, 23.4
 */

import {
    ListBucketsCommand,
    ListObjectsV2Command,
    ListObjectVersionsCommand,
    GetBucketLocationCommand,
    GetBucketVersioningCommand,
    GetBucketPolicyCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand,
    HeadObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    CompletedPart,
    GetObjectTaggingCommand,
    PutObjectTaggingCommand,
    Tag,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';

import { IS3ClientFactory } from '../aws/client-factory';
import { withRetry } from '../aws/retry-handler';
import {
    BucketConfig,
    BucketSummary,
    ListObjectsPage,
    ObjectMetadata,
    ObjectSummary,
    ObjectVersion,
    ProgressCallback,
    ValidationResult,
    VersioningStatus,
} from '../models/s3-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAccessDenied(error: unknown): boolean {
    if (!error || typeof error !== 'object') { return false; }
    const name = (error as Record<string, unknown>)['name'] as string | undefined;
    const code = (error as Record<string, unknown>)['Code'] as string | undefined;
    return name === 'AccessDenied' || name === 'AccessDeniedException'
        || code === 'AccessDenied' || code === 'AccessDeniedException';
}

function humanMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
        const msg = (error as Record<string, unknown>)['message'] as string | undefined;
        if (msg) { return msg; }
    }
    return fallback;
}

// ---------------------------------------------------------------------------
// S3Service
// ---------------------------------------------------------------------------

export class S3Service {
    constructor(private readonly factory: IS3ClientFactory) { }

    // -----------------------------------------------------------------------
    // Discovery
    // -----------------------------------------------------------------------

    /**
     * Lists all buckets the caller has access to.
     * On AccessDenied returns { buckets: [], hasPermission: false }.
     */
    async tryListBuckets(): Promise<{ buckets: BucketSummary[]; hasPermission: boolean }> {
        try {
            const client = this.factory.getClient('us-east-1');
            const response = await withRetry(() => client.send(new ListBucketsCommand({})));
            const buckets: BucketSummary[] = (response.Buckets ?? []).map(b => ({
                name: b.Name ?? '',
                creationDate: b.CreationDate,
            }));
            return { buckets, hasPermission: true };
        } catch (error) {
            if (isAccessDenied(error)) {
                return { buckets: [], hasPermission: false };
            }
            throw this.wrapError(error, 'Failed to list buckets');
        }
    }

    /**
     * Validates that the caller can access the given bucket (and optional prefix).
     * Calls ListObjectsV2 with MaxKeys:1.
     */
    async validateBucketAccess(bucket: string, prefix?: string): Promise<ValidationResult> {
        try {
            const region = await this.getBucketRegion(bucket);
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new ListObjectsV2Command({
                    Bucket: bucket,
                    Prefix: prefix,
                    MaxKeys: 1,
                }))
            );
            return { valid: true };
        } catch (error) {
            if (isAccessDenied(error)) {
                return {
                    valid: false,
                    error: `Access denied to bucket "${bucket}". Required permission: s3:ListObjectsV2`,
                };
            }
            return {
                valid: false,
                error: humanMessage(error, `Cannot access bucket "${bucket}"`),
            };
        }
    }

    // -----------------------------------------------------------------------
    // Bucket metadata
    // -----------------------------------------------------------------------

    /**
     * Returns the AWS region for the given bucket.
     */
    async getBucketRegion(bucket: string): Promise<string> {
        try {
            // GetBucketLocation must be called against us-east-1
            const client = this.factory.getClient('us-east-1');
            const response = await withRetry(() =>
                client.send(new GetBucketLocationCommand({ Bucket: bucket }))
            );
            // AWS returns null/undefined for us-east-1
            return response.LocationConstraint ?? 'us-east-1';
        } catch (error) {
            throw this.wrapError(error, `Failed to get region for bucket "${bucket}"`);
        }
    }

    /**
     * Returns the versioning status for the given bucket.
     * On AccessDenied returns 'Unknown'.
     */
    async getBucketVersioning(bucket: string): Promise<VersioningStatus> {
        try {
            const region = await this.getBucketRegion(bucket);
            const client = this.factory.getClient(region);
            const response = await withRetry(() =>
                client.send(new GetBucketVersioningCommand({ Bucket: bucket }))
            );
            const status = response.Status;
            if (status === 'Enabled') { return 'Enabled'; }
            if (status === 'Suspended') { return 'Suspended'; }
            return 'NotEnabled';
        } catch (error) {
            if (isAccessDenied(error)) { return 'Unknown'; }
            throw this.wrapError(error, `Failed to get versioning status for bucket "${bucket}"`);
        }
    }

    /**
     * Returns the bucket policy JSON string, or null if no policy exists.
     */
    async getBucketPolicy(bucket: string): Promise<string | null> {
        try {
            const region = await this.getBucketRegion(bucket);
            const client = this.factory.getClient(region);
            const response = await withRetry(() =>
                client.send(new GetBucketPolicyCommand({ Bucket: bucket }))
            );
            return response.Policy ?? null;
        } catch (error) {
            if (error && typeof error === 'object') {
                const name = (error as Record<string, unknown>)['name'] as string | undefined;
                const code = (error as Record<string, unknown>)['Code'] as string | undefined;
                if (name === 'NoSuchBucketPolicy' || code === 'NoSuchBucketPolicy') {
                    return null;
                }
            }
            if (isAccessDenied(error)) { return null; }
            throw this.wrapError(error, `Failed to get policy for bucket "${bucket}"`);
        }
    }

    // -----------------------------------------------------------------------
    // Object listing (5.2)
    // -----------------------------------------------------------------------

    /**
     * Lists objects in a bucket under the given prefix.
     * Enforces prefix scope: if bucketConfig has a prefix, prepends it and
     * validates that all returned keys start with the configured prefix.
     * On AccessDenied returns { objects: [], commonPrefixes: [], isTruncated: false, accessDenied: true }.
     */
    async listObjects(
        bucket: string,
        prefix: string,
        region: string,
        continuationToken?: string,
        bucketConfig?: BucketConfig,
    ): Promise<ListObjectsPage & { accessDenied?: boolean }> {
        // Enforce prefix scope
        const effectivePrefix = this.resolvePrefix(prefix, bucketConfig);

        try {
            const client = this.factory.getClient(region);
            const response = await withRetry(() =>
                client.send(new ListObjectsV2Command({
                    Bucket: bucket,
                    Prefix: effectivePrefix,
                    Delimiter: '/',
                    ContinuationToken: continuationToken,
                }))
            );

            const configuredPrefix = bucketConfig?.prefix ?? '';

            const objects: ObjectSummary[] = (response.Contents ?? [])
                .filter(obj => {
                    const key = obj.Key ?? '';
                    // Filter out zero-byte folder placeholder objects (they are already
                    // represented as CommonPrefixes). S3 returns these when a prefix
                    // is explicitly created via PutObject with an empty body.
                    if ((obj.Size ?? 0) === 0 && key.endsWith('/')) { return false; }
                    return !configuredPrefix || key.startsWith(configuredPrefix);
                })
                .map(obj => ({
                    key: obj.Key ?? '',
                    size: obj.Size ?? 0,
                    lastModified: obj.LastModified ?? new Date(0),
                    etag: obj.ETag ?? '',
                    storageClass: obj.StorageClass,
                }));

            const commonPrefixes: string[] = (response.CommonPrefixes ?? [])
                .map(cp => cp.Prefix ?? '')
                .filter(p => !configuredPrefix || p.startsWith(configuredPrefix));

            return {
                objects,
                commonPrefixes,
                nextContinuationToken: response.NextContinuationToken,
                isTruncated: response.IsTruncated ?? false,
            };
        } catch (error) {
            if (isAccessDenied(error)) {
                return { objects: [], commonPrefixes: [], isTruncated: false, accessDenied: true };
            }
            throw this.wrapError(error, `Failed to list objects in bucket "${bucket}"`);
        }
    }

    // -----------------------------------------------------------------------
    // Object CRUD (5.3)
    // -----------------------------------------------------------------------

    /**
     * Downloads an object (or a specific version) and returns a readable stream.
     */
    async getObject(
        bucket: string,
        key: string,
        region: string,
        versionId?: string,
    ): Promise<NodeJS.ReadableStream> {
        this.assertKeyInScope(key, undefined);
        try {
            const client = this.factory.getClient(region);
            const response = await withRetry(() =>
                client.send(new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    VersionId: versionId || undefined,
                }))
            );
            if (!response.Body) {
                throw new Error('Empty response body from S3');
            }
            return response.Body as unknown as NodeJS.ReadableStream;
        } catch (error) {
            throw this.wrapError(error, `Failed to download object "${key}" from bucket "${bucket}"`);
        }
    }

    /**
     * Uploads an object using a single PutObject call.
     */
    async putObject(
        bucket: string,
        key: string,
        body: Buffer | NodeJS.ReadableStream,
        region: string,
        contentType?: string,
    ): Promise<void> {
        try {
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body as Buffer,
                    ContentType: contentType,
                }))
            );
        } catch (error) {
            throw this.wrapError(error, `Failed to upload object "${key}" to bucket "${bucket}"`);
        }
    }

    /**
     * Uploads a file using multipart upload (for files > 5 MB).
     * Returns the ETag of the completed upload.
     */
    async putObjectMultipart(
        bucket: string,
        key: string,
        filePath: string,
        region: string,
        onProgress: ProgressCallback,
    ): Promise<string> {
        const PART_SIZE = 5 * 1024 * 1024; // 5 MB
        const client = this.factory.getClient(region);

        const fileSize = fs.statSync(filePath).size;
        let uploadId: string | undefined;

        try {
            // Initiate multipart upload
            const createResponse = await withRetry(() =>
                client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }))
            );
            uploadId = createResponse.UploadId;
            if (!uploadId) { throw new Error('No UploadId returned from CreateMultipartUpload'); }

            const parts: CompletedPart[] = [];
            let bytesUploaded = 0;
            let partNumber = 1;

            const fileHandle = fs.openSync(filePath, 'r');
            try {
                while (bytesUploaded < fileSize) {
                    const chunkSize = Math.min(PART_SIZE, fileSize - bytesUploaded);
                    const buffer = Buffer.alloc(chunkSize);
                    fs.readSync(fileHandle, buffer, 0, chunkSize, bytesUploaded);

                    const uploadResponse = await withRetry(() =>
                        client.send(new UploadPartCommand({
                            Bucket: bucket,
                            Key: key,
                            UploadId: uploadId,
                            PartNumber: partNumber,
                            Body: buffer,
                        }))
                    );

                    parts.push({ PartNumber: partNumber, ETag: uploadResponse.ETag });
                    bytesUploaded += chunkSize;
                    partNumber++;
                    onProgress(bytesUploaded, fileSize);
                }
            } finally {
                fs.closeSync(fileHandle);
            }

            // Complete multipart upload
            const completeResponse = await withRetry(() =>
                client.send(new CompleteMultipartUploadCommand({
                    Bucket: bucket,
                    Key: key,
                    UploadId: uploadId,
                    MultipartUpload: { Parts: parts },
                }))
            );

            return completeResponse.ETag ?? '';
        } catch (error) {
            // Abort the multipart upload on failure
            if (uploadId) {
                try {
                    await client.send(new AbortMultipartUploadCommand({
                        Bucket: bucket,
                        Key: key,
                        UploadId: uploadId,
                    }));
                } catch {
                    // Best-effort abort; ignore errors
                }
            }
            throw this.wrapError(error, `Failed to multipart-upload "${key}" to bucket "${bucket}"`);
        }
    }

    /**
     * Deletes an object.
     */
    async deleteObject(bucket: string, key: string, region: string): Promise<void> {
        try {
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
            );
        } catch (error) {
            throw this.wrapError(error, `Failed to delete object "${key}" from bucket "${bucket}"`);
        }
    }

    /**
     * Copies an object, supporting cross-region copies by using the destination region's client.
     */
    async copyObject(
        srcBucket: string,
        srcKey: string,
        dstBucket: string,
        dstKey: string,
        srcRegion: string,
        dstRegion: string,
    ): Promise<void> {
        try {
            // Use destination region's client for cross-region copies
            const client = this.factory.getClient(dstRegion);
            await withRetry(() =>
                client.send(new CopyObjectCommand({
                    Bucket: dstBucket,
                    Key: dstKey,
                    CopySource: `${srcBucket}/${srcKey}`,
                }))
            );
        } catch (error) {
            throw this.wrapError(
                error,
                `Failed to copy "${srcKey}" from "${srcBucket}" to "${dstBucket}/${dstKey}"`,
            );
        }
    }

    /**
     * Returns metadata for an object.
     */
    async headObject(bucket: string, key: string, region: string): Promise<ObjectMetadata> {
        try {
            const client = this.factory.getClient(region);
            const response = await withRetry(() =>
                client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
            );
            return {
                key,
                size: response.ContentLength ?? 0,
                lastModified: response.LastModified ?? new Date(0),
                contentType: response.ContentType,
                etag: response.ETag ?? '',
                storageClass: response.StorageClass,
                userMetadata: (response.Metadata as Record<string, string>) ?? {},
            };
        } catch (error) {
            throw this.wrapError(error, `Failed to get metadata for object "${key}" in bucket "${bucket}"`);
        }
    }

    /**
     * Generates a presigned URL for the given object.
     */
    async getPresignedUrl(
        bucket: string,
        key: string,
        region: string,
        expirySeconds: number,
    ): Promise<string> {
        try {
            const client = this.factory.getClient(region);
            const command = new GetObjectCommand({ Bucket: bucket, Key: key });
            return await getSignedUrl(client, command, { expiresIn: expirySeconds });
        } catch (error) {
            throw this.wrapError(error, `Failed to generate presigned URL for "${key}" in bucket "${bucket}"`);
        }
    }

    // -----------------------------------------------------------------------
    // Object versions (S3 versioning)
    // -----------------------------------------------------------------------

    /**
     * Lists all versions of a specific object key.
     * Returns versions sorted by lastModified descending (newest first).
     */
    async listObjectVersions(
        bucket: string,
        key: string,
        region: string,
    ): Promise<ObjectVersion[]> {
        const client = this.factory.getClient(region);
        const allVersions: ObjectVersion[] = [];
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;

        do {
            const resp = await withRetry(() =>
                client.send(new ListObjectVersionsCommand({
                    Bucket: bucket,
                    Prefix: key,
                    KeyMarker: keyMarker,
                    VersionIdMarker: versionIdMarker,
                }))
            );

            for (const v of resp.Versions ?? []) {
                if (v.Key !== key) { continue; }
                allVersions.push({
                    versionId: v.VersionId ?? 'null',
                    isLatest: v.IsLatest ?? false,
                    size: v.Size ?? 0,
                    lastModified: v.LastModified ?? new Date(0),
                    etag: v.ETag ?? '',
                    storageClass: v.StorageClass,
                    deleteMarker: false,
                    key: v.Key ?? '',
                });
            }

            for (const m of resp.DeleteMarkers ?? []) {
                if (m.Key !== key) { continue; }
                allVersions.push({
                    versionId: m.VersionId ?? 'null',
                    isLatest: m.IsLatest ?? false,
                    size: 0,
                    lastModified: m.LastModified ?? new Date(0),
                    etag: '',
                    deleteMarker: true,
                    key: m.Key ?? '',
                });
            }

            keyMarker = resp.NextKeyMarker;
            versionIdMarker = resp.NextVersionIdMarker;
        } while (keyMarker);

        return allVersions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    }

    /**
     * Lists a page of deleted files (DeleteMarkers where IsLatest is true) for an entire bucket.
     */
    async listDeletedFilesPage(
        bucket: string,
        region: string,
        keyMarker?: string,
        versionIdMarker?: string,
    ): Promise<{ deletedFiles: ObjectVersion[]; nextKeyMarker?: string; nextVersionIdMarker?: string }> {
        const client = this.factory.getClient(region);
        const deletedFiles: ObjectVersion[] = [];

        const resp = await withRetry(() =>
            client.send(new ListObjectVersionsCommand({
                Bucket: bucket,
                KeyMarker: keyMarker,
                VersionIdMarker: versionIdMarker,
            }))
        );

        for (const m of resp.DeleteMarkers ?? []) {
            if (m.IsLatest) {
                deletedFiles.push({
                    versionId: m.VersionId ?? 'null',
                    isLatest: m.IsLatest ?? false,
                    size: 0,
                    lastModified: m.LastModified ?? new Date(0),
                    etag: '',
                    deleteMarker: true,
                    key: m.Key ?? '',
                });
            }
        }

        return {
            deletedFiles,
            nextKeyMarker: resp.NextKeyMarker,
            nextVersionIdMarker: resp.NextVersionIdMarker,
        };
    }

    /**
     * Restores a previous version by copying it to the current key.
     */
    async restoreVersion(
        bucket: string,
        key: string,
        versionId: string,
        region: string,
    ): Promise<void> {
        try {
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new CopyObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    CopySource: `/${bucket}/${key}?versionId=${encodeURIComponent(versionId)}`,
                }))
            );
        } catch (error) {
            throw this.wrapError(
                error,
                `Failed to restore version "${versionId}" of "${key}" in bucket "${bucket}"`,
            );
        }
    }

    /**
     * Deletes a specific version of an object.
     */
    async deleteVersion(
        bucket: string,
        key: string,
        versionId: string,
        region: string,
    ): Promise<void> {
        try {
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    VersionId: versionId,
                }))
            );
        } catch (error) {
            throw this.wrapError(
                error,
                `Failed to delete version "${versionId}" of "${key}" from bucket "${bucket}"`,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Object Tag Management
    // -----------------------------------------------------------------------

    /**
     * Gets the tags for an S3 object.
     */
    async getObjectTagging(
        bucket: string,
        key: string,
        region: string,
    ): Promise<Tag[]> {
        try {
            const client = this.factory.getClient(region);
            const resp = await withRetry(() =>
                client.send(new GetObjectTaggingCommand({
                    Bucket: bucket,
                    Key: key,
                }))
            );
            return resp.TagSet ?? [];
        } catch (error) {
            throw this.wrapError(
                error,
                `Failed to get tags for object "${key}" in bucket "${bucket}"`,
            );
        }
    }

    /**
     * Sets (replaces all) tags for an S3 object.
     */
    async putObjectTagging(
        bucket: string,
        key: string,
        region: string,
        tags: Tag[],
    ): Promise<void> {
        try {
            const client = this.factory.getClient(region);
            await withRetry(() =>
                client.send(new PutObjectTaggingCommand({
                    Bucket: bucket,
                    Key: key,
                    Tagging: { TagSet: tags },
                }))
            );
        } catch (error) {
            throw this.wrapError(
                error,
                `Failed to set tags for object "${key}" in bucket "${bucket}"`,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Resolves the effective prefix for a listing call, prepending the
     * BucketConfig prefix if one is configured.
     */
    private resolvePrefix(prefix: string, bucketConfig?: BucketConfig): string {
        const configuredPrefix = bucketConfig?.prefix ?? '';
        if (!configuredPrefix) { return prefix; }
        // If the caller-supplied prefix already starts with the configured prefix, use as-is
        if (prefix.startsWith(configuredPrefix)) { return prefix; }
        // Otherwise prepend the configured prefix
        return configuredPrefix + prefix;
    }

    /**
     * Asserts that a key is within the configured prefix scope.
     * Throws an S3ToolError if the key is out of scope.
     * No-op when no bucketConfig or no prefix is configured.
     */
    assertKeyInScope(key: string, bucketConfig: BucketConfig | undefined): void {
        const configuredPrefix = bucketConfig?.prefix ?? '';
        if (configuredPrefix && !key.startsWith(configuredPrefix)) {
            const err = new Error(
                `Key "${key}" is outside the configured prefix scope "${configuredPrefix}". ` +
                `No AWS API call was made.`,
            );
            (err as unknown as Record<string, unknown>)['code'] = 'PrefixScopeViolation';
            throw err;
        }
    }

    /**
     * Wraps an unknown error in a human-readable Error.
     */
    private wrapError(error: unknown, context: string): Error {
        const msg = humanMessage(error, 'Unknown error');
        const wrapped = new Error(`${context}: ${msg}`);
        (wrapped as unknown as Record<string, unknown>)['originalError'] = error;
        return wrapped;
    }
}
