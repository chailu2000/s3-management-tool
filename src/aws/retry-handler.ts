/**
 * Retry handler with exponential backoff for transient AWS errors.
 *
 * Retries on ThrottlingException and ServiceUnavailable with delays:
 * 1000ms, 2000ms, 4000ms (exponential backoff).
 * After max retries, throws the final error.
 */

const RETRYABLE_ERRORS = new Set([
    'ThrottlingException',
    'Throttling',
    'ServiceUnavailable',
    'ServiceUnavailableException',
    'RequestThrottled',
    'TooManyRequestsException',
]);

const BACKOFF_DELAYS_MS = [1000, 2000, 4000];

function isRetryable(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const e = error as Record<string, unknown>;
    const name = (e['name'] as string | undefined) ?? '';
    const code = (e['Code'] as string | undefined) ?? '';
    return RETRYABLE_ERRORS.has(name) || RETRYABLE_ERRORS.has(code);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes `operation`, retrying up to `maxRetries` times on throttling/service-unavailable errors.
 * Delays between retries: 1s, 2s, 4s (exponential backoff).
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            const isLastAttempt = attempt === maxRetries;
            if (isLastAttempt || !isRetryable(error)) {
                throw error;
            }

            await delay(BACKOFF_DELAYS_MS[attempt] ?? 4000);
        }
    }

    // Should never reach here, but satisfies TypeScript
    throw lastError;
}
