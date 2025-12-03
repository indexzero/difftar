/**
 * Tarball extraction layer for npm-diff-worker.
 *
 * Transforms tar streams into in-memory file maps using modern-tar.
 * Designed for edge runtimes with no filesystem access - all extraction
 * happens in memory via Map<string, Uint8Array>.
 *
 * Path traversal is not a security concern here because:
 * 1. We extract to an in-memory Map, not to disk
 * 2. Path traversal attacks require filesystem writes to exploit
 * 3. Sources are trusted: npm registry, authenticated registries, or caller data
 *
 * @module tar
 */

import { createTarDecoder } from 'modern-tar';
import { DiffError } from './errors.js';

/**
 * Entry types that represent files with content.
 * @type {Set<string>}
 */
const FILE_TYPES = new Set(['file']);

/**
 * Entry types that represent symlinks (which we error on).
 * npm strips symlinks on publish, so these are rare in registry tarballs.
 * @type {Set<string>}
 */
const SYMLINK_TYPES = new Set(['symlink', 'link']);

/**
 * Regex to strip the `package/` prefix from npm tarball paths.
 * npm tarballs always have a `package/` root directory.
 * @type {RegExp}
 */
const PACKAGE_PREFIX = /^package\//;

/**
 * Result of tarball extraction - a map of file paths to their contents.
 * @typedef {Map<string, Uint8Array>} FileMap
 */

/**
 * Tar entry header from modern-tar.
 * @typedef {Object} TarHeader
 * @property {string} name - File path within the archive
 * @property {string} type - Entry type: 'file', 'directory', 'symlink', 'link', etc.
 * @property {number} size - File size in bytes
 * @property {number} [mode] - File mode (permissions)
 * @property {number} [mtime] - Modification time as Unix timestamp
 * @property {string} [linkname] - Target path for symlinks/links
 */

/**
 * Tar entry from modern-tar stream.
 * @typedef {Object} TarEntry
 * @property {TarHeader} header - Entry metadata
 * @property {ReadableStream<Uint8Array>} body - Entry content stream
 */

/**
 * Collect all bytes from a ReadableStream into a single Uint8Array.
 *
 * @param {ReadableStream<Uint8Array>} stream - Stream to collect
 * @returns {Promise<Uint8Array>} All bytes from the stream
 */
async function streamToBytes(stream) {
  const reader = stream.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  // Fast path: single chunk
  if (chunks.length === 1) {
    return chunks[0];
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Extract files from a tar stream into an in-memory Map.
 *
 * Takes an uncompressed tar stream (use decompress() first for .tgz files)
 * and extracts all file entries into a Map keyed by path.
 *
 * Strips the `package/` prefix that npm tarballs always include.
 * Errors on symlinks since npm strips them on publish.
 *
 * @param {ReadableStream<Uint8Array>} stream - Uncompressed tar byte stream
 * @returns {Promise<FileMap>} Map of file paths to Uint8Array contents
 * @throws {DiffError} If a symlink is encountered or tar is malformed
 *
 * @example
 * ```js
 * import { fetchTarball } from './fetch.js';
 * import { decompress } from './decompress.js';
 * import { extractTarball } from './tar.js';
 *
 * const { stream } = await fetchTarball(config);
 * const tarStream = decompress(stream);
 * const files = await extractTarball(tarStream);
 *
 * // files is Map<string, Uint8Array>
 * for (const [path, content] of files) {
 *   console.log(path, content.length);
 * }
 * ```
 *
 * @example
 * ```js
 * // Typical npm tarball structure:
 * // package/package.json -> package.json
 * // package/lib/index.js -> lib/index.js
 * // package/README.md    -> README.md
 * ```
 */
export async function extractTarball(stream) {
  if (!stream || typeof stream.pipeThrough !== 'function') {
    throw new DiffError(
      'TAR',
      'Invalid input: expected a ReadableStream'
    );
  }

  /** @type {FileMap} */
  const files = new Map();

  try {
    // Create tar decoder transform stream
    const decoder = createTarDecoder();

    // Pipe through the decoder
    const entryStream = stream.pipeThrough(decoder);

    // Process each entry
    // @ts-expect-error - ReadableStream is async iterable in modern runtimes
    for await (const entry of entryStream) {
      const { header, body } = /** @type {TarEntry} */ (entry);

      // Check for symlinks - error since npm strips these
      if (SYMLINK_TYPES.has(header.type)) {
        // Cancel the body stream before throwing
        await body.cancel();
        throw new DiffError(
          'TAR',
          `Symlinks are not supported: ${header.name} -> ${header.linkname || '(unknown)'}`
        );
      }

      // Only process regular files
      if (!FILE_TYPES.has(header.type)) {
        // Drain non-file entries (directories, etc.)
        await body.cancel();
        continue;
      }

      // Strip package/ prefix
      const path = header.name.replace(PACKAGE_PREFIX, '');

      // Skip if stripping resulted in empty path
      if (!path) {
        await body.cancel();
        continue;
      }

      // Read file content
      const content = await streamToBytes(body);

      // Store in map
      files.set(path, content);
    }
  } catch (error) {
    // If it's already a DiffError, re-throw
    if (error instanceof DiffError) {
      throw error;
    }

    // Wrap tar parsing errors
    throw DiffError.wrap('TAR', error, 'Failed to parse tarball');
  }

  return files;
}

/**
 * Extract files from a tarball with options.
 *
 * Extended version of extractTarball that accepts options for
 * filtering and transforming entries during extraction.
 *
 * @param {ReadableStream<Uint8Array>} stream - Uncompressed tar byte stream
 * @param {Object} [options] - Extraction options
 * @param {boolean} [options.stripPackagePrefix=true] - Strip `package/` prefix
 * @param {(path: string, header: TarHeader) => boolean} [options.filter] - Filter function
 * @returns {Promise<FileMap>} Map of file paths to Uint8Array contents
 * @throws {DiffError} If a symlink is encountered or tar is malformed
 *
 * @example
 * ```js
 * // Only extract JavaScript files
 * const files = await extractTarballWithOptions(stream, {
 *   filter: (path) => path.endsWith('.js')
 * });
 * ```
 */
export async function extractTarballWithOptions(stream, options = {}) {
  const {
    stripPackagePrefix = true,
    filter
  } = options;

  if (!stream || typeof stream.pipeThrough !== 'function') {
    throw new DiffError(
      'TAR',
      'Invalid input: expected a ReadableStream'
    );
  }

  /** @type {FileMap} */
  const files = new Map();

  try {
    const decoder = createTarDecoder();
    const entryStream = stream.pipeThrough(decoder);

    // @ts-expect-error - ReadableStream is async iterable in modern runtimes
    for await (const entry of entryStream) {
      const { header, body } = /** @type {TarEntry} */ (entry);

      // Check for symlinks
      if (SYMLINK_TYPES.has(header.type)) {
        await body.cancel();
        throw new DiffError(
          'TAR',
          `Symlinks are not supported: ${header.name} -> ${header.linkname || '(unknown)'}`
        );
      }

      // Only process regular files
      if (!FILE_TYPES.has(header.type)) {
        await body.cancel();
        continue;
      }

      // Compute path
      let path = header.name;
      if (stripPackagePrefix) {
        path = path.replace(PACKAGE_PREFIX, '');
      }

      // Skip empty paths
      if (!path) {
        await body.cancel();
        continue;
      }

      // Apply filter
      if (filter && !filter(path, header)) {
        await body.cancel();
        continue;
      }

      // Read and store
      const content = await streamToBytes(body);
      files.set(path, content);
    }
  } catch (error) {
    if (error instanceof DiffError) {
      throw error;
    }
    throw DiffError.wrap('TAR', error, 'Failed to parse tarball');
  }

  return files;
}
