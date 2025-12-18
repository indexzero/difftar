/**
 * Diff computation layer for npm-diff-worker.
 *
 * Wraps jsdiff to compute unified diffs between file contents.
 * The Myers O(ND) algorithm is the standard for text diffing,
 * providing optimal diffs with minimal computational overhead.
 *
 * @module diff
 */

import { createTwoFilesPatch } from 'diff';
import { DiffError } from './errors.js';

/**
 * Text decoder for converting Uint8Array to string.
 * Uses 'fatal: false' to handle malformed UTF-8 gracefully.
 * @type {TextDecoder}
 */
const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Diff options that affect comparison behavior.
 * @typedef {Object} DiffOptions
 * @property {boolean} [ignoreAllSpace] - Ignore all whitespace changes (--diff-ignore-all-space).
 *   Note: jsdiff treats whitespace as equivalent for matching purposes, but output
 *   still shows actual content. For complete whitespace ignoring, post-processing
 *   or a different algorithm would be needed.
 * @property {boolean} [ignoreSpaceChange] - Ignore changes in whitespace amount (--diff-ignore-space-change).
 *   Note: Currently treated same as ignoreAllSpace due to jsdiff limitations.
 *   jsdiff's ignoreWhitespace collapses runs of whitespace for comparison.
 * @property {number} [context] - Number of context lines (default: 3)
 * @property {boolean} [text] - Treat binary files as text
 * @property {boolean} [nameOnly] - Only output file names, not diffs
 * @property {boolean} [noPrefix] - Remove a/ b/ prefixes
 * @property {string} [srcPrefix] - Source prefix (default: 'a/')
 * @property {string} [dstPrefix] - Destination prefix (default: 'b/')
 */

/**
 * Result of a single file diff.
 * @typedef {Object} FileDiff
 * @property {string} path - Relative file path
 * @property {'modified' | 'added' | 'deleted' | 'unchanged'} status - Change type
 * @property {boolean} isBinary - Whether the file is detected as binary
 * @property {string | null} patch - The unified diff patch, or null if unchanged/binary
 */

/**
 * Decode Uint8Array to string with graceful error handling.
 *
 * @param {Uint8Array} bytes - Bytes to decode
 * @returns {string} Decoded string
 */
export function decodeBytes(bytes) {
  return decoder.decode(bytes);
}

/**
 * Normalize line endings to LF.
 * Handles CRLF (Windows) and CR (old Mac) line endings.
 *
 * @param {string} text - Text to normalize
 * @returns {string} Text with LF line endings
 */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Check if two Uint8Arrays have identical content.
 * Fast O(n) comparison before expensive O(ND) diff.
 *
 * @param {Uint8Array} a - First byte array
 * @param {Uint8Array} b - Second byte array
 * @returns {boolean} True if contents are identical
 */
export function areIdentical(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Compute a unified diff between two file contents.
 *
 * Uses jsdiff's createTwoFilesPatch for standard unified diff output.
 * Optimizes by skipping diff computation for identical files.
 *
 * @param {string} oldPath - Path for the old version (with prefix)
 * @param {string} newPath - Path for the new version (with prefix)
 * @param {string} oldContent - Old file content as string
 * @param {string} newContent - New file content as string
 * @param {DiffOptions} [options] - Diff options
 * @returns {string} Unified diff patch
 *
 * @example
 * ```js
 * const patch = computeDiff(
 *   'a/lib/index.js',
 *   'b/lib/index.js',
 *   'const x = 1;',
 *   'const x = 2;',
 *   { context: 3 }
 * );
 * ```
 */
export function computeDiff(oldPath, newPath, oldContent, newContent, options = {}) {
  const {
    context = 3,
    ignoreAllSpace = false,
    ignoreSpaceChange = false
  } = options;

  // Normalize line endings for consistent comparison
  const oldNormalized = normalizeLineEndings(oldContent);
  const newNormalized = normalizeLineEndings(newContent);

  // Build jsdiff options
  /** @type {Record<string, unknown>} */
  const jsdiffOptions = {
    context
  };

  // Handle whitespace options
  // jsdiff uses different comparator functions for whitespace handling
  if (ignoreAllSpace || ignoreSpaceChange) {
    jsdiffOptions.ignoreWhitespace = true;
  }

  try {
    const patch = createTwoFilesPatch(
      oldPath,
      newPath,
      oldNormalized,
      newNormalized,
      '', // oldHeader
      '', // newHeader
      jsdiffOptions
    );

    return patch;
  } catch (error) {
    throw DiffError.wrap('DIFF', error, `Failed to compute diff for ${oldPath}`);
  }
}

/**
 * Check if a diff patch indicates actual changes.
 *
 * jsdiff always produces output including headers, even for identical files.
 * This function checks if there are actual change hunks.
 *
 * @param {string} patch - Unified diff patch
 * @returns {boolean} True if the patch contains actual changes
 */
export function hasChanges(patch) {
  // Look for hunk headers (lines starting with @@)
  // If there are no hunks, the files are identical
  return patch.includes('\n@@ ');
}

/**
 * Compute diffs between two file trees.
 *
 * Takes two Maps of path -> content and produces diffs for all
 * changed, added, and deleted files.
 *
 * @param {Map<string, Uint8Array>} leftTree - Old file tree
 * @param {Map<string, Uint8Array>} rightTree - New file tree
 * @param {DiffOptions} [options] - Diff options
 * @returns {FileDiff[]} Array of file diffs
 *
 * @example
 * ```js
 * const leftFiles = await extractTarball(leftStream);
 * const rightFiles = await extractTarball(rightStream);
 *
 * const diffs = computeTreeDiff(leftFiles, rightFiles);
 * for (const diff of diffs) {
 *   if (diff.status !== 'unchanged') {
 *     console.log(`${diff.status}: ${diff.path}`);
 *   }
 * }
 * ```
 */
export function computeTreeDiff(leftTree, rightTree, options = {}) {
  const {
    srcPrefix = 'a/',
    dstPrefix = 'b/',
    noPrefix = false
  } = options;

  // Collect all unique paths
  const allPaths = new Set([...leftTree.keys(), ...rightTree.keys()]);

  // Sort paths for consistent output (matching npm diff behavior)
  const sortedPaths = [...allPaths].sort();

  /** @type {FileDiff[]} */
  const results = [];

  for (const path of sortedPaths) {
    const left = leftTree.get(path);
    const right = rightTree.get(path);

    // Determine prefixes
    const srcPfx = noPrefix ? '' : srcPrefix;
    const dstPfx = noPrefix ? '' : dstPrefix;

    if (left && right) {
      // File exists in both - check for modifications
      if (areIdentical(left, right)) {
        results.push({
          path,
          status: 'unchanged',
          isBinary: false,
          patch: null
        });
      } else {
        // Files differ - compute diff
        const oldContent = decodeBytes(left);
        const newContent = decodeBytes(right);

        const patch = computeDiff(
          `${srcPfx}${path}`,
          `${dstPfx}${path}`,
          oldContent,
          newContent,
          options
        );

        results.push({
          path,
          status: 'modified',
          isBinary: false,
          patch: hasChanges(patch) ? patch : null
        });
      }
    } else if (right) {
      // File only in right - added
      const newContent = decodeBytes(right);

      const patch = computeDiff(
        '/dev/null',
        `${dstPfx}${path}`,
        '',
        newContent,
        options
      );

      results.push({
        path,
        status: 'added',
        isBinary: false,
        patch
      });
    } else if (left) {
      // File only in left - deleted
      const oldContent = decodeBytes(left);

      const patch = computeDiff(
        `${srcPfx}${path}`,
        '/dev/null',
        oldContent,
        '',
        options
      );

      results.push({
        path,
        status: 'deleted',
        isBinary: false,
        patch
      });
    }
  }

  return results;
}

/**
 * Compute diff for a single file.
 *
 * Handles the three cases: modified, added, or deleted.
 * Returns a FileDiff object with the computed patch.
 *
 * @param {string} path - File path
 * @param {Uint8Array | undefined} left - Old content (undefined if added)
 * @param {Uint8Array | undefined} right - New content (undefined if deleted)
 * @param {DiffOptions} [options] - Diff options
 * @returns {FileDiff} Diff result for this file
 */
export function computeFileDiff(path, left, right, options = {}) {
  const {
    srcPrefix = 'a/',
    dstPrefix = 'b/',
    noPrefix = false
  } = options;

  const srcPfx = noPrefix ? '' : srcPrefix;
  const dstPfx = noPrefix ? '' : dstPrefix;

  if (left && right) {
    // Modified
    if (areIdentical(left, right)) {
      return {
        path,
        status: 'unchanged',
        isBinary: false,
        patch: null
      };
    }

    const oldContent = decodeBytes(left);
    const newContent = decodeBytes(right);
    const patch = computeDiff(
      `${srcPfx}${path}`,
      `${dstPfx}${path}`,
      oldContent,
      newContent,
      options
    );

    return {
      path,
      status: 'modified',
      isBinary: false,
      patch: hasChanges(patch) ? patch : null
    };
  }

  if (right) {
    // Added
    const newContent = decodeBytes(right);
    const patch = computeDiff(
      '/dev/null',
      `${dstPfx}${path}`,
      '',
      newContent,
      options
    );

    return {
      path,
      status: 'added',
      isBinary: false,
      patch
    };
  }

  if (left) {
    // Deleted
    const oldContent = decodeBytes(left);
    const patch = computeDiff(
      `${srcPfx}${path}`,
      '/dev/null',
      oldContent,
      '',
      options
    );

    return {
      path,
      status: 'deleted',
      isBinary: false,
      patch
    };
  }

  // Should never happen
  throw new DiffError('DIFF', `Invalid file diff state for ${path}`);
}
