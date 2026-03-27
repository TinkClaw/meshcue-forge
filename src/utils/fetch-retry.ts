/**
 * Resilient Fetch Helper
 *
 * Provides timeout via AbortController and retry with exponential backoff
 * for 429 (rate limit) and 5xx (server error) responses.
 */

export interface FetchRetryOptions {
  /** Request timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
  /** Maximum number of retries on 429 / 5xx. Default: 2. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Actual delays: base, base*3. Default: 1000. */
  baseDelayMs?: number;
}

/**
 * Map well-known HTTP status codes to clear error messages.
 * Returns `undefined` for codes that should not be retried and are not
 * in the well-known set (caller should handle generically).
 */
export function classifyHttpError(status: number, backendName: string): string | undefined {
  switch (status) {
    case 401:
      return `${backendName} API key is invalid or missing (HTTP 401). Check your API key configuration.`;
    case 402:
      return `${backendName} API quota exceeded or payment required (HTTP 402). Check your billing status.`;
    case 429:
      return `${backendName} API rate limit exceeded (HTTP 429).`;
    default:
      return undefined;
  }
}

/** Returns true if the status code is retryable (429 or 5xx). */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Fetch with timeout and retry logic.
 *
 * - Uses AbortController for request timeout (default 30s).
 * - Retries up to `maxRetries` times on 429 or 5xx with exponential backoff.
 * - Throws on non-retryable errors immediately.
 * - On final failure returns the last Response (caller checks `.ok`).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 30_000,
    maxRetries = 2,
    baseDelayMs = 1_000,
  } = options;

  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok || !isRetryable(response.status) || attempt === maxRetries) {
        return response;
      }

      // Retryable error -- save and wait
      lastResponse = response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      // AbortError means timeout
      if (err instanceof DOMException && err.name === "AbortError") {
        if (attempt === maxRetries) {
          throw new Error(`Request to ${url} timed out after ${timeoutMs}ms (${maxRetries + 1} attempts)`);
        }
        // Fall through to backoff
      } else {
        // Network errors etc. -- retry
        if (attempt === maxRetries) {
          throw err;
        }
      }
    }

    // Exponential backoff: 1s, 3s
    const delay = baseDelayMs * Math.pow(3, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // Should not reach here, but just in case
  return lastResponse!;
}
