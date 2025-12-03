/**
 * Tests for src/diff.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  decodeBytes,
  normalizeLineEndings,
  areIdentical,
  computeDiff,
  hasChanges,
  computeTreeDiff,
  computeFileDiff
} from '../src/diff.js';

describe('diff module', () => {
  describe('decodeBytes', () => {
    it('should decode UTF-8 bytes to string', () => {
      const bytes = new TextEncoder().encode('hello world');
      const result = decodeBytes(bytes);
      assert.strictEqual(result, 'hello world');
    });

    it('should handle empty bytes', () => {
      const bytes = new Uint8Array(0);
      const result = decodeBytes(bytes);
      assert.strictEqual(result, '');
    });

    it('should handle unicode characters', () => {
      const bytes = new TextEncoder().encode('hello 世界 🌍');
      const result = decodeBytes(bytes);
      assert.strictEqual(result, 'hello 世界 🌍');
    });

    it('should handle malformed UTF-8 gracefully', () => {
      // Invalid UTF-8 sequence
      const bytes = new Uint8Array([0xFF, 0xFE, 0x00, 0x01]);
      // Should not throw, uses replacement character
      const result = decodeBytes(bytes);
      assert.ok(typeof result === 'string');
    });
  });

  describe('normalizeLineEndings', () => {
    it('should convert CRLF to LF', () => {
      const input = 'line1\r\nline2\r\nline3';
      const result = normalizeLineEndings(input);
      assert.strictEqual(result, 'line1\nline2\nline3');
    });

    it('should convert CR to LF', () => {
      const input = 'line1\rline2\rline3';
      const result = normalizeLineEndings(input);
      assert.strictEqual(result, 'line1\nline2\nline3');
    });

    it('should leave LF unchanged', () => {
      const input = 'line1\nline2\nline3';
      const result = normalizeLineEndings(input);
      assert.strictEqual(result, 'line1\nline2\nline3');
    });

    it('should handle mixed line endings', () => {
      const input = 'line1\r\nline2\rline3\nline4';
      const result = normalizeLineEndings(input);
      assert.strictEqual(result, 'line1\nline2\nline3\nline4');
    });

    it('should handle empty string', () => {
      const result = normalizeLineEndings('');
      assert.strictEqual(result, '');
    });
  });

  describe('areIdentical', () => {
    it('should return true for identical arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      assert.strictEqual(areIdentical(a, b), true);
    });

    it('should return false for different lengths', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3, 4]);
      assert.strictEqual(areIdentical(a, b), false);
    });

    it('should return false for different content', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 4]);
      assert.strictEqual(areIdentical(a, b), false);
    });

    it('should return true for empty arrays', () => {
      const a = new Uint8Array(0);
      const b = new Uint8Array(0);
      assert.strictEqual(areIdentical(a, b), true);
    });
  });

  describe('computeDiff', () => {
    it('should compute diff between two strings', () => {
      const patch = computeDiff(
        'a/file.js',
        'b/file.js',
        'const x = 1;',
        'const x = 2;',
        { context: 3 }
      );

      assert.ok(patch.includes('--- a/file.js'));
      assert.ok(patch.includes('+++ b/file.js'));
      assert.ok(patch.includes('-const x = 1;'));
      assert.ok(patch.includes('+const x = 2;'));
    });

    it('should produce no hunks for identical content', () => {
      const patch = computeDiff(
        'a/file.js',
        'b/file.js',
        'const x = 1;',
        'const x = 1;',
        { context: 3 }
      );

      assert.strictEqual(hasChanges(patch), false);
    });

    it('should handle empty files', () => {
      const patch = computeDiff(
        'a/file.js',
        'b/file.js',
        '',
        'new content',
        { context: 3 }
      );

      assert.ok(patch.includes('+new content'));
    });

    it('should respect context option', () => {
      const content1 = 'line1\nline2\nline3\nline4\nchanged\nline6\nline7\nline8\nline9';
      const content2 = 'line1\nline2\nline3\nline4\nmodified\nline6\nline7\nline8\nline9';

      const patchContext1 = computeDiff('a/f', 'b/f', content1, content2, { context: 1 });
      const patchContext3 = computeDiff('a/f', 'b/f', content1, content2, { context: 3 });

      // Context 3 should show more surrounding lines
      assert.ok(patchContext3.length >= patchContext1.length);
    });
  });

  describe('hasChanges', () => {
    it('should return true for patch with hunks', () => {
      const patch = `--- a/file.js
+++ b/file.js
@@ -1 +1 @@
-old
+new`;
      assert.strictEqual(hasChanges(patch), true);
    });

    it('should return false for patch without hunks', () => {
      const patch = `--- a/file.js
+++ b/file.js`;
      assert.strictEqual(hasChanges(patch), false);
    });

    it('should return false for empty patch', () => {
      assert.strictEqual(hasChanges(''), false);
    });
  });

  describe('computeTreeDiff', () => {
    it('should compute diffs for modified files', () => {
      const left = new Map([
        ['file.js', new TextEncoder().encode('const x = 1;')]
      ]);
      const right = new Map([
        ['file.js', new TextEncoder().encode('const x = 2;')]
      ]);

      const diffs = computeTreeDiff(left, right);

      assert.strictEqual(diffs.length, 1);
      assert.strictEqual(diffs[0].path, 'file.js');
      assert.strictEqual(diffs[0].status, 'modified');
      assert.ok(diffs[0].patch);
    });

    it('should detect added files', () => {
      const left = new Map();
      const right = new Map([
        ['new.js', new TextEncoder().encode('content')]
      ]);

      const diffs = computeTreeDiff(left, right);

      assert.strictEqual(diffs.length, 1);
      assert.strictEqual(diffs[0].path, 'new.js');
      assert.strictEqual(diffs[0].status, 'added');
    });

    it('should detect deleted files', () => {
      const left = new Map([
        ['old.js', new TextEncoder().encode('content')]
      ]);
      const right = new Map();

      const diffs = computeTreeDiff(left, right);

      assert.strictEqual(diffs.length, 1);
      assert.strictEqual(diffs[0].path, 'old.js');
      assert.strictEqual(diffs[0].status, 'deleted');
    });

    it('should detect unchanged files', () => {
      const content = new TextEncoder().encode('same');
      const left = new Map([['same.js', content]]);
      const right = new Map([['same.js', new TextEncoder().encode('same')]]);

      const diffs = computeTreeDiff(left, right);

      assert.strictEqual(diffs.length, 1);
      assert.strictEqual(diffs[0].status, 'unchanged');
      assert.strictEqual(diffs[0].patch, null);
    });

    it('should sort paths alphabetically', () => {
      const left = new Map([
        ['z.js', new TextEncoder().encode('z')],
        ['a.js', new TextEncoder().encode('a')]
      ]);
      const right = new Map([
        ['z.js', new TextEncoder().encode('z2')],
        ['a.js', new TextEncoder().encode('a2')]
      ]);

      const diffs = computeTreeDiff(left, right);

      assert.strictEqual(diffs[0].path, 'a.js');
      assert.strictEqual(diffs[1].path, 'z.js');
    });

    it('should respect noPrefix option', () => {
      const left = new Map([
        ['file.js', new TextEncoder().encode('old')]
      ]);
      const right = new Map([
        ['file.js', new TextEncoder().encode('new')]
      ]);

      const diffs = computeTreeDiff(left, right, { noPrefix: true });

      assert.ok(diffs[0].patch.includes('--- file.js'));
      assert.ok(diffs[0].patch.includes('+++ file.js'));
    });

    it('should respect custom prefixes', () => {
      const left = new Map([
        ['file.js', new TextEncoder().encode('old')]
      ]);
      const right = new Map([
        ['file.js', new TextEncoder().encode('new')]
      ]);

      const diffs = computeTreeDiff(left, right, {
        srcPrefix: 'old/',
        dstPrefix: 'new/'
      });

      assert.ok(diffs[0].patch.includes('--- old/file.js'));
      assert.ok(diffs[0].patch.includes('+++ new/file.js'));
    });
  });

  describe('computeFileDiff', () => {
    it('should compute diff for modified file', () => {
      const left = new TextEncoder().encode('old');
      const right = new TextEncoder().encode('new');

      const diff = computeFileDiff('file.js', left, right);

      assert.strictEqual(diff.status, 'modified');
      assert.ok(diff.patch);
    });

    it('should compute diff for added file', () => {
      const right = new TextEncoder().encode('new');

      const diff = computeFileDiff('file.js', undefined, right);

      assert.strictEqual(diff.status, 'added');
      assert.ok(diff.patch.includes('/dev/null'));
    });

    it('should compute diff for deleted file', () => {
      const left = new TextEncoder().encode('old');

      const diff = computeFileDiff('file.js', left, undefined);

      assert.strictEqual(diff.status, 'deleted');
      assert.ok(diff.patch.includes('/dev/null'));
    });

    it('should return unchanged for identical content', () => {
      const content = new TextEncoder().encode('same');

      const diff = computeFileDiff('file.js', content, content);

      assert.strictEqual(diff.status, 'unchanged');
      assert.strictEqual(diff.patch, null);
    });
  });
});
