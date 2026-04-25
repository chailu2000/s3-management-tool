/**
 * Shared data models for the S3 Management Tool extension.
 */

// ---------------------------------------------------------------------------
// Persisted in globalState
// ---------------------------------------------------------------------------

export interface BucketConfig {
    id: string;               // UUID
    name: string;             // S3 bucket name
    region: string;           // AWS region
    prefix?: string;          // Optional prefix scope (always ends with '/')
    addedManually: boolean;
    createdAt: string;        // ISO 8601
    updatedAt: string;
}

export interface SyncProfile {
    id: string;
    name: string;
    localPath: string;
    bucket: string;
    prefix?: string;
    region: string;
    direction: 'upload' | 'download' | 'bidirectional';
    deleteMissing: boolean;
    excludePatterns: string[];
    conflictStrategy: 'keep-local' | 'keep-remote' | 'keep-both' | 'skip';
    lastSyncAt?: string;      // ISO 8601, updated after each successful sync
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sync operation results (in-memory only)
// ---------------------------------------------------------------------------

export interface SyncResult {
    startTime: string;
    endTime?: string;
    status: 'running' | 'completed' | 'cancelled' | 'failed';
    uploaded: number;
    downloaded: number;
    deleted: number;
    skipped: number;
    conflicts: number;
    errors: SyncError[];
}

export interface SyncError {
    file: string;
    operation: 'upload' | 'download' | 'delete';
    error: string;
    timestamp: string;
}

// ---------------------------------------------------------------------------
// Object metadata
// ---------------------------------------------------------------------------

export interface ObjectMetadata {
    key: string;
    size: number;
    lastModified: Date;
    contentType?: string;
    etag: string;
    storageClass?: string;
    userMetadata: Record<string, string>;
}

export interface ObjectSummary {
    key: string;
    size: number;
    lastModified: Date;
    etag: string;
    storageClass?: string;
}

export interface ListObjectsPage {
    objects: ObjectSummary[];
    commonPrefixes: string[];
    nextContinuationToken?: string;
    isTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Sync options and callbacks
// ---------------------------------------------------------------------------

export interface SyncOptions {
    localPath: string;
    bucket: string;
    prefix?: string;
    region: string;
    direction: 'upload' | 'download' | 'bidirectional';
    deleteMissing: boolean;
    excludePatterns: string[];
    conflictStrategy: 'keep-local' | 'keep-remote' | 'keep-both' | 'skip';
    dryRun: boolean;
}

export type SyncProgressCallback = (progress: {
    file: string;
    operation: 'upload' | 'download' | 'delete' | 'skip';
    bytesTransferred?: number;
    totalBytes?: number;
}) => void;

// ---------------------------------------------------------------------------
// Bucket metadata
// ---------------------------------------------------------------------------

export type VersioningStatus = 'Enabled' | 'Suspended' | 'NotEnabled' | 'Unknown';

export interface BucketSummary {
    name: string;
    region?: string;
    creationDate?: Date;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface S3ToolError {
    code: string;
    message: string;
    originalError?: unknown;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    profile?: string;
}

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

export type ProgressCallback = (bytesTransferred: number, totalBytes: number) => void;

// ---------------------------------------------------------------------------
// File classification (used in bidirectional sync)
// ---------------------------------------------------------------------------

export type FileClassification =
    | 'local-only'
    | 'remote-only'
    | 'unchanged'
    | 'local-newer'
    | 'remote-newer'
    | 'conflicted';

// ---------------------------------------------------------------------------
// Object versions (S3 versioning)
// ---------------------------------------------------------------------------

export interface ObjectVersion {
    versionId: string;
    isLatest: boolean;
    size: number;
    lastModified: Date;
    etag: string;
    storageClass?: string;
    deleteMarker: boolean;
    key?: string;
}

// ---------------------------------------------------------------------------
// Upload result (recursive directory upload)
// ---------------------------------------------------------------------------

export interface UploadResult {
    uploaded: number;
    skipped: number;
    errors: number;
    totalBytes: number;
    errorDetails: string[];
}
