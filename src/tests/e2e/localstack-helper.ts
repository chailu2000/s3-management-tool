/**
 * LocalStack E2E Test Helper
 *
 * Provides utilities for setting up and tearing down S3 test resources
 * using LocalStack running at http://localhost:4566
 *
 * Requirements: 1.2
 */

import {
    S3Client,
    CreateBucketCommand,
    DeleteBucketCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const TEST_REGION = 'us-east-1';

// Create S3 client pointing to LocalStack
export function createLocalStackS3Client(): S3Client {
    return new S3Client({
        endpoint: LOCALSTACK_ENDPOINT,
        region: TEST_REGION,
        credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test',
        },
        forcePathStyle: true, // Required for LocalStack
    });
}

/**
 * Creates a test bucket with optional fixture files
 */
export async function createTestBucket(
    client: S3Client,
    bucketName: string,
    fixtures?: Array<{ key: string; content: Buffer | string }>,
): Promise<void> {
    try {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error: any) {
        // Ignore if bucket already exists
        if (error.name !== 'BucketAlreadyExists' && error.name !== 'BucketAlreadyOwnedByYou') {
            throw error;
        }
    }

    // Upload fixture files if provided
    if (fixtures) {
        for (const fixture of fixtures) {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucketName,
                    Key: fixture.key,
                    Body: fixture.content,
                }),
            );
        }
    }
}

/**
 * Deletes a test bucket and all its objects
 */
export async function deleteTestBucket(client: S3Client, bucketName: string): Promise<void> {
    try {
        // First, delete all objects in the bucket
        const objects = await client.send(
            new ListObjectsV2Command({ Bucket: bucketName }),
        );

        if (objects.Contents) {
            for (const obj of objects.Contents) {
                if (obj.Key) {
                    await client.send(
                        new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: obj.Key,
                        }),
                    );
                }
            }
        }

        // Then delete the bucket
        await client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    } catch (error: any) {
        // Ignore if bucket doesn't exist
        if (error.name !== 'NoSuchBucket') {
            throw error;
        }
    }
}

/**
 * Verifies that an object exists in S3 and has the expected content
 */
export async function verifyS3Object(
    client: S3Client,
    bucketName: string,
    key: string,
    expectedContent?: Buffer | string,
): Promise<boolean> {
    try {
        const response = await client.send(
            new GetObjectCommand({
                Bucket: bucketName,
                Key: key,
            }),
        );

        if (!response.Body) {
            return false;
        }

        // If expected content is provided, verify it matches
        if (expectedContent !== undefined) {
            const bodyBuffer = await streamToBuffer(response.Body as any);
            const expectedBuffer = Buffer.isBuffer(expectedContent)
                ? expectedContent
                : Buffer.from(expectedContent);

            if (!bodyBuffer.equals(expectedBuffer)) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Helper to convert readable stream to buffer
 */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

/**
 * Generates a unique test bucket name
 */
export function generateTestBucketName(): string {
    return `test-bucket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
