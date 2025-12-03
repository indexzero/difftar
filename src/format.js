/**
 * Unified diff output formatting for npm-diff-worker.
 *
 * Produces git-compatible unified diff output matching npm diff's format.
 * Handles binary files, added/deleted files, and the /dev/null convention.
 *
 * Output format follows git unified diff conventions:
 * - `diff --git a/file b/file` header
 * - `new file mode` / `deleted file mode` markers
 * - `--- a/file` and `+++ b/file` lines
 * - Hunk headers with line ranges
 *
 * @module format
 */

import { shouldPrintPatch } from './binary.js';
import { computeFileDiff, decodeBytes, hasChanges } from './diff.js';

/**
 * Formatting options for diff output.
 * @typedef {Object} FormatOptions
 * @property {boolean} [nameOnly] - Only show file names, not content (--diff-name-only)
 * @property {boolean} [text] - Treat all files as text (--diff-text)
 * @property {boolean} [noPrefix] - Remove a/ b/ prefixes (--diff-no-prefix)
 * @property {string} [srcPrefix] - Source prefix (default: 'a/')
 * @property {string} [dstPrefix] - Destination prefix (default: 'b/')
 * @property {number} [context] - Number of context lines (default: 3)
 * @property {boolean} [ignoreAllSpace] - Ignore all whitespace changes
 * @property {boolean} [ignoreSpaceChange] - Ignore changes in whitespace amount
 */

/**
 * Result of formatting a complete diff.
 * @typedef {Object} FormatResult
 * @property {string} output - The formatted diff output
 * @property {number} filesChanged - Number of files with changes
 * @property {number} filesAdded - Number of files added
 * @property {number} filesDeleted - Number of files deleted
 */

/**
 * Format a binary file diff header.
 *
 * Binary files show only the header without content diff.
 * Matches git/npm diff behavior for binary files.
 *
 * @param {string} path - File path
 * @param {'modified' | 'added' | 'deleted'} status - Change type
 * @param {FormatOptions} [options] - Format options
 * @returns {string} Formatted binary file header
 *
 * @example
 * ```
 * diff --git a/image.png b/image.png
 * index 0000000..0000000 100644
 * Binary files a/image.png and b/image.png differ
 * ```
 */
export function formatBinaryHeader(path, status, options = {}) {
  const {
    srcPrefix = 'a/',
    dstPrefix = 'b/',
    noPrefix = false
  } = options;

  const srcPfx = noPrefix ? '' : srcPrefix;
  const dstPfx = noPrefix ? '' : dstPrefix;

  const lines = [];

  // Git-style header
  lines.push(`diff --git ${srcPfx}${path} ${dstPfx}${path}`);

  switch (status) {
    case 'added':
      lines.push('new file mode 100644');
      lines.push('index 0000000..0000000');
      lines.push(`Binary files /dev/null and ${dstPfx}${path} differ`);
      break;

    case 'deleted':
      lines.push('deleted file mode 100644');
      lines.push('index 0000000..0000000');
      lines.push(`Binary files ${srcPfx}${path} and /dev/null differ`);
      break;

    case 'modified':
    default:
      lines.push('index 0000000..0000000 100644');
      lines.push(`Binary files ${srcPfx}${path} and ${dstPfx}${path} differ`);
      break;
  }

  return lines.join('\n') + '\n';
}

/**
 * Format a text file diff.
 *
 * Takes the raw jsdiff output and reformats it to match npm diff style.
 * jsdiff's createTwoFilesPatch already produces most of the correct format,
 * but we need to add the git-style "diff --git" header line.
 *
 * @param {string} path - File path
 * @param {string} patch - Raw patch from jsdiff
 * @param {'modified' | 'added' | 'deleted'} status - Change type
 * @param {FormatOptions} [options] - Format options
 * @returns {string} Formatted diff output
 */
export function formatTextDiff(path, patch, status, options = {}) {
  const {
    srcPrefix = 'a/',
    dstPrefix = 'b/',
    noPrefix = false
  } = options;

  const srcPfx = noPrefix ? '' : srcPrefix;
  const dstPfx = noPrefix ? '' : dstPrefix;

  const lines = [];

  // Git-style header
  lines.push(`diff --git ${srcPfx}${path} ${dstPfx}${path}`);

  // File mode and index lines based on status
  switch (status) {
    case 'added':
      lines.push('new file mode 100644');
      lines.push('index 0000000..0000000');
      break;
    case 'deleted':
      lines.push('deleted file mode 100644');
      lines.push('index 0000000..0000000');
      break;
    default:
      // Modified files include file mode in index line
      lines.push('index 0000000..0000000 100644');
      break;
  }

  // The patch from jsdiff already includes --- and +++ lines
  // We just need to append it
  lines.push(patch.trim());

  return lines.join('\n') + '\n';
}

/**
 * Format output for name-only mode.
 *
 * Lists only file names that have changes, one per line.
 * Matches --diff-name-only behavior.
 *
 * @param {string[]} paths - Array of changed file paths
 * @returns {string} Newline-separated list of paths
 */
export function formatNameOnly(paths) {
  if (paths.length === 0) {
    return '';
  }
  return paths.join('\n') + '\n';
}

/**
 * Format a complete diff between two file trees.
 *
 * This is the main formatting function that processes all files
 * and produces the complete unified diff output.
 *
 * @param {Map<string, Uint8Array>} leftTree - Old file tree
 * @param {Map<string, Uint8Array>} rightTree - New file tree
 * @param {FormatOptions} [options] - Format options
 * @returns {FormatResult} Formatted diff with statistics
 *
 * @example
 * ```js
 * const leftFiles = await extractTarball(leftStream);
 * const rightFiles = await extractTarball(rightStream);
 *
 * const { output, filesChanged } = formatDiff(leftFiles, rightFiles, {
 *   context: 3
 * });
 *
 * console.log(output);
 * console.log(`${filesChanged} files changed`);
 * ```
 */
export function formatDiff(leftTree, rightTree, options = {}) {
  const { nameOnly = false, text = false } = options;

  // Collect all unique paths
  const allPaths = new Set([...leftTree.keys(), ...rightTree.keys()]);

  // Sort paths for consistent output
  const sortedPaths = [...allPaths].sort();

  /** @type {string[]} */
  const outputParts = [];

  /** @type {string[]} */
  const changedPaths = [];

  let filesAdded = 0;
  let filesDeleted = 0;

  for (const path of sortedPaths) {
    const left = leftTree.get(path);
    const right = rightTree.get(path);

    // Determine change status
    /** @type {'modified' | 'added' | 'deleted' | 'unchanged'} */
    let status;

    if (left && right) {
      status = 'modified';
    } else if (right) {
      status = 'added';
      filesAdded++;
    } else if (left) {
      status = 'deleted';
      filesDeleted++;
    } else {
      continue; // Should never happen
    }

    // Check if binary
    const isBinary = !shouldPrintPatch(path, { text });

    // For modified files, check if they're actually different
    if (status === 'modified' && left && right) {
      // Quick check: same length and content?
      if (left.length === right.length) {
        let identical = true;
        for (let i = 0; i < left.length; i++) {
          if (left[i] !== right[i]) {
            identical = false;
            break;
          }
        }
        if (identical) {
          continue; // Skip unchanged files
        }
      }
    }

    // Track changed path
    changedPaths.push(path);

    // Name-only mode: just collect paths
    if (nameOnly) {
      continue;
    }

    // Binary files: header only
    if (isBinary) {
      outputParts.push(formatBinaryHeader(path, status, options));
      continue;
    }

    // Text files: compute and format diff
    const fileDiff = computeFileDiff(path, left, right, options);

    if (fileDiff.patch && hasChanges(fileDiff.patch)) {
      outputParts.push(formatTextDiff(path, fileDiff.patch, status, options));
    } else if (status === 'added' || status === 'deleted') {
      // For empty added/deleted files, still show header
      const emptyPatch = computeFileDiff(
        path,
        status === 'deleted' ? left : undefined,
        status === 'added' ? right : undefined,
        options
      );
      if (emptyPatch.patch) {
        outputParts.push(formatTextDiff(path, emptyPatch.patch, status, options));
      }
    }
  }

  // Build final output
  let output;
  if (nameOnly) {
    output = formatNameOnly(changedPaths);
  } else {
    output = outputParts.join('\n');
  }

  return {
    output,
    filesChanged: changedPaths.length,
    filesAdded,
    filesDeleted
  };
}

/**
 * Format a single file's diff.
 *
 * Useful for streaming output or processing files individually.
 *
 * @param {string} path - File path
 * @param {Uint8Array | undefined} left - Old content (undefined if added)
 * @param {Uint8Array | undefined} right - New content (undefined if deleted)
 * @param {FormatOptions} [options] - Format options
 * @returns {string | null} Formatted diff, or null if unchanged
 */
export function formatFileDiff(path, left, right, options = {}) {
  const { text = false } = options;

  // Determine status
  /** @type {'modified' | 'added' | 'deleted'} */
  let status;

  if (left && right) {
    // Check if identical
    if (left.length === right.length) {
      let identical = true;
      for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
          identical = false;
          break;
        }
      }
      if (identical) {
        return null;
      }
    }
    status = 'modified';
  } else if (right) {
    status = 'added';
  } else if (left) {
    status = 'deleted';
  } else {
    return null;
  }

  // Binary check
  const isBinary = !shouldPrintPatch(path, { text });

  if (isBinary) {
    return formatBinaryHeader(path, status, options);
  }

  // Compute diff
  const fileDiff = computeFileDiff(path, left, right, options);

  if (!fileDiff.patch || !hasChanges(fileDiff.patch)) {
    // For added/deleted, we should still have a patch
    if (status === 'added' || status === 'deleted') {
      return formatTextDiff(path, fileDiff.patch || '', status, options);
    }
    return null;
  }

  return formatTextDiff(path, fileDiff.patch, status, options);
}
