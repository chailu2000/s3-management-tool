/**
 * File classification logic for bidirectional sync.
 *
 * This module provides the pure function for classifying files
 * based on modification times, used by SyncService.syncBidirectional.
 *
 * Requirements: 15.1, 15.2, 15.3
 */

import { FileClassification } from '../models/s3-models';

/**
 * Classifies a file based on modification times and last sync timestamp.
 *
 * @param localMtime - Local file modification time (milliseconds since epoch), or undefined if file doesn't exist locally
 * @param remoteMtime - S3 object last modified time (milliseconds since epoch), or undefined if object doesn't exist in S3
 * @param lastSyncAt - Last successful sync timestamp (milliseconds since epoch), or undefined if never synced
 * @returns FileClassification - One of: local-only, remote-only, unchanged, local-newer, remote-newer, conflicted
 */
export function classifyFile(
    localMtime: number | undefined,
    remoteMtime: number | undefined,
    lastSyncAt: number | undefined,
): FileClassification {
    // File exists only locally
    if (localMtime !== undefined && remoteMtime === undefined) {
        return 'local-only';
    }

    // File exists only in S3
    if (localMtime === undefined && remoteMtime !== undefined) {
        return 'remote-only';
    }

    // File doesn't exist anywhere (shouldn't happen, but handle gracefully)
    if (localMtime === undefined && remoteMtime === undefined) {
        return 'unchanged';
    }

    // Both exist - compare against last sync timestamp
    // If never synced (lastSyncAt is undefined), treat as conflicted if both modified
    if (lastSyncAt === undefined) {
        // First sync - if both exist, treat as conflicted
        return 'conflicted';
    }

    // At this point, we know localMtime and remoteMtime are defined (both exist check above)
    const localModifiedAfterSync = localMtime! > lastSyncAt;
    const remoteModifiedAfterSync = remoteMtime! > lastSyncAt;

    // Both modified since last sync = conflict
    if (localModifiedAfterSync && remoteModifiedAfterSync) {
        return 'conflicted';
    }

    // Only local modified
    if (localModifiedAfterSync && !remoteModifiedAfterSync) {
        return 'local-newer';
    }

    // Only remote modified
    if (!localModifiedAfterSync && remoteModifiedAfterSync) {
        return 'remote-newer';
    }

    // Neither modified since last sync
    return 'unchanged';
}
