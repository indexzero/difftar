import { describe, it } from 'node:test';
import assert from 'node:assert';
import { packTar } from 'modern-tar';
import {
  extractTarball,
  extractTarballWithOptions
} from '../src/tar.js';
import { isDiffError } from '../src/errors.js';

/**
 * Create a ReadableStream from a Uint8Array
 * @param {Uint8Array} data
 * @returns {ReadableStream<Uint8Array>}
 */
function streamFromBytes(data) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    }
  });
}

/**
 * Create a tar archive with the given entries using modern-tar.
 * @param {Array<{name: string, content: string | Uint8Array, type?: string, linkname?: string}>} entries
 * @returns {Promise<Uint8Array>}
 */
async function createTar(entries) {
  const tarEntries = entries.map(entry => {
    const body = typeof entry.content === 'string'
      ? new TextEncoder().encode(entry.content)
      : entry.content;

    return {
      header: {
        name: entry.name,
        type: entry.type || 'file',
        size: body.length,
        mode: 0o644,
        mtime: new Date(),
        linkname: entry.linkname
      },
      data: body
    };
  });

  return packTar(tarEntries);
}

/**
 * Create a tar archive with a directory entry.
 * @param {string} dirName - Directory name (should end with /)
 * @returns {Promise<Uint8Array>}
 */
async function createTarWithDirectory(dirName) {
  const fileContent = 'console.log("hello");';
  return packTar([
    {
      header: {
        name: dirName,
        type: 'directory',
        mode: 0o755,
        mtime: new Date()
      }
    },
    {
      header: {
        name: `${dirName}index.js`,
        type: 'file',
        size: fileContent.length,
        mode: 0o644,
        mtime: new Date()
      },
      data: new TextEncoder().encode(fileContent)
    }
  ]);
}

describe('extractTarball', () => {
  it('extracts single file from tar', async () => {
    const tarData = await createTar([
      { name: 'package/index.js', content: 'export const x = 1;' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('index.js'));

    const content = new TextDecoder().decode(files.get('index.js'));
    assert.strictEqual(content, 'export const x = 1;');
  });

  it('extracts multiple files from tar', async () => {
    const tarData = await createTar([
      { name: 'package/index.js', content: 'export const x = 1;' },
      { name: 'package/lib/utils.js', content: 'export function add(a, b) { return a + b; }' },
      { name: 'package/package.json', content: '{"name": "test"}' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 3);
    assert.ok(files.has('index.js'));
    assert.ok(files.has('lib/utils.js'));
    assert.ok(files.has('package.json'));
  });

  it('strips package/ prefix from paths', async () => {
    const tarData = await createTar([
      { name: 'package/deep/nested/path/file.js', content: '// nested' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('deep/nested/path/file.js'));
    assert.ok(!files.has('package/deep/nested/path/file.js'));
  });

  it('handles files without package/ prefix', async () => {
    // Some tarballs might not have the package/ prefix
    const tarData = await createTar([
      { name: 'index.js', content: 'export default 1;' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('index.js'));
  });

  it('ignores directory entries', async () => {
    const tarData = await createTarWithDirectory('package/lib/');

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    // Should only have the file, not the directory
    assert.strictEqual(files.size, 1);
    assert.ok(files.has('lib/index.js'));
    assert.ok(!files.has('lib/'));
    assert.ok(!files.has('package/lib/'));
  });

  it('handles binary content correctly', async () => {
    const binaryContent = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const tarData = await createTar([
      { name: 'package/data.bin', content: binaryContent }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    const content = files.get('data.bin');
    assert.deepStrictEqual(content, binaryContent);
  });

  it('handles empty files', async () => {
    const tarData = await createTar([
      { name: 'package/empty.txt', content: '' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('empty.txt'));
    assert.strictEqual(files.get('empty.txt').length, 0);
  });

  it('handles large files', async () => {
    // 100KB file
    const largeContent = 'x'.repeat(100 * 1024);
    const tarData = await createTar([
      { name: 'package/large.txt', content: largeContent }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 1);
    const content = new TextDecoder().decode(files.get('large.txt'));
    assert.strictEqual(content.length, 100 * 1024);
  });

  it('throws TAR error for null input', async () => {
    await assert.rejects(
      extractTarball(null),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('throws TAR error for undefined input', async () => {
    await assert.rejects(
      extractTarball(undefined),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('throws TAR error for non-stream input', async () => {
    await assert.rejects(
      extractTarball({ not: 'a stream' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('handles empty/minimal tar data gracefully', async () => {
    // modern-tar is lenient with invalid/truncated data
    // and just returns an empty result for minimal data
    const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const stream = streamFromBytes(invalidData);

    // Should not throw, just return empty map
    const files = await extractTarball(stream);
    assert.strictEqual(files.size, 0);
  });

  it('handles files with special characters in names', async () => {
    const tarData = await createTar([
      { name: 'package/file with spaces.js', content: '// spaces' },
      { name: 'package/@scope/package.json', content: '{}' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 2);
    assert.ok(files.has('file with spaces.js'));
    assert.ok(files.has('@scope/package.json'));
  });

  it('preserves UTF-8 content', async () => {
    const utf8Content = 'Hello World';
    const tarData = await createTar([
      { name: 'package/unicode.txt', content: utf8Content }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    const content = new TextDecoder().decode(files.get('unicode.txt'));
    assert.strictEqual(content, utf8Content);
  });
});

describe('extractTarball symlink handling', () => {
  it('throws TAR error for symlinks', async () => {
    // Create tar with a symlink entry
    const tarData = await packTar([
      {
        header: {
          name: 'package/link.js',
          type: 'symlink',
          linkname: 'index.js',
          mode: 0o777,
          mtime: new Date()
        }
      }
    ]);

    const stream = streamFromBytes(tarData);

    await assert.rejects(
      extractTarball(stream),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('Symlinks are not supported') &&
          err.message.includes('link.js');
      }
    );
  });

  it('throws TAR error for hard links', async () => {
    const tarData = await packTar([
      {
        header: {
          name: 'package/hardlink.js',
          type: 'link',
          linkname: 'package/index.js',
          mode: 0o644,
          mtime: new Date()
        }
      }
    ]);

    const stream = streamFromBytes(tarData);

    await assert.rejects(
      extractTarball(stream),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('Symlinks are not supported');
      }
    );
  });
});

describe('extractTarballWithOptions', () => {
  it('extracts with default options', async () => {
    const tarData = await createTar([
      { name: 'package/index.js', content: 'export const x = 1;' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarballWithOptions(stream);

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('index.js'));
  });

  it('can disable package prefix stripping', async () => {
    const tarData = await createTar([
      { name: 'package/index.js', content: 'export const x = 1;' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarballWithOptions(stream, {
      stripPackagePrefix: false
    });

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('package/index.js'));
    assert.ok(!files.has('index.js'));
  });

  it('filters files by path', async () => {
    const tarData = await createTar([
      { name: 'package/index.js', content: '// js' },
      { name: 'package/style.css', content: '/* css */' },
      { name: 'package/utils.js', content: '// utils' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarballWithOptions(stream, {
      filter: (path) => path.endsWith('.js')
    });

    assert.strictEqual(files.size, 2);
    assert.ok(files.has('index.js'));
    assert.ok(files.has('utils.js'));
    assert.ok(!files.has('style.css'));
  });

  it('filter receives header information', async () => {
    const tarData = await createTar([
      { name: 'package/large.txt', content: 'x'.repeat(1000) },
      { name: 'package/small.txt', content: 'tiny' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarballWithOptions(stream, {
      filter: (path, header) => header.size < 100
    });

    assert.strictEqual(files.size, 1);
    assert.ok(files.has('small.txt'));
    assert.ok(!files.has('large.txt'));
  });

  it('throws TAR error for invalid input', async () => {
    await assert.rejects(
      extractTarballWithOptions(null),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('still errors on symlinks with options', async () => {
    const tarData = await packTar([
      {
        header: {
          name: 'package/link.js',
          type: 'symlink',
          linkname: 'target.js',
          mode: 0o777,
          mtime: new Date()
        }
      }
    ]);

    const stream = streamFromBytes(tarData);

    await assert.rejects(
      extractTarballWithOptions(stream, { filter: () => true }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'TAR' &&
          err.message.includes('Symlinks are not supported');
      }
    );
  });
});

describe('Integration: realistic npm tarball structure', () => {
  it('extracts typical npm package structure', async () => {
    const tarData = await createTar([
      { name: 'package/package.json', content: JSON.stringify({
        name: 'my-package',
        version: '1.0.0',
        main: 'lib/index.js'
      }, null, 2) },
      { name: 'package/README.md', content: '# My Package\n\nA great package.' },
      { name: 'package/LICENSE', content: 'MIT License...' },
      { name: 'package/lib/index.js', content: 'module.exports = require("./utils");' },
      { name: 'package/lib/utils.js', content: 'module.exports = { add: (a, b) => a + b };' },
      { name: 'package/.npmignore', content: 'test/\n*.test.js' }
    ]);

    const stream = streamFromBytes(tarData);
    const files = await extractTarball(stream);

    assert.strictEqual(files.size, 6);
    assert.ok(files.has('package.json'));
    assert.ok(files.has('README.md'));
    assert.ok(files.has('LICENSE'));
    assert.ok(files.has('lib/index.js'));
    assert.ok(files.has('lib/utils.js'));
    assert.ok(files.has('.npmignore'));

    // Verify package.json content
    const pkgJson = JSON.parse(new TextDecoder().decode(files.get('package.json')));
    assert.strictEqual(pkgJson.name, 'my-package');
    assert.strictEqual(pkgJson.version, '1.0.0');
  });
});

describe('Performance: extractTarball', () => {
  it('extracts many files efficiently', async () => {
    // Create 100 files
    const entries = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        name: `package/file${i}.js`,
        content: `// File ${i}\nexport const x${i} = ${i};`
      });
    }

    const tarData = await createTar(entries);
    const stream = streamFromBytes(tarData);

    const start = performance.now();
    const files = await extractTarball(stream);
    const elapsed = performance.now() - start;

    assert.strictEqual(files.size, 100);

    // Should complete in reasonable time (< 1 second for 100 small files)
    assert.ok(elapsed < 1000, `Extraction took ${elapsed}ms, expected < 1000ms`);
  });
});
