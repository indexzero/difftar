/**
 * Binary file detection for npm-diff-worker.
 *
 * Uses extension-based detection to match npm diff behavior.
 * The binary-extensions package provides a comprehensive list of
 * known binary file extensions (341 extensions as of v3.0.0).
 *
 * Binary files are handled differently in diffs:
 * - Header is shown but content is not diffed
 * - This matches git and npm diff behavior
 * - The --diff-text option can override to force text treatment
 *
 * @module binary
 */

import binaryExtensions from 'binary-extensions';

/**
 * Set of binary extensions for O(1) lookup.
 * Extensions are stored without the leading dot.
 * @type {Set<string>}
 */
const BINARY_EXTENSIONS_SET = new Set(binaryExtensions);

/**
 * Additional npm-specific binary extensions not in binary-extensions v3.
 * These are common in npm packages but missing from the standard list.
 * @type {Set<string>}
 */
const NPM_BINARY_EXTENSIONS = new Set(['wasm', 'node']);

/**
 * Extract the extension from a file path.
 *
 * Returns the extension without the leading dot, lowercased.
 * Returns empty string for files without extensions.
 *
 * @param {string} path - File path
 * @returns {string} Extension without dot, lowercased
 *
 * @example
 * ```js
 * getExtension('image.PNG') // 'png'
 * getExtension('lib/index.js') // 'js'
 * getExtension('Makefile') // ''
 * getExtension('.gitignore') // 'gitignore'
 * getExtension('file.tar.gz') // 'gz'
 * ```
 */
function getExtension(path) {
  // Find the last component (filename)
  const lastSlash = path.lastIndexOf('/');
  const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);

  // Find the extension (last dot in filename)
  const lastDot = filename.lastIndexOf('.');

  // No extension if no dot, or dot is first character (dotfile)
  // But .gitignore should return 'gitignore', so we check if dot is at position 0
  // and there's more content after it
  if (lastDot === -1) {
    return '';
  }

  // Handle dotfiles like .gitignore -> 'gitignore'
  // But also handle normal files like file.js -> 'js'
  if (lastDot === 0) {
    return filename.slice(1).toLowerCase();
  }

  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Check if a file path has a binary extension.
 *
 * Uses the binary-extensions package to check if the file extension
 * is in the list of known binary extensions.
 *
 * @param {string} path - File path to check
 * @returns {boolean} True if the extension indicates a binary file
 *
 * @example
 * ```js
 * isBinaryPath('image.png')     // true
 * isBinaryPath('lib/index.js')  // false
 * isBinaryPath('photo.PNG')     // true (case-insensitive)
 * isBinaryPath('data.wasm')     // true
 * isBinaryPath('package.json')  // false
 * ```
 */
export function isBinaryPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }

  const ext = getExtension(path);

  // No extension = not binary (by extension check)
  if (!ext) {
    return false;
  }

  // Check both standard binary extensions and npm-specific ones
  return BINARY_EXTENSIONS_SET.has(ext) || NPM_BINARY_EXTENSIONS.has(ext);
}

/**
 * Diff options that affect binary handling.
 * @typedef {Object} DiffOptions
 * @property {boolean} [text] - Treat all files as text (--diff-text)
 * @property {boolean} [nameOnly] - Only show file names, not content
 */

/**
 * Determine if we should print the patch content for a file.
 *
 * Returns true if:
 * 1. The file is not binary (by extension), OR
 * 2. The `text` option is set to force text treatment
 *
 * Used to decide whether to compute and output the actual diff
 * content, or just show the file header.
 *
 * @param {string} path - File path to check
 * @param {DiffOptions} [opts] - Diff options
 * @returns {boolean} True if we should compute and print the diff
 *
 * @example
 * ```js
 * // Normal behavior
 * shouldPrintPatch('index.js')                  // true
 * shouldPrintPatch('image.png')                 // false
 *
 * // With --diff-text option
 * shouldPrintPatch('image.png', { text: true }) // true
 *
 * // Force binary treatment
 * shouldPrintPatch('data.bin')                  // false
 * shouldPrintPatch('data.bin', { text: true })  // true
 * ```
 *
 * @example
 * ```js
 * // Usage in diff pipeline
 * for (const [path, content] of files) {
 *   if (shouldPrintPatch(path, options)) {
 *     const patch = computeDiff(oldContent, newContent);
 *     output += formatPatch(path, patch);
 *   } else {
 *     output += formatBinaryHeader(path);
 *   }
 * }
 * ```
 */
export function shouldPrintPatch(path, opts = {}) {
  // --diff-text forces text treatment for all files
  if (opts.text) {
    return true;
  }

  // Check if file has binary extension
  return !isBinaryPath(path);
}

/**
 * Get the list of all known binary extensions.
 *
 * Returns a copy of the binary extensions array for inspection
 * or custom filtering. Extensions are returned without leading dots.
 *
 * @returns {string[]} Array of binary extensions (e.g., ['png', 'jpg', ...])
 *
 * @example
 * ```js
 * const extensions = getBinaryExtensions();
 * console.log(extensions.length); // 341 (as of v3.0.0)
 * console.log(extensions.includes('png')); // true
 * ```
 */
export function getBinaryExtensions() {
  return [...binaryExtensions];
}

/**
 * Check if a specific extension is considered binary.
 *
 * Useful for checking extensions directly without a full path.
 * Extension should be provided without the leading dot.
 *
 * @param {string} ext - Extension to check (without leading dot)
 * @returns {boolean} True if the extension is binary
 *
 * @example
 * ```js
 * isBinaryExtension('png')  // true
 * isBinaryExtension('js')   // false
 * isBinaryExtension('PNG')  // true (case-insensitive)
 * isBinaryExtension('.png') // false (don't include dot)
 * ```
 */
export function isBinaryExtension(ext) {
  if (typeof ext !== 'string' || ext.length === 0) {
    return false;
  }

  const lowerExt = ext.toLowerCase();
  return BINARY_EXTENSIONS_SET.has(lowerExt) || NPM_BINARY_EXTENSIONS.has(lowerExt);
}
