/**
 * Webview sanitizer — strips AWS credential fields from any object before it
 * is sent to the webview via postMessage.
 *
 * The fields removed are: accessKeyId, secretAccessKey, sessionToken.
 * The function performs a deep clone so the original object is never mutated.
 */

const CREDENTIAL_FIELDS = new Set(['accessKeyId', 'secretAccessKey', 'sessionToken']);

/**
 * Deep-clones `data` and removes any property whose name is one of the
 * credential field names, at any nesting depth.
 */
export function sanitizeForWebview(data: unknown): unknown {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data !== 'object') {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(sanitizeForWebview);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (CREDENTIAL_FIELDS.has(key)) {
            continue; // strip the field entirely
        }
        result[key] = sanitizeForWebview(value);
    }
    return result;
}
