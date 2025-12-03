/**
 * Tests for src/index.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  diff,
  diffWithStats,
  extractPackage,
  DiffError,
  isDiffError,
  assertDiff,
  sanitizeCredentials,
  isBinaryPath,
  shouldPrintPatch,
  getBinaryExtensions,
  computeDiff,
  computeTreeDiff,
  computeFileDiff,
  decodeBytes,
  MAX_TARBALL_SIZE
} from '../src/index.js';

describe('index module', () => {
  describe('exports', () => {
    it('should export diff function', () => {
      assert.strictEqual(typeof diff, 'function');
    });

    it('should export diffWithStats function', () => {
      assert.strictEqual(typeof diffWithStats, 'function');
    });

    it('should export extractPackage function', () => {
      assert.strictEqual(typeof extractPackage, 'function');
    });

    it('should export error utilities', () => {
      assert.strictEqual(typeof DiffError, 'function');
      assert.strictEqual(typeof isDiffError, 'function');
      assert.strictEqual(typeof assertDiff, 'function');
      assert.strictEqual(typeof sanitizeCredentials, 'function');
    });

    it('should export binary utilities', () => {
      assert.strictEqual(typeof isBinaryPath, 'function');
      assert.strictEqual(typeof shouldPrintPatch, 'function');
      assert.strictEqual(typeof getBinaryExtensions, 'function');
    });

    it('should export diff utilities', () => {
      assert.strictEqual(typeof computeDiff, 'function');
      assert.strictEqual(typeof computeTreeDiff, 'function');
      assert.strictEqual(typeof computeFileDiff, 'function');
      assert.strictEqual(typeof decodeBytes, 'function');
    });

    it('should export MAX_TARBALL_SIZE constant', () => {
      assert.strictEqual(typeof MAX_TARBALL_SIZE, 'number');
      assert.strictEqual(MAX_TARBALL_SIZE, 20 * 1024 * 1024);
    });
  });

  describe('diff function validation', () => {
    it('should reject null left config', async () => {
      await assert.rejects(
        () => diff(null, { transport: 'url', source: 'http://example.com/a.tgz' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.strictEqual(err.phase, 'FETCH');
          return true;
        }
      );
    });

    it('should reject null right config', async () => {
      await assert.rejects(
        () => diff({ transport: 'url', source: 'http://example.com/a.tgz' }, null),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.strictEqual(err.phase, 'FETCH');
          return true;
        }
      );
    });

    it('should reject undefined left config', async () => {
      await assert.rejects(
        () => diff(undefined, { transport: 'url', source: 'http://example.com/a.tgz' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });

    it('should reject non-object left config', async () => {
      await assert.rejects(
        () => diff('not-an-object', { transport: 'url', source: 'http://example.com/a.tgz' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });
  });

  describe('diffWithStats function validation', () => {
    it('should reject null left config', async () => {
      await assert.rejects(
        () => diffWithStats(null, { transport: 'url', source: 'http://example.com/a.tgz' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });

    it('should reject null right config', async () => {
      await assert.rejects(
        () => diffWithStats({ transport: 'url', source: 'http://example.com/a.tgz' }, null),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });
  });

  describe('extractPackage function validation', () => {
    it('should reject null config', async () => {
      await assert.rejects(
        () => extractPackage(null),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });

    it('should reject missing transport', async () => {
      await assert.rejects(
        () => extractPackage({ source: 'http://example.com/a.tgz' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          return true;
        }
      );
    });

    it('should reject unknown transport', async () => {
      await assert.rejects(
        () => extractPackage({ transport: 'unknown', source: 'test' }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.ok(err.message.includes('Unknown transport'));
          return true;
        }
      );
    });

    it('should reject s3 transport (not yet implemented)', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 's3',
          source: 's3://bucket/key.tgz',
          s3: {
            accessKeyId: 'key',
            secretAccessKey: 'secret'
          }
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.ok(err.message.includes('not yet implemented'));
          return true;
        }
      );
    });

    it('should reject inline transport (not yet implemented)', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 'inline',
          data: new Uint8Array([1, 2, 3])
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.ok(err.message.includes('not yet implemented'));
          return true;
        }
      );
    });

    it('should reject file transport (not yet implemented)', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 'file',
          source: '/path/to/file.tgz'
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.ok(err.message.includes('not yet implemented'));
          return true;
        }
      );
    });
  });

  describe('re-exported utilities work correctly', () => {
    it('isBinaryPath should detect binary extensions', () => {
      assert.strictEqual(isBinaryPath('image.png'), true);
      assert.strictEqual(isBinaryPath('script.js'), false);
    });

    it('shouldPrintPatch should respect text option', () => {
      assert.strictEqual(shouldPrintPatch('image.png'), false);
      assert.strictEqual(shouldPrintPatch('image.png', { text: true }), true);
    });

    it('getBinaryExtensions should return array', () => {
      const exts = getBinaryExtensions();
      assert.ok(Array.isArray(exts));
      assert.ok(exts.length > 100);
      assert.ok(exts.includes('png'));
    });

    it('DiffError should work correctly', () => {
      const err = new DiffError('FETCH', 'test error');
      assert.strictEqual(err.phase, 'FETCH');
      assert.strictEqual(err.message, 'test error');
      assert.strictEqual(err.status, 502);
    });

    it('isDiffError should identify DiffErrors', () => {
      const diffErr = new DiffError('FETCH', 'test');
      const regErr = new Error('test');

      assert.strictEqual(isDiffError(diffErr), true);
      assert.strictEqual(isDiffError(regErr), false);
    });

    it('sanitizeCredentials should redact tokens', () => {
      const input = 'Authorization: Bearer secret123';
      const result = sanitizeCredentials(input);
      assert.ok(!result.includes('secret123'));
    });

    it('decodeBytes should decode UTF-8', () => {
      const bytes = new TextEncoder().encode('hello');
      assert.strictEqual(decodeBytes(bytes), 'hello');
    });

    it('computeDiff should create patch', () => {
      const patch = computeDiff('a/f', 'b/f', 'old', 'new');
      assert.ok(patch.includes('-old'));
      assert.ok(patch.includes('+new'));
    });
  });
});
