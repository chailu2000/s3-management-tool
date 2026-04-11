/**
 * Command: Refresh the S3 bucket tree
 * Requirements: 1.1
 */

import { S3TreeProvider } from '../views/s3-tree-provider';

export function refreshBuckets(treeProvider: S3TreeProvider): void {
    treeProvider.refresh();
}
