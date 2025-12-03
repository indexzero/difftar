/**
 * Tests for src/format.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatBinaryHeader,
  formatTextDiff,
  formatNameOnly,
  formatDiff,
  formatFileDiff
} from '../src/format.js';

describe('format module', () => {
  describe('formatBinaryHeader', () => {
    it('should format modified binary file', () => {
      const header = formatBinaryHeader('image.png', 'modified');

      assert.ok(header.includes('diff --git a/image.png b/image.png'));
      assert.ok(header.includes('Binary files a/image.png and b/image.png differ'));
    });

    it('should format added binary file', () => {
      const header = formatBinaryHeader('image.png', 'added');

      assert.ok(header.includes('diff --git a/image.png b/image.png'));
      assert.ok(header.includes('new file mode 100644'));
      assert.ok(header.includes('Binary files /dev/null and b/image.png differ'));
    });

    it('should format deleted binary file', () => {
      const header = formatBinaryHeader('image.png', 'deleted');

      assert.ok(header.includes('diff --git a/image.png b/image.png'));
      assert.ok(header.includes('deleted file mode 100644'));
      assert.ok(header.includes('Binary files a/image.png and /dev/null differ'));
    });

    it('should respect noPrefix option', () => {
      const header = formatBinaryHeader('image.png', 'modified', { noPrefix: true });

      assert.ok(header.includes('diff --git image.png image.png'));
      assert.ok(header.includes('Binary files image.png and image.png differ'));
    });

    it('should respect custom prefixes', () => {
      const header = formatBinaryHeader('image.png', 'modified', {
        srcPrefix: 'old/',
        dstPrefix: 'new/'
      });

      assert.ok(header.includes('diff --git old/image.png new/image.png'));
      assert.ok(header.includes('Binary files old/image.png and new/image.png differ'));
    });
  });

  describe('formatTextDiff', () => {
    it('should format modified file diff', () => {
      const patch = `--- a/file.js
+++ b/file.js
@@ -1 +1 @@
-old
+new`;

      const formatted = formatTextDiff('file.js', patch, 'modified');

      assert.ok(formatted.includes('diff --git a/file.js b/file.js'));
      assert.ok(formatted.includes('--- a/file.js'));
      assert.ok(formatted.includes('+++ b/file.js'));
    });

    it('should add new file mode for added files', () => {
      const patch = `--- /dev/null
+++ b/file.js
@@ -0,0 +1 @@
+new content`;

      const formatted = formatTextDiff('file.js', patch, 'added');

      assert.ok(formatted.includes('new file mode 100644'));
    });

    it('should add deleted file mode for deleted files', () => {
      const patch = `--- a/file.js
+++ /dev/null
@@ -1 +0,0 @@
-old content`;

      const formatted = formatTextDiff('file.js', patch, 'deleted');

      assert.ok(formatted.includes('deleted file mode 100644'));
    });
  });

  describe('formatNameOnly', () => {
    it('should format list of paths', () => {
      const paths = ['file1.js', 'file2.js', 'dir/file3.js'];
      const result = formatNameOnly(paths);

      assert.strictEqual(result, 'file1.js\nfile2.js\ndir/file3.js\n');
    });

    it('should return empty string for empty list', () => {
      const result = formatNameOnly([]);
      assert.strictEqual(result, '');
    });

    it('should handle single path', () => {
      const result = formatNameOnly(['only.js']);
      assert.strictEqual(result, 'only.js\n');
    });
  });

  describe('formatDiff', () => {
    it('should format complete diff between trees', () => {
      const left = new Map([
        ['modified.js', new TextEncoder().encode('old content')],
        ['deleted.js', new TextEncoder().encode('deleted content')]
      ]);
      const right = new Map([
        ['modified.js', new TextEncoder().encode('new content')],
        ['added.js', new TextEncoder().encode('added content')]
      ]);

      const result = formatDiff(left, right);

      assert.ok(result.output.length > 0);
      assert.strictEqual(result.filesChanged, 3);
      assert.strictEqual(result.filesAdded, 1);
      assert.strictEqual(result.filesDeleted, 1);
    });

    it('should return empty output for identical trees', () => {
      const content = new TextEncoder().encode('same');
      const left = new Map([['file.js', content]]);
      const right = new Map([['file.js', new TextEncoder().encode('same')]]);

      const result = formatDiff(left, right);

      assert.strictEqual(result.filesChanged, 0);
      assert.strictEqual(result.output, '');
    });

    it('should format binary files as headers only', () => {
      const left = new Map([
        ['image.png', new Uint8Array([0x89, 0x50, 0x4E, 0x47])]
      ]);
      const right = new Map([
        ['image.png', new Uint8Array([0x89, 0x50, 0x4E, 0x48])]
      ]);

      const result = formatDiff(left, right);

      assert.ok(result.output.includes('Binary files'));
      assert.ok(!result.output.includes('@@ ')); // No hunk headers
    });

    it('should respect nameOnly option', () => {
      const left = new Map([
        ['file1.js', new TextEncoder().encode('old1')],
        ['file2.js', new TextEncoder().encode('old2')]
      ]);
      const right = new Map([
        ['file1.js', new TextEncoder().encode('new1')],
        ['file2.js', new TextEncoder().encode('new2')]
      ]);

      const result = formatDiff(left, right, { nameOnly: true });

      assert.strictEqual(result.output, 'file1.js\nfile2.js\n');
    });

    it('should treat binary as text with text option', () => {
      const left = new Map([
        ['data.bin', new TextEncoder().encode('old binary')]
      ]);
      const right = new Map([
        ['data.bin', new TextEncoder().encode('new binary')]
      ]);

      const result = formatDiff(left, right, { text: true });

      // Should show actual diff, not binary header
      assert.ok(!result.output.includes('Binary files'));
      assert.ok(result.output.includes('-old binary'));
      assert.ok(result.output.includes('+new binary'));
    });

    it('should sort files alphabetically', () => {
      const left = new Map([
        ['z.js', new TextEncoder().encode('z')],
        ['a.js', new TextEncoder().encode('a')]
      ]);
      const right = new Map([
        ['z.js', new TextEncoder().encode('z2')],
        ['a.js', new TextEncoder().encode('a2')]
      ]);

      const result = formatDiff(left, right);

      const aIndex = result.output.indexOf('a.js');
      const zIndex = result.output.indexOf('z.js');
      assert.ok(aIndex < zIndex);
    });
  });

  describe('formatFileDiff', () => {
    it('should format modified file', () => {
      const left = new TextEncoder().encode('old');
      const right = new TextEncoder().encode('new');

      const result = formatFileDiff('file.js', left, right);

      assert.ok(result.includes('diff --git'));
      assert.ok(result.includes('-old'));
      assert.ok(result.includes('+new'));
    });

    it('should format added file', () => {
      const right = new TextEncoder().encode('new');

      const result = formatFileDiff('file.js', undefined, right);

      assert.ok(result.includes('new file mode 100644'));
      assert.ok(result.includes('+new'));
    });

    it('should format deleted file', () => {
      const left = new TextEncoder().encode('old');

      const result = formatFileDiff('file.js', left, undefined);

      assert.ok(result.includes('deleted file mode 100644'));
      assert.ok(result.includes('-old'));
    });

    it('should return null for unchanged file', () => {
      const content = new TextEncoder().encode('same');

      const result = formatFileDiff('file.js', content, content);

      assert.strictEqual(result, null);
    });

    it('should format binary file as header', () => {
      const left = new Uint8Array([0x89, 0x50]);
      const right = new Uint8Array([0x89, 0x51]);

      const result = formatFileDiff('image.png', left, right);

      assert.ok(result.includes('Binary files'));
    });

    it('should return null when both undefined', () => {
      const result = formatFileDiff('file.js', undefined, undefined);
      assert.strictEqual(result, null);
    });
  });
});
