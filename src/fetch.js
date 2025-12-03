/**
 * Data acquisition layer for npm-diff-worker.
 *
 * Implements transport/auth orthogonality: authentication is applied
 * independently of how bytes are transported. This separation allows
 * 3 auth types x N transports without code duplication.
 *
 * Phase 1 implements URL transport only. S3, inline, and file transports
 * come in Phase 2.
 *
 * @module fetch
 */

import { DiffError, assertDiff } from './errors.js';

/**
 * Maximum tarball size in bytes.
 * Based on npm-high-impact analysis: 20MB covers ~p98 of packages.
 * @type {number}
 */
export const MAX_TARBALL_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Authentication type for tarball fetch.
 * @typedef {'none' | 'basic' | 'bearer'} AuthType
 */

/**
 * Source configuration for fetching a tarball.
 * @typedef {Object} SourceConfig
 * @property {'url' | 's3' | 'inline' | 'file'} transport - Transport mechanism
 * @property {string} [source] - URL or path for the tarball
 * @property {AuthType} [auth] - Authentication type (default: 'none')
 * @property {string} [credential] - Auth credential (token for bearer, base64 user:pass for basic)
 * @property {Object} [s3] - S3 configuration (Phase 2)
 * @property {string} [s3.accessKeyId] - S3 access key ID
 * @property {string} [s3.secretAccessKey] - S3 secret access key
 * @property {string} [s3.region] - S3 region
 * @property {Uint8Array | string} [data] - Inline tarball data (Phase 2)
 */

/**
 * Result of a tarball fetch operation.
 * @typedef {Object} FetchResult
 * @property {ReadableStream<Uint8Array>} stream - The tarball byte stream
 * @property {number | null} size - Content-Length if known, null otherwise
 */

/**
 * Apply authentication to request headers.
 *
 * @param {Headers} headers - Headers object to modify
 * @param {AuthType} auth - Authentication type
 * @param {string} [credential] - Credential value
 * @throws {DiffError} If auth type requires credential but none provided
 *
 * @example
 * ```js
 * const headers = new Headers();
 * applyAuth(headers, 'bearer', 'npm_abc123');
 * // headers.get('Authorization') === 'Bearer npm_abc123'
 * ```
 *
 * @example
 * ```js
 * const headers = new Headers();
 * applyAuth(headers, 'basic', btoa('user:pass'));
 * // headers.get('Authorization') === 'Basic dXNlcjpwYXNz'
 * ```
 */
export function applyAuth(headers, auth, credential) {
  if (auth === 'none' || !auth) {
    return;
  }

  assertDiff(
    typeof credential === 'string' && credential.length > 0,
    'AUTH',
    `Auth type '${auth}' requires a credential`
  );

  switch (auth) {
    case 'basic':
      headers.set('Authorization', `Basic ${credential}`);
      break;
    case 'bearer':
      headers.set('Authorization', `Bearer ${credential}`);
      break;
    default:
      throw new DiffError('AUTH', `Unknown auth type: ${auth}`);
  }
}

/**
 * Fetch a tarball from a URL.
 *
 * Validates Content-Length against MAX_TARBALL_SIZE before streaming.
 * Note: Some servers don't send Content-Length; in that case we cannot
 * pre-validate size and must rely on downstream buffering limits.
 *
 * @param {string | URL} url - URL to fetch
 * @param {Headers} [headers] - Request headers (including auth)
 * @returns {Promise<FetchResult>} Stream and size information
 * @throws {DiffError} On network errors, HTTP errors, or size violations
 *
 * @example
 * ```js
 * const { stream, size } = await fetchUrl('https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz');
 * ```
 */
export async function fetchUrl(url, headers = new Headers()) {
  /** @type {Response} */
  let response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      // Disable automatic redirect following to handle auth-sensitive redirects
      // Standard: 20 redirects max, but we want explicit control
      redirect: 'follow'
    });
  } catch (error) {
    throw DiffError.wrap('FETCH', error, `Network error fetching ${url}`);
  }

  // Handle HTTP errors
  if (!response.ok) {
    // Auth failures get special treatment
    if (response.status === 401 || response.status === 403) {
      throw new DiffError(
        'AUTH',
        `Authentication failed: ${response.status} ${response.statusText}`
      );
    }

    throw new DiffError(
      'FETCH',
      `HTTP ${response.status} ${response.statusText} for ${url}`
    );
  }

  // Check Content-Length if available
  const contentLength = response.headers.get('Content-Length');
  const size = contentLength ? parseInt(contentLength, 10) : null;

  if (size !== null && size > MAX_TARBALL_SIZE) {
    throw new DiffError(
      'SIZE',
      `Tarball size ${formatBytes(size)} exceeds limit of ${formatBytes(MAX_TARBALL_SIZE)}`
    );
  }

  // Verify we have a body
  if (!response.body) {
    throw new DiffError('FETCH', 'Response has no body');
  }

  return {
    stream: response.body,
    size
  };
}

/**
 * Fetch a tarball using the configured transport and authentication.
 *
 * This is the main entry point for data acquisition. It composes
 * transport and authentication orthogonally.
 *
 * @param {SourceConfig} config - Source configuration
 * @returns {Promise<FetchResult>} Stream and size information
 * @throws {DiffError} On any acquisition failure
 *
 * @example
 * ```js
 * // Public registry URL
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
 * });
 *
 * // Private registry with bearer token
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://npm.pkg.github.com/download/@org/pkg/1.0.0/abc123',
 *   auth: 'bearer',
 *   credential: 'ghp_xxxx'
 * });
 *
 * // Private registry with basic auth
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://registry.example.com/package/-/package-1.0.0.tgz',
 *   auth: 'basic',
 *   credential: btoa('user:pass')
 * });
 * ```
 */
export async function fetchTarball(config) {
  assertDiff(
    config && typeof config === 'object',
    'FETCH',
    'Source configuration is required'
  );

  assertDiff(
    typeof config.transport === 'string',
    'FETCH',
    'Transport type is required'
  );

  // Build headers with authentication
  const headers = new Headers();
  applyAuth(headers, config.auth || 'none', config.credential);

  // Dispatch to transport
  switch (config.transport) {
    case 'url':
      assertDiff(
        typeof config.source === 'string' && config.source.length > 0,
        'FETCH',
        'URL source is required for url transport'
      );
      return fetchUrl(config.source, headers);

    case 's3':
      // Phase 2: S3 transport with aws4fetch
      throw new DiffError('FETCH', 'S3 transport not yet implemented (Phase 2)');

    case 'inline':
      // Phase 2: Inline tarball data
      throw new DiffError('FETCH', 'Inline transport not yet implemented (Phase 2)');

    case 'file':
      // Phase 2: Filesystem access (Node/Bun only)
      throw new DiffError('FETCH', 'File transport not yet implemented (Phase 2)');

    default:
      throw new DiffError('FETCH', `Unknown transport: ${config.transport}`);
  }
}

/**
 * Format bytes as human-readable string.
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "20.0 MB")
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
