/**
 * Tests for src/index.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { gzipSync } from 'node:zlib';
import { packTar } from 'modern-tar';
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

/**
 * Create a gzipped tar archive with the given entries.
 * @param {Array<{name: string, content: string | Uint8Array}>} entries
 * @returns {Promise<Uint8Array>}
 */
async function createTarGz(entries) {
  const tarEntries = entries.map(entry => {
    const body = typeof entry.content === 'string'
      ? new TextEncoder().encode(entry.content)
      : entry.content;

    return {
      header: {
        name: entry.name,
        type: 'file',
        size: body.length,
        mode: 0o644,
        mtime: new Date()
      },
      data: body
    };
  });

  const tarData = await packTar(tarEntries);
  return new Uint8Array(gzipSync(tarData));
}

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

    it('should reject s3 transport with missing credentials', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 's3',
          source: 's3://bucket/key.tgz',
          s3: {
            accessKeyId: '',
            secretAccessKey: 'secret'
          }
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.strictEqual(err.phase, 'AUTH');
          assert.ok(err.message.includes('accessKeyId'));
          return true;
        }
      );
    });

    it('should reject inline transport with invalid tarball data', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 'inline',
          data: new Uint8Array([1, 2, 3])
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          // Invalid data fails at TAR parsing phase
          assert.strictEqual(err.phase, 'TAR');
          return true;
        }
      );
    });

    it('should reject file transport with non-existent file', async () => {
      await assert.rejects(
        () => extractPackage({
          transport: 'file',
          source: '/nonexistent/path/to/file.tgz'
        }),
        (err) => {
          assert.ok(err instanceof DiffError);
          assert.strictEqual(err.phase, 'FETCH');
          assert.ok(err.message.includes('File not found'));
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

describe('Integration: diff with inline transport', () => {
  it('should produce diff output for modified files', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/index.js', content: 'const x = 1;' },
      { name: 'package/package.json', content: '{"version":"1.0.0"}' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/index.js', content: 'const x = 2;' },
      { name: 'package/package.json', content: '{"version":"2.0.0"}' }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz }
    );

    assert.ok(output.includes('diff --git'));
    assert.ok(output.includes('-const x = 1;'));
    assert.ok(output.includes('+const x = 2;'));
    assert.ok(output.includes('-{"version":"1.0.0"}'));
    assert.ok(output.includes('+{"version":"2.0.0"}'));
  });

  it('should respect nameOnly option', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/index.js', content: 'const x = 1;' },
      { name: 'package/unchanged.js', content: 'same content' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/index.js', content: 'const x = 2;' },
      { name: 'package/unchanged.js', content: 'same content' }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { nameOnly: true }
    );

    assert.strictEqual(output, 'index.js\n');
    assert.ok(!output.includes('diff --git'));
    assert.ok(!output.includes('unchanged.js'));
  });

  it('should respect noPrefix option', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/index.js', content: 'old' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/index.js', content: 'new' }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { noPrefix: true }
    );

    assert.ok(output.includes('diff --git index.js index.js'));
    assert.ok(output.includes('--- index.js'));
    assert.ok(output.includes('+++ index.js'));
  });

  it('should respect srcPrefix and dstPrefix options', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/index.js', content: 'old' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/index.js', content: 'new' }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { srcPrefix: 'pkg@1.0.0/', dstPrefix: 'pkg@2.0.0/' }
    );

    assert.ok(output.includes('diff --git pkg@1.0.0/index.js pkg@2.0.0/index.js'));
    assert.ok(output.includes('--- pkg@1.0.0/index.js'));
    assert.ok(output.includes('+++ pkg@2.0.0/index.js'));
  });

  it('should respect context option', async () => {
    const content1 = 'line1\nline2\nline3\nline4\nchanged\nline6\nline7\nline8\nline9';
    const content2 = 'line1\nline2\nline3\nline4\nmodified\nline6\nline7\nline8\nline9';

    const leftTarGz = await createTarGz([
      { name: 'package/file.js', content: content1 }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/file.js', content: content2 }
    ]);

    const outputContext1 = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { context: 1 }
    );

    const outputContext3 = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { context: 3 }
    );

    // Context 3 should show more lines
    assert.ok(outputContext3.length >= outputContext1.length);
  });

  it('should handle added and deleted files', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/deleted.js', content: 'will be deleted' },
      { name: 'package/unchanged.js', content: 'same' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/added.js', content: 'newly added' },
      { name: 'package/unchanged.js', content: 'same' }
    ]);

    const result = await diffWithStats(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz }
    );

    assert.strictEqual(result.filesAdded, 1);
    assert.strictEqual(result.filesDeleted, 1);
    assert.ok(result.output.includes('new file mode 100644'));
    assert.ok(result.output.includes('deleted file mode 100644'));
  });

  it('should handle binary files', async () => {
    // Create a "binary" file (extension-based detection)
    const leftTarGz = await createTarGz([
      { name: 'package/image.png', content: new Uint8Array([0x89, 0x50, 0x4E, 0x47]) }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/image.png', content: new Uint8Array([0x89, 0x50, 0x4E, 0x48]) }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz }
    );

    assert.ok(output.includes('Binary files'));
    assert.ok(output.includes('image.png'));
    assert.ok(!output.includes('@@ ')); // No hunk headers for binary
  });

  it('should treat binary as text with text option', async () => {
    const leftTarGz = await createTarGz([
      { name: 'package/data.bin', content: 'old binary data' }
    ]);

    const rightTarGz = await createTarGz([
      { name: 'package/data.bin', content: 'new binary data' }
    ]);

    const output = await diff(
      { transport: 'inline', data: leftTarGz },
      { transport: 'inline', data: rightTarGz },
      { text: true }
    );

    assert.ok(!output.includes('Binary files'));
    assert.ok(output.includes('-old binary data'));
    assert.ok(output.includes('+new binary data'));
  });

  it('should return empty output for identical packages', async () => {
    const tarGz = await createTarGz([
      { name: 'package/index.js', content: 'const x = 1;' },
      { name: 'package/package.json', content: '{"name":"test"}' }
    ]);

    const output = await diff(
      { transport: 'inline', data: tarGz },
      { transport: 'inline', data: tarGz }
    );

    assert.strictEqual(output, '');
  });
});

describe('Integration: diff with URL transport', () => {
  it('should diff two real npm packages from registry', async () => {
    // This test fetches real tarballs from npm registry
    // Using small, stable packages to minimize network impact
    const output = await diff(
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' },
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' }
    );

    // Same version should produce no diff
    assert.strictEqual(output, '');
  });

  it('should produce diff between different versions', async () => {
    const result = await diffWithStats(
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz' },
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' }
    );

    // Should have some changes between versions
    assert.ok(result.filesChanged > 0);
    assert.ok(result.output.includes('diff --git'));
    // Version change should be visible in package.json
    assert.ok(result.output.includes('package.json'));
  });

  it('should work with the documented example pattern', async () => {
    // This matches the JSDoc example in index.js
    const patch = await diff(
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' },
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' },
      { context: 3 }
    );

    assert.strictEqual(typeof patch, 'string');
  });
});

describe('Integration: output matches npm diff', () => {
  it('should produce output matching npm diff format', async () => {
    // Compare our output with actual npm diff output
    // Using is-number 6.0.0 vs 7.0.0 as a stable test case
    const { execSync } = await import('node:child_process');

    // Get npm diff output
    let npmDiffOutput;
    try {
      npmDiffOutput = execSync(
        'npm diff --diff=is-number@6.0.0 --diff=is-number@7.0.0',
        { encoding: 'utf-8', timeout: 60000 }
      );
    } catch (error) {
      // npm diff may exit with code 1 if there are differences
      npmDiffOutput = error.stdout || '';
    }

    // Get our output
    const ourOutput = await diff(
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz' },
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' }
    );

    // Both outputs should have the same structure
    // Note: We can't do exact comparison because:
    // 1. npm diff includes commit hashes in index lines
    // 2. Timestamps may differ
    // But we can verify structural equivalence

    // Same files should be mentioned
    const npmFiles = npmDiffOutput.match(/diff --git a\/(\S+)/g) || [];
    const ourFiles = ourOutput.match(/diff --git a\/(\S+)/g) || [];
    assert.deepStrictEqual(ourFiles.sort(), npmFiles.sort(), 'Same files should be diffed');

    // Same number of hunks
    const npmHunks = (npmDiffOutput.match(/^@@/gm) || []).length;
    const ourHunks = (ourOutput.match(/^@@/gm) || []).length;
    assert.strictEqual(ourHunks, npmHunks, 'Same number of hunks');

    // Both should have the key version change
    assert.ok(npmDiffOutput.includes('"version": "6.0.0"') || npmDiffOutput.includes('"version":"6.0.0"'));
    assert.ok(ourOutput.includes('"version": "6.0.0"') || ourOutput.includes('"version":"6.0.0"'));
  });

  it('should match npm diff --diff-name-only output', async () => {
    const { execSync } = await import('node:child_process');

    // Get npm diff --diff-name-only output
    let npmOutput;
    try {
      npmOutput = execSync(
        'npm diff --diff=is-number@6.0.0 --diff=is-number@7.0.0 --diff-name-only',
        { encoding: 'utf-8', timeout: 60000 }
      );
    } catch (error) {
      npmOutput = error.stdout || '';
    }

    // Get our output
    const ourOutput = await diff(
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz' },
      { transport: 'url', source: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' },
      { nameOnly: true }
    );

    // Parse file lists (npm diff may have different path format)
    const npmFiles = npmOutput.trim().split('\n').filter(Boolean).sort();
    const ourFiles = ourOutput.trim().split('\n').filter(Boolean).sort();

    // Should list the same files
    assert.deepStrictEqual(ourFiles, npmFiles, 'Same files should be listed');
  });
});
