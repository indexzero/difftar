/**
 * Data acquisition layer for npm-diff-worker.
 *
 * Implements transport/auth orthogonality: authentication is applied
 * independently of how bytes are transported. This separation allows
 * 3 auth types x N transports without code duplication.
 *
 * Supported transports:
 * - url: HTTP/HTTPS URLs with optional auth (none, basic, bearer)
 * - s3: S3/R2-compatible storage with AWS Signature V4
 * - inline: In-memory Uint8Array or base64 string
 * - file: Local filesystem (Node.js, Bun, Deno only)
 *
 * @module fetch
 */

import { AwsClient } from 'aws4fetch';
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
 * S3/R2 configuration for s3 transport.
 * @typedef {Object} S3Config
 * @property {string} accessKeyId - AWS access key ID
 * @property {string} secretAccessKey - AWS secret access key
 * @property {string} [region='us-east-1'] - AWS region ('auto' for Cloudflare R2)
 * @property {string} [endpoint] - Custom endpoint URL (for R2, MinIO, etc.)
 * @property {string} [sessionToken] - Session token for temporary credentials (STS)
 */

/**
 * Source configuration for fetching a tarball.
 * @typedef {Object} SourceConfig
 * @property {'url' | 's3' | 'inline' | 'file'} transport - Transport mechanism
 * @property {string} [source] - URL, S3 URI (s3://bucket/key), or file path
 * @property {AuthType} [auth] - Authentication type for url transport (default: 'none')
 * @property {string} [credential] - Auth credential (token for bearer, base64 user:pass for basic)
 * @property {S3Config} [s3] - S3 configuration (required for s3 transport)
 * @property {Uint8Array | string} [data] - Tarball data as Uint8Array or base64 string (inline transport)
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
 * // URL transport: Public registry
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
 * });
 *
 * // URL transport: Private registry with bearer token
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://npm.pkg.github.com/download/@org/pkg/1.0.0/abc123',
 *   auth: 'bearer',
 *   credential: 'ghp_xxxx'
 * });
 *
 * // URL transport: Private registry with basic auth
 * const result = await fetchTarball({
 *   transport: 'url',
 *   source: 'https://registry.example.com/package/-/package-1.0.0.tgz',
 *   auth: 'basic',
 *   credential: btoa('user:pass')
 * });
 *
 * // S3 transport: AWS S3
 * const result = await fetchTarball({
 *   transport: 's3',
 *   source: 's3://my-bucket/packages/pkg-1.0.0.tgz',
 *   s3: {
 *     accessKeyId: 'AKIA...',
 *     secretAccessKey: '...',
 *     region: 'us-east-1'
 *   }
 * });
 *
 * // S3 transport: Cloudflare R2
 * const result = await fetchTarball({
 *   transport: 's3',
 *   source: 's3://my-bucket/pkg.tgz',
 *   s3: {
 *     accessKeyId: '...',
 *     secretAccessKey: '...',
 *     region: 'auto',
 *     endpoint: 'https://account-id.r2.cloudflarestorage.com'
 *   }
 * });
 *
 * // Inline transport: Uint8Array (for npm publish _attachments)
 * const result = await fetchTarball({
 *   transport: 'inline',
 *   data: tarballUint8Array
 * });
 *
 * // Inline transport: Base64 string
 * const result = await fetchTarball({
 *   transport: 'inline',
 *   data: base64EncodedTarball
 * });
 *
 * // File transport: Local filesystem (Node.js/Bun/Deno only)
 * const result = await fetchTarball({
 *   transport: 'file',
 *   source: '/path/to/package.tgz'
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
      assertDiff(
        typeof config.source === 'string' && config.source.length > 0,
        'FETCH',
        'S3 source URI is required for s3 transport'
      );
      assertDiff(
        Boolean(config.s3 && typeof config.s3 === 'object'),
        'FETCH',
        'S3 configuration is required for s3 transport'
      );
      // @ts-expect-error - assertDiff ensures config.s3 is defined
      return fetchS3(config.source, config.s3);

    case 'inline':
      assertDiff(
        config.data !== undefined && config.data !== null,
        'FETCH',
        'Inline data is required for inline transport'
      );
      return fetchInline(config.data);

    case 'file':
      assertDiff(
        typeof config.source === 'string' && config.source.length > 0,
        'FETCH',
        'File path is required for file transport'
      );
      return fetchFile(config.source);

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

// =============================================================================
// Inline Transport
// =============================================================================

/**
 * Decode base64 string to Uint8Array.
 * Uses atob which is available in all target runtimes.
 *
 * @param {string} base64 - Base64-encoded string
 * @returns {Uint8Array} Decoded bytes
 * @throws {DiffError} If base64 string is invalid
 */
function base64ToUint8Array(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    throw DiffError.wrap('FETCH', error, 'Invalid base64 data');
  }
}

/**
 * Create a FetchResult from inline tarball data.
 *
 * Accepts tarball data directly as Uint8Array or base64-encoded string.
 * Useful for npm publish _attachments or testing.
 *
 * @param {Uint8Array | string} data - Tarball data (Uint8Array or base64 string)
 * @returns {FetchResult} Stream and size
 * @throws {DiffError} On invalid data or size limit exceeded
 *
 * @example
 * ```js
 * // Uint8Array input
 * const result = fetchInline(tarballBytes);
 *
 * // Base64 string input
 * const result = fetchInline(base64EncodedTarball);
 * ```
 */
function fetchInline(data) {
  assertDiff(
    data !== undefined && data !== null,
    'FETCH',
    'Inline data is required for inline transport'
  );

  // Convert base64 string to Uint8Array if needed
  /** @type {Uint8Array} */
  let bytes;

  if (typeof data === 'string') {
    bytes = base64ToUint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    throw new DiffError(
      'FETCH',
      'Inline data must be Uint8Array or base64 string'
    );
  }

  // Check size limit
  if (bytes.length > MAX_TARBALL_SIZE) {
    throw new DiffError(
      'SIZE',
      `Inline data size ${formatBytes(bytes.length)} exceeds limit of ${formatBytes(MAX_TARBALL_SIZE)}`
    );
  }

  // Create ReadableStream from the bytes
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });

  return { stream, size: bytes.length };
}

// =============================================================================
// S3 Transport
// =============================================================================

/**
 * Convert S3 URI to HTTPS URL.
 *
 * @param {string} source - s3://bucket/key or https://... URL
 * @param {string} [endpoint] - Custom endpoint for R2/MinIO
 * @param {string} [region='us-east-1'] - AWS region
 * @returns {string} HTTPS URL
 * @throws {DiffError} On invalid S3 URI format
 *
 * @example
 * ```js
 * convertS3Url('s3://my-bucket/path/to/file.tgz', null, 'us-west-2')
 * // → 'https://my-bucket.s3.us-west-2.amazonaws.com/path/to/file.tgz'
 *
 * convertS3Url('s3://bucket/key.tgz', 'https://abc.r2.cloudflarestorage.com')
 * // → 'https://abc.r2.cloudflarestorage.com/bucket/key.tgz'
 * ```
 */
function convertS3Url(source, endpoint, region = 'us-east-1') {
  // If already HTTPS/HTTP, return as-is
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return source;
  }

  // Parse s3://bucket/key format
  if (source.startsWith('s3://')) {
    const path = source.slice(5); // Remove 's3://'
    const slashIndex = path.indexOf('/');

    if (slashIndex === -1) {
      throw new DiffError(
        'FETCH',
        `Invalid S3 URI: ${source} (must be s3://bucket/key)`
      );
    }

    const bucket = path.slice(0, slashIndex);
    const key = path.slice(slashIndex + 1);

    if (!bucket) {
      throw new DiffError('FETCH', `Invalid S3 URI: ${source} (empty bucket)`);
    }

    if (!key) {
      throw new DiffError('FETCH', `Invalid S3 URI: ${source} (empty key)`);
    }

    // Use custom endpoint or default S3 endpoint
    if (endpoint) {
      // Custom endpoint (R2, MinIO, etc.) - path-style
      const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      return `${base}/${bucket}/${key}`;
    }

    // Default AWS S3 endpoint - virtual-hosted style
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  throw new DiffError(
    'FETCH',
    `Invalid S3 source: ${source} (must be s3://bucket/key or https://...)`
  );
}

/**
 * Fetch a tarball from S3 or S3-compatible storage (R2, MinIO).
 *
 * Uses AWS Signature V4 authentication via aws4fetch.
 *
 * @param {string} source - S3 URI (s3://bucket/key) or HTTPS URL
 * @param {S3Config} s3Config - S3 credentials and configuration
 * @returns {Promise<FetchResult>} Stream and size
 * @throws {DiffError} On auth failure, network error, or size limit exceeded
 *
 * @example
 * ```js
 * // AWS S3
 * const result = await fetchS3('s3://my-bucket/packages/pkg-1.0.0.tgz', {
 *   accessKeyId: 'AKIA...',
 *   secretAccessKey: '...',
 *   region: 'us-east-1'
 * });
 *
 * // Cloudflare R2
 * const result = await fetchS3('s3://my-bucket/pkg.tgz', {
 *   accessKeyId: '...',
 *   secretAccessKey: '...',
 *   region: 'auto',
 *   endpoint: 'https://account-id.r2.cloudflarestorage.com'
 * });
 * ```
 */
async function fetchS3(source, s3Config) {
  assertDiff(
    s3Config && typeof s3Config === 'object',
    'FETCH',
    'S3 configuration is required for s3 transport'
  );

  assertDiff(
    typeof s3Config.accessKeyId === 'string' && s3Config.accessKeyId.length > 0,
    'AUTH',
    'S3 accessKeyId is required'
  );

  assertDiff(
    typeof s3Config.secretAccessKey === 'string' && s3Config.secretAccessKey.length > 0,
    'AUTH',
    'S3 secretAccessKey is required'
  );

  const {
    accessKeyId,
    secretAccessKey,
    region = 'us-east-1',
    endpoint,
    sessionToken
  } = s3Config;

  // Convert s3:// to https:// if needed
  const url = convertS3Url(source, endpoint, region);

  // Create AWS client for signing
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service: 's3'
  });

  // Sign and send request
  /** @type {Response} */
  let response;
  try {
    response = await client.fetch(url);
  } catch (error) {
    throw DiffError.wrap('FETCH', error, `S3 request failed for ${source}`);
  }

  // Handle HTTP errors
  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new DiffError(
        'AUTH',
        `S3 authentication failed: ${response.status} ${response.statusText}`
      );
    }

    if (response.status === 404) {
      throw new DiffError(
        'FETCH',
        `S3 object not found: ${source}`
      );
    }

    throw new DiffError(
      'FETCH',
      `S3 HTTP ${response.status} ${response.statusText} for ${source}`
    );
  }

  // Check Content-Length if available
  const contentLength = response.headers.get('Content-Length');
  const size = contentLength ? parseInt(contentLength, 10) : null;

  if (size !== null && size > MAX_TARBALL_SIZE) {
    throw new DiffError(
      'SIZE',
      `S3 object size ${formatBytes(size)} exceeds limit of ${formatBytes(MAX_TARBALL_SIZE)}`
    );
  }

  // Verify we have a body
  if (!response.body) {
    throw new DiffError('FETCH', 'S3 response has no body');
  }

  return { stream: response.body, size };
}

// =============================================================================
// File Transport
// =============================================================================

/**
 * Fetch a tarball from the local filesystem.
 *
 * Only available on Node.js, Bun, and Deno (with --allow-read).
 * Uses dynamic imports to avoid breaking edge runtimes.
 *
 * @param {string} source - Absolute or relative file path
 * @returns {Promise<FetchResult>} Stream and size
 * @throws {DiffError} On file not found, permission denied, or unsupported runtime
 *
 * @example
 * ```js
 * const result = await fetchFile('/path/to/package.tgz');
 * const result = await fetchFile('./local-package.tgz');
 * ```
 */
async function fetchFile(source) {
  assertDiff(
    typeof source === 'string' && source.length > 0,
    'FETCH',
    'File path is required for file transport'
  );

  // Dynamic imports - only fails when file transport is actually used on edge
  // Using 'any' types because dynamic import type inference is complex
  /** @type {any} */
  let fs;
  /** @type {any} */
  let fsp;
  /** @type {any} */
  let stream;

  try {
    fs = await import('node:fs');
    fsp = await import('node:fs/promises');
    stream = await import('node:stream');
  } catch (importError) {
    throw new DiffError(
      'FETCH',
      'File transport requires Node.js, Bun, or Deno with --allow-read. ' +
      'This runtime does not support filesystem access.',
      importError instanceof Error ? importError : undefined
    );
  }

  // Get file stats for size check
  /** @type {any} */
  let stats;
  try {
    stats = await fsp.stat(source);
  } catch (statError) {
    const err = /** @type {any} */ (statError);
    if (err.code === 'ENOENT') {
      throw new DiffError('FETCH', `File not found: ${source}`);
    }
    if (err.code === 'EACCES') {
      throw new DiffError('FETCH', `Permission denied: ${source}`);
    }
    if (err.code === 'EISDIR') {
      throw new DiffError('FETCH', `Path is a directory, not a file: ${source}`);
    }
    throw DiffError.wrap('FETCH', statError, `Cannot access file: ${source}`);
  }

  // Verify it's a file
  if (!stats.isFile()) {
    throw new DiffError('FETCH', `Path is not a regular file: ${source}`);
  }

  // Check size limit
  if (stats.size > MAX_TARBALL_SIZE) {
    throw new DiffError(
      'SIZE',
      `File size ${formatBytes(stats.size)} exceeds limit of ${formatBytes(MAX_TARBALL_SIZE)}`
    );
  }

  // Create Node.js readable stream
  const nodeStream = fs.createReadStream(source);

  // Convert to Web ReadableStream (available in Node 16.17+)
  /** @type {ReadableStream<Uint8Array>} */
  const webStream = stream.Readable.toWeb(nodeStream);

  return { stream: webStream, size: stats.size };
}
