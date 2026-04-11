# S3 Extension E2E Testing Guide

This guide explains how to run E2E tests for the S3 Management Tool extension locally.

## Prerequisites

- **Docker** - Required for LocalStack
- **Node.js 18+** and **pnpm 10+**
- **LocalStack** - S3 service emulation

## Quick Start

### 1. Start LocalStack with S3

Run the helper script:

```bash
./start-localstack-s3.sh
```

Or manually using docker-compose:

```bash
# Start LocalStack
docker compose -f tests/e2e/config/docker-compose.localstack.yml up -d

# Wait for it to be ready
curl -s http://localhost:4566/_localstack/health | grep '"s3": "available"'
```

### 2. Run E2E Tests

```bash
# Run all E2E tests
pnpm run test:e2e

# Run with coverage
pnpm run test:e2e:coverage

# Run in CI mode (headless)
pnpm run test:e2e:ci
```

### 3. Stop LocalStack

```bash
docker compose -f tests/e2e/config/docker-compose.localstack.yml down
```

## Test Structure

### E2E Test Files

Located in `src/tests/e2e/`:

1. **`sync-roundtrip.e2e.test.ts`** - Full sync round-trip tests
   - Upload local directory to S3
   - Verify objects exist with correct content
   - Download back and verify byte-for-byte identical
   - Re-sync confirms unchanged

2. **`incremental-sync.e2e.test.ts`** - Incremental sync behavior
   - Initial sync of files
   - Modify one file, verify only modified file uploaded
   - Add new file, verify only new file uploaded

3. **`prefix-enforcement.e2e.test.ts`** - Prefix-scoped operations
   - Prefix-scoped listing
   - Upload with prefix
   - `deleteMissing` within prefix scope only

4. **`watch-mode.e2e.test.ts`** - File watch mode
   - File creation triggers upload
   - File modification triggers re-upload
   - Rapid successive changes with debounce

5. **`s3-operations.e2e.test.ts`** - NEW: UI operations and limits
   - Object upload and retrieval
   - Large folder pagination (10,000 item limit)
   - File preview size limits (50 KB soft, 5 MB hard)
   - Supported file types for preview
   - Delete operations
   - Icon differentiation verification

### Unit Tests

Located in `src/tests/unit/`:

```bash
# Run unit tests only
pnpm run test:unit

# Run with coverage
pnpm run test:unit:coverage

# Run all tests
pnpm run test:all
```

## Environment Variables

The tests use these environment variables (set automatically):

| Variable | Value | Description |
|----------|-------|-------------|
| `LOCALSTACK_ENDPOINT` | `http://localhost:4566` | LocalStack endpoint |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | AWS SDK endpoint |
| `AWS_ACCESS_KEY_ID` | `test` | Fake access key |
| `AWS_SECRET_ACCESS_KEY` | `test` | Fake secret key |
| `AWS_REGION` | `us-east-1` | Default region |
| `CI` | `true` (in CI mode) | Enables CI-specific behavior |

## Troubleshooting

### AWS SDK Dynamic Import Error

**Error:** `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`

**Solution:** The `NODE_OPTIONS='--experimental-vm-modules'` flag is already included in the test scripts. If you still see this error, ensure you're using `pnpm run test:e2e` and not running jest directly.

### S3 Service Not Enabled

**Error:** `Service 's3' is not enabled. Please check your 'SERVICES' configuration variable.`

**Solution:** Restart LocalStack with S3 enabled:

```bash
# Stop current LocalStack
docker compose -f tests/e2e/config/docker-compose.localstack.yml down

# Start with S3
./start-localstack-s3.sh
```

### Test Timeouts

E2E tests have a 60-second timeout per test. If tests are timing out:

1. Check LocalStack is running: `curl http://localhost:4566/_localstack/health`
2. Increase timeout in `jest.e2e.config.js`: `testTimeout: 120000`
3. Run a single test file: `pnpm run test:e2e -- src/tests/e2e/specific-test.e2e.test.ts`

### Connection Refused

**Error:** `connect ECONNREFUSED 127.0.0.1:4566`

**Solution:** LocalStack is not running or not ready yet. Wait a few seconds and try again, or restart LocalStack.

## CI Pipeline

E2E tests run automatically in GitHub Actions on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual trigger via `workflow_dispatch`

See `.github/workflows/s3-extension-e2e.yml` for the full workflow.

### CI Workflow Jobs

1. **Unit Tests** (~10 min)
   - Runs all unit tests
   - Fast feedback for code changes

2. **E2E Tests** (~15 min)
   - Starts LocalStack with S3
   - Waits for health check
   - Runs all E2E tests
   - Uploads test results as artifacts

## Test Coverage

Current coverage goals:

- **Unit Tests**: 80%+ line coverage
- **E2E Tests**: Critical path coverage
  - Sync operations (upload/download)
  - Pagination behavior
  - Preview size limits
  - Delete operations
  - Icon differentiation

## Adding New Tests

### E2E Test Template

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
    createLocalStackS3Client,
    createTestBucket,
    deleteTestBucket,
    generateTestBucketName,
} from './localstack-helper';

describe('E2E: Your Feature', () => {
    let s3Client: S3Client;
    let testBucketName: string;

    beforeAll(async () => {
        s3Client = createLocalStackS3Client();
        testBucketName = generateTestBucketName();
        await createTestBucket(s3Client, testBucketName);
    });

    afterAll(async () => {
        await deleteTestBucket(s3Client, testBucketName);
    });

    it('should do something', async () => {
        // Your test here
    });
});
```

### Running Specific Tests

```bash
# Run a specific test file
pnpm run test:e2e -- src/tests/e2e/s3-operations.e2e.test.ts

# Run tests matching a pattern
pnpm run test:e2e -- --testNamePattern="pagination"

# Run with verbose output
pnpm run test:e2e -- --verbose
```

## Best Practices

1. **Clean up after tests** - Always use `afterAll` to delete test buckets
2. **Use unique names** - Use `generateTestBucketName()` to avoid collisions
3. **Keep tests fast** - E2E tests should complete in <60 seconds each
4. **Test behavior, not implementation** - Focus on what the user experiences
5. **Mock when appropriate** - Don't test AWS SDK, test your code's interaction with it

## Resources

- [LocalStack Documentation](https://docs.localstack.cloud/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Jest Documentation](https://jestjs.io/)
- [SQS Extension E2E Tests](../sqs-management-tool/E2E_TEST_FINAL_SUMMARY.md) - Reference implementation
