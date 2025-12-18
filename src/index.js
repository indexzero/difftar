/**
 * RAWR! I'm Difftar!
 *
 * The giant green tarball-diffing monster that stomps through your npm packages!
 * Fear my unified diffs! I will compare your tarballs and ROAR the differences!
 *
 * WinterTC-compatible, edge-ready, and hungry for tarballs. Difftar runs on
 * Cloudflare Workers, Deno Deploy, Node.js 18+, Bun, and Google Cloud Run.
 *
 * Architecture: CHOMP (Fetch) -> CRUNCH (Decompress) -> TEAR (Untar) -> STOMP (Diff) -> ROAR (Format)
 *
 * @module difftar
 *
 * @example
 * ```js
 * import { diff } from 'difftar';
 *
 * // Let Difftar loose on your tarballs!
 * const patch = await diff(
 *   { transport: 'url', source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz' },
 *   { transport: 'url', source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
 *   { context: 3 }
 * );
 *
 * console.log(patch); // RAWR! Here are your differences!
 * ```
 */

import { fetchTarball, MAX_TARBALL_SIZE } from './fetch.js';
import { decompress } from './decompress.js';
import { extractTarball } from './tar.js';
import { formatDiff } from './format.js';
import { DiffError, isDiffError, assertDiff, sanitizeCredentials } from './errors.js';
import { isBinaryPath, shouldPrintPatch, getBinaryExtensions } from './binary.js';
import { computeDiff, computeTreeDiff, computeFileDiff, decodeBytes } from './diff.js';

/**
 * Source configuration for fetching a tarball.
 * @typedef {import('./fetch.js').SourceConfig} SourceConfig
 */

/**
 * Diff options for controlling comparison and output.
 * @typedef {Object} DiffOptions
 * @property {boolean} [nameOnly] - Only output file names (--diff-name-only)
 * @property {boolean} [ignoreAllSpace] - Ignore all whitespace changes (--diff-ignore-all-space)
 * @property {boolean} [ignoreSpaceChange] - Ignore changes in whitespace amount (--diff-ignore-space-change)
 * @property {number} [context] - Number of context lines (--diff-unified, default: 3)
 * @property {boolean} [noPrefix] - Remove a/ b/ prefixes (--diff-no-prefix)
 * @property {string} [srcPrefix] - Source prefix (--diff-src-prefix, default: 'a/')
 * @property {string} [dstPrefix] - Destination prefix (--diff-dst-prefix, default: 'b/')
 * @property {boolean} [text] - Treat all files as text (--diff-text)
 */

/**
 * Result of a diff operation.
 * @typedef {Object} DiffResult
 * @property {string} output - The formatted diff output
 * @property {number} filesChanged - Number of files with changes
 * @property {number} filesAdded - Number of files added
 * @property {number} filesDeleted - Number of files deleted
 */

/**
 * Acquire and extract a tarball from a source configuration.
 *
 * Composes the Fetch -> Decompress -> Untar pipeline.
 *
 * @param {SourceConfig} config - Source configuration
 * @returns {Promise<Map<string, Uint8Array>>} Extracted file tree
 * @throws {DiffError} On any pipeline failure
 */
async function acquireFiles(config) {
  // Fetch tarball
  const { stream } = await fetchTarball(config);

  // Decompress gzip
  const tarStream = decompress(stream);

  // Extract tar to file map
  const files = await extractTarball(tarStream);

  return files;
}

/**
 * Compute a unified diff between two npm package tarballs.
 *
 * This is the main entry point for npm-diff-worker. It fetches both
 * tarballs, extracts them to in-memory file trees, computes the diff,
 * and returns formatted output.
 *
 * @param {SourceConfig} left - Left (old) package source configuration
 * @param {SourceConfig} right - Right (new) package source configuration
 * @param {DiffOptions} [options] - Diff options
 * @returns {Promise<string>} Unified diff output
 * @throws {DiffError} On any operation failure
 *
 * @example
 * ```js
 * // Compare two versions from the public registry
 * const patch = await diff(
 *   { transport: 'url', source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz' },
 *   { transport: 'url', source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' }
 * );
 * ```
 *
 * @example
 * ```js
 * // Compare with authentication
 * const patch = await diff(
 *   {
 *     transport: 'url',
 *     source: 'https://npm.pkg.github.com/@org/pkg/-/pkg-1.0.0.tgz',
 *     auth: 'bearer',
 *     credential: process.env.GITHUB_TOKEN
 *   },
 *   {
 *     transport: 'url',
 *     source: 'https://npm.pkg.github.com/@org/pkg/-/pkg-2.0.0.tgz',
 *     auth: 'bearer',
 *     credential: process.env.GITHUB_TOKEN
 *   },
 *   { context: 5, ignoreAllSpace: true }
 * );
 * ```
 *
 * @example
 * ```js
 * // Name-only mode
 * const changedFiles = await diff(left, right, { nameOnly: true });
 * // Returns: "lib/index.js\npackage.json\n"
 * ```
 */
export async function diff(left, right, options = {}) {
  assertDiff(
    left && typeof left === 'object',
    'FETCH',
    'Left source configuration is required'
  );

  assertDiff(
    right && typeof right === 'object',
    'FETCH',
    'Right source configuration is required'
  );

  // Fetch and extract both tarballs in parallel
  const [leftFiles, rightFiles] = await Promise.all([
    acquireFiles(left),
    acquireFiles(right)
  ]);

  // Compute and format diff
  const result = formatDiff(leftFiles, rightFiles, options);

  return result.output;
}

/**
 * Compute a diff with full result metadata.
 *
 * Like diff(), but returns additional information about the changes.
 *
 * @param {SourceConfig} left - Left (old) package source configuration
 * @param {SourceConfig} right - Right (new) package source configuration
 * @param {DiffOptions} [options] - Diff options
 * @returns {Promise<DiffResult>} Diff output with statistics
 * @throws {DiffError} On any operation failure
 *
 * @example
 * ```js
 * const result = await diffWithStats(left, right);
 * console.log(`${result.filesChanged} files changed`);
 * console.log(`${result.filesAdded} files added`);
 * console.log(`${result.filesDeleted} files deleted`);
 * console.log(result.output);
 * ```
 */
export async function diffWithStats(left, right, options = {}) {
  assertDiff(
    left && typeof left === 'object',
    'FETCH',
    'Left source configuration is required'
  );

  assertDiff(
    right && typeof right === 'object',
    'FETCH',
    'Right source configuration is required'
  );

  // Fetch and extract both tarballs in parallel
  const [leftFiles, rightFiles] = await Promise.all([
    acquireFiles(left),
    acquireFiles(right)
  ]);

  // Compute and format diff
  return formatDiff(leftFiles, rightFiles, options);
}

/**
 * Extract file tree from a tarball source.
 *
 * Useful for inspecting package contents without computing a diff.
 *
 * @param {SourceConfig} config - Source configuration
 * @returns {Promise<Map<string, Uint8Array>>} Extracted file tree
 * @throws {DiffError} On any operation failure
 *
 * @example
 * ```js
 * const files = await extractPackage({
 *   transport: 'url',
 *   source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
 * });
 *
 * for (const [path, content] of files) {
 *   console.log(`${path}: ${content.length} bytes`);
 * }
 * ```
 */
export async function extractPackage(config) {
  return acquireFiles(config);
}

// Re-export error handling utilities
export {
  DiffError,
  isDiffError,
  assertDiff,
  sanitizeCredentials
};

// Re-export binary detection utilities
export {
  isBinaryPath,
  shouldPrintPatch,
  getBinaryExtensions
};

// Re-export diff utilities for advanced usage
export {
  computeDiff,
  computeTreeDiff,
  computeFileDiff,
  decodeBytes
};

// Re-export size limit constant
export { MAX_TARBALL_SIZE };
