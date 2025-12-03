/**
 * Error handling foundation for npm-diff-worker.
 *
 * Provides typed errors with phase information for proper HTTP status mapping
 * and credential sanitization for safe logging.
 *
 * @module errors
 */

/**
 * Error phases map to specific HTTP status codes.
 * @typedef {'FETCH' | 'DECOMPRESS' | 'TAR' | 'DIFF' | 'AUTH' | 'SIZE'} ErrorPhase
 */

/**
 * HTTP status codes for each error phase.
 * @type {Record<ErrorPhase, number>}
 */
const HTTP_STATUS_MAP = {
  AUTH: 401,
  SIZE: 413,
  FETCH: 502,
  DECOMPRESS: 422,
  TAR: 422,
  DIFF: 500
};

/**
 * Patterns for sensitive data that should be sanitized from error messages and stack traces.
 * @type {RegExp[]}
 */
const CREDENTIAL_PATTERNS = [
  // Authorization headers
  /Authorization:\s*(Basic|Bearer)\s+[A-Za-z0-9+/=_-]+/gi,
  // AWS credentials
  /aws[_-]?(access[_-]?key[_-]?id|secret[_-]?access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]+['"]?/gi,
  // Generic tokens in URLs
  /token=[A-Za-z0-9+/=_-]{8,}/gi,
  // Basic auth in URLs (user:pass@host)
  /:\/\/[^:]+:[^@]+@/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  // Base64-encoded credentials (common patterns)
  /credential[s]?\s*[:=]\s*['"]?[A-Za-z0-9+/=]{20,}['"]?/gi
];

/**
 * Sanitize sensitive credentials from a string.
 * Replaces tokens, passwords, and auth headers with [REDACTED].
 *
 * @param {string} input - String that may contain credentials
 * @returns {string} Sanitized string
 */
export function sanitizeCredentials(input) {
  if (typeof input !== 'string') {
    return input;
  }

  let sanitized = input;

  for (const pattern of CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, (match) => {
      // Preserve the prefix for context
      const colonIndex = match.indexOf(':');
      const equalsIndex = match.indexOf('=');
      const separatorIndex = Math.min(
        colonIndex === -1 ? Infinity : colonIndex,
        equalsIndex === -1 ? Infinity : equalsIndex
      );

      if (separatorIndex !== Infinity && separatorIndex < match.length - 1) {
        const prefix = match.slice(0, separatorIndex + 1);
        return `${prefix} [REDACTED]`;
      }

      return '[REDACTED]';
    });
  }

  // Handle URL credentials specially to preserve URL structure
  sanitized = sanitized.replace(/:\/\/[^:]+:[^@]+@/g, '://[REDACTED]:[REDACTED]@');

  return sanitized;
}

/**
 * Error class for npm-diff-worker operations.
 *
 * Each error has a phase that maps to an HTTP status code, making it easy
 * to convert errors to appropriate API responses.
 *
 * @extends Error
 */
export class DiffError extends Error {
  /**
   * The phase of the diff operation where the error occurred.
   * @type {ErrorPhase}
   */
  phase;

  /**
   * HTTP status code for this error type.
   * @type {number}
   */
  status;

  /**
   * Original error that caused this error, if any.
   * @type {Error | undefined}
   */
  cause;

  /**
   * Create a new DiffError.
   *
   * @param {ErrorPhase} phase - The phase where the error occurred
   * @param {string} message - Human-readable error message
   * @param {Error} [cause] - The underlying error that caused this error
   *
   * @example
   * ```js
   * throw new DiffError('FETCH', 'Failed to fetch tarball', fetchError);
   * ```
   *
   * @example
   * ```js
   * throw new DiffError('SIZE', 'Package exceeds 20MB limit');
   * ```
   */
  constructor(phase, message, cause) {
    // Sanitize credentials from the message
    const sanitizedMessage = sanitizeCredentials(message);
    super(sanitizedMessage);

    this.name = 'DiffError';
    this.phase = phase;
    this.status = HTTP_STATUS_MAP[phase];

    if (cause) {
      this.cause = cause;
    }

    // Capture stack trace excluding constructor (V8 environments only)
    // @ts-expect-error - captureStackTrace is V8-specific
    if (typeof Error.captureStackTrace === 'function') {
      // @ts-expect-error - captureStackTrace is V8-specific
      Error.captureStackTrace(this, DiffError);
    }
  }

  /**
   * Get the HTTP status code for this error.
   * Useful for API responses.
   *
   * @returns {number} HTTP status code
   */
  get httpStatus() {
    return this.status;
  }

  /**
   * Convert error to a JSON-serializable object for API responses.
   * Credentials are sanitized from all fields.
   *
   * @returns {{ error: string, phase: ErrorPhase, status: number, message: string, cause?: string }}
   *
   * @example
   * ```js
   * try {
   *   await diff(left, right);
   * } catch (err) {
   *   if (err instanceof DiffError) {
   *     return Response.json(err.toJSON(), { status: err.status });
   *   }
   * }
   * ```
   */
  toJSON() {
    /** @type {{ error: string, phase: ErrorPhase, status: number, message: string, cause?: string }} */
    const json = {
      error: 'DiffError',
      phase: this.phase,
      status: this.status,
      message: sanitizeCredentials(this.message)
    };

    if (this.cause) {
      json.cause = sanitizeCredentials(
        this.cause instanceof Error ? this.cause.message : String(this.cause)
      );
    }

    return json;
  }

  /**
   * Get sanitized stack trace.
   * Credentials are removed from the stack trace for safe logging.
   *
   * @returns {string | undefined} Sanitized stack trace
   */
  get sanitizedStack() {
    return this.stack ? sanitizeCredentials(this.stack) : undefined;
  }

  /**
   * Create a Response object from this error.
   * Useful for Cloudflare Workers and other edge runtimes.
   *
   * @returns {Response} HTTP Response with JSON body and appropriate status code
   *
   * @example
   * ```js
   * export default {
   *   async fetch(request) {
   *     try {
   *       const patch = await diff(left, right);
   *       return new Response(patch);
   *     } catch (err) {
   *       if (err instanceof DiffError) {
   *         return err.toResponse();
   *       }
   *       throw err;
   *     }
   *   }
   * };
   * ```
   */
  toResponse() {
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }

  /**
   * Create a DiffError from an unknown error.
   * Useful for wrapping errors from external libraries.
   *
   * @param {ErrorPhase} phase - The phase where the error occurred
   * @param {unknown} error - The error to wrap
   * @param {string} [context] - Additional context to prepend to the message
   * @returns {DiffError}
   *
   * @example
   * ```js
   * try {
   *   await fetch(url);
   * } catch (err) {
   *   throw DiffError.wrap('FETCH', err, 'Failed to fetch left tarball');
   * }
   * ```
   */
  static wrap(phase, error, context) {
    if (error instanceof DiffError) {
      // Already a DiffError, optionally add context
      if (context) {
        return new DiffError(phase, `${context}: ${error.message}`, error.cause);
      }
      return error;
    }

    const message = error instanceof Error
      ? error.message
      : String(error);

    const fullMessage = context ? `${context}: ${message}` : message;

    return new DiffError(
      phase,
      fullMessage,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Type guard to check if an error is a DiffError.
 *
 * @param {unknown} error - The error to check
 * @returns {error is DiffError} True if the error is a DiffError
 *
 * @example
 * ```js
 * try {
 *   await diff(left, right);
 * } catch (err) {
 *   if (isDiffError(err)) {
 *     console.log(`Failed at phase: ${err.phase}`);
 *   }
 * }
 * ```
 */
export function isDiffError(error) {
  return error instanceof DiffError;
}

/**
 * Assert a condition and throw a DiffError if it fails.
 *
 * @param {boolean} condition - The condition to assert
 * @param {ErrorPhase} phase - The phase for the error
 * @param {string} message - Error message if condition is false
 * @returns {asserts condition}
 *
 * @example
 * ```js
 * assertDiff(contentLength < MAX_SIZE, 'SIZE', 'Package exceeds size limit');
 * ```
 */
export function assertDiff(condition, phase, message) {
  if (!condition) {
    throw new DiffError(phase, message);
  }
}
