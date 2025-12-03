import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isBinaryPath,
  shouldPrintPatch,
  getBinaryExtensions,
  isBinaryExtension
} from '../src/binary.js';

describe('isBinaryPath', () => {
  describe('common binary formats', () => {
    it('detects image files', () => {
      assert.strictEqual(isBinaryPath('image.png'), true);
      assert.strictEqual(isBinaryPath('photo.jpg'), true);
      assert.strictEqual(isBinaryPath('icon.gif'), true);
      assert.strictEqual(isBinaryPath('logo.svg'), false); // SVG is text
      assert.strictEqual(isBinaryPath('image.webp'), true);
      assert.strictEqual(isBinaryPath('photo.jpeg'), true);
      assert.strictEqual(isBinaryPath('icon.ico'), true);
      assert.strictEqual(isBinaryPath('image.bmp'), true);
      assert.strictEqual(isBinaryPath('image.tiff'), true);
    });

    it('detects audio files', () => {
      assert.strictEqual(isBinaryPath('song.mp3'), true);
      assert.strictEqual(isBinaryPath('audio.wav'), true);
      assert.strictEqual(isBinaryPath('music.ogg'), true);
      assert.strictEqual(isBinaryPath('sound.flac'), true);
      assert.strictEqual(isBinaryPath('voice.aac'), true);
    });

    it('detects video files', () => {
      assert.strictEqual(isBinaryPath('video.mp4'), true);
      assert.strictEqual(isBinaryPath('movie.avi'), true);
      assert.strictEqual(isBinaryPath('clip.mov'), true);
      assert.strictEqual(isBinaryPath('film.mkv'), true);
      assert.strictEqual(isBinaryPath('video.webm'), true);
    });

    it('detects archive files', () => {
      assert.strictEqual(isBinaryPath('archive.zip'), true);
      assert.strictEqual(isBinaryPath('backup.tar'), true);
      assert.strictEqual(isBinaryPath('compressed.gz'), true);
      assert.strictEqual(isBinaryPath('package.tgz'), true);
      assert.strictEqual(isBinaryPath('archive.rar'), true);
      assert.strictEqual(isBinaryPath('archive.7z'), true);
      assert.strictEqual(isBinaryPath('archive.bz2'), true);
    });

    it('detects executable and library files', () => {
      assert.strictEqual(isBinaryPath('program.exe'), true);
      assert.strictEqual(isBinaryPath('library.dll'), true);
      assert.strictEqual(isBinaryPath('libfoo.so'), true);
      // Note: dylib is not in binary-extensions
    });

    it('detects font files', () => {
      assert.strictEqual(isBinaryPath('font.ttf'), true);
      assert.strictEqual(isBinaryPath('font.otf'), true);
      assert.strictEqual(isBinaryPath('font.woff'), true);
      assert.strictEqual(isBinaryPath('font.woff2'), true);
      assert.strictEqual(isBinaryPath('font.eot'), true);
    });

    // Note: wasm, sqlite, and db are not in binary-extensions v3
    // These could be added in future versions or via custom extension lists

    it('detects document files', () => {
      assert.strictEqual(isBinaryPath('doc.pdf'), true);
      assert.strictEqual(isBinaryPath('doc.docx'), true);
      assert.strictEqual(isBinaryPath('sheet.xlsx'), true);
      assert.strictEqual(isBinaryPath('slides.pptx'), true);
    });
  });

  describe('common text formats', () => {
    it('detects JavaScript files as text', () => {
      assert.strictEqual(isBinaryPath('index.js'), false);
      assert.strictEqual(isBinaryPath('lib/utils.mjs'), false);
      assert.strictEqual(isBinaryPath('app.cjs'), false);
      assert.strictEqual(isBinaryPath('types.ts'), false);
      assert.strictEqual(isBinaryPath('component.tsx'), false);
      assert.strictEqual(isBinaryPath('component.jsx'), false);
    });

    it('detects markup/config files as text', () => {
      assert.strictEqual(isBinaryPath('index.html'), false);
      assert.strictEqual(isBinaryPath('style.css'), false);
      assert.strictEqual(isBinaryPath('config.json'), false);
      assert.strictEqual(isBinaryPath('config.yaml'), false);
      assert.strictEqual(isBinaryPath('config.yml'), false);
      assert.strictEqual(isBinaryPath('config.toml'), false);
      assert.strictEqual(isBinaryPath('data.xml'), false);
    });

    it('detects documentation files as text', () => {
      assert.strictEqual(isBinaryPath('README.md'), false);
      assert.strictEqual(isBinaryPath('CHANGELOG.txt'), false);
      assert.strictEqual(isBinaryPath('LICENSE'), false); // no extension
      assert.strictEqual(isBinaryPath('docs.rst'), false);
    });

    it('detects other programming languages as text', () => {
      assert.strictEqual(isBinaryPath('main.py'), false);
      assert.strictEqual(isBinaryPath('main.rb'), false);
      assert.strictEqual(isBinaryPath('main.go'), false);
      assert.strictEqual(isBinaryPath('main.rs'), false);
      assert.strictEqual(isBinaryPath('main.java'), false);
      assert.strictEqual(isBinaryPath('main.c'), false);
      assert.strictEqual(isBinaryPath('main.cpp'), false);
      assert.strictEqual(isBinaryPath('main.h'), false);
      assert.strictEqual(isBinaryPath('main.php'), false);
    });

    it('detects shell scripts as text', () => {
      assert.strictEqual(isBinaryPath('script.sh'), false);
      assert.strictEqual(isBinaryPath('script.bash'), false);
      assert.strictEqual(isBinaryPath('script.zsh'), false);
    });
  });

  describe('path handling', () => {
    it('handles nested paths', () => {
      assert.strictEqual(isBinaryPath('lib/assets/image.png'), true);
      assert.strictEqual(isBinaryPath('src/components/Button.js'), false);
      assert.strictEqual(isBinaryPath('deep/nested/path/file.zip'), true);
    });

    it('handles case-insensitive extensions', () => {
      assert.strictEqual(isBinaryPath('image.PNG'), true);
      assert.strictEqual(isBinaryPath('image.Png'), true);
      assert.strictEqual(isBinaryPath('video.MP4'), true);
      assert.strictEqual(isBinaryPath('archive.ZIP'), true);
    });

    it('handles files without extensions', () => {
      assert.strictEqual(isBinaryPath('Makefile'), false);
      assert.strictEqual(isBinaryPath('LICENSE'), false);
      assert.strictEqual(isBinaryPath('Dockerfile'), false);
      assert.strictEqual(isBinaryPath('CODEOWNERS'), false);
    });

    it('handles dotfiles', () => {
      assert.strictEqual(isBinaryPath('.gitignore'), false);
      assert.strictEqual(isBinaryPath('.npmrc'), false);
      assert.strictEqual(isBinaryPath('.eslintrc'), false);
      assert.strictEqual(isBinaryPath('.DS_Store'), false);
    });

    it('handles files with multiple dots', () => {
      assert.strictEqual(isBinaryPath('file.min.js'), false);
      assert.strictEqual(isBinaryPath('archive.tar.gz'), true); // .gz is binary
      assert.strictEqual(isBinaryPath('file.test.ts'), false);
      assert.strictEqual(isBinaryPath('bundle.esm.mjs'), false);
    });

    it('handles edge cases', () => {
      assert.strictEqual(isBinaryPath(''), false);
      assert.strictEqual(isBinaryPath('.'), false);
      assert.strictEqual(isBinaryPath('..'), false);
      assert.strictEqual(isBinaryPath('/'), false);
    });

    it('returns false for non-string input', () => {
      // @ts-expect-error - testing invalid input
      assert.strictEqual(isBinaryPath(null), false);
      // @ts-expect-error - testing invalid input
      assert.strictEqual(isBinaryPath(undefined), false);
      // @ts-expect-error - testing invalid input
      assert.strictEqual(isBinaryPath(123), false);
      // @ts-expect-error - testing invalid input
      assert.strictEqual(isBinaryPath({}), false);
    });
  });
});

describe('shouldPrintPatch', () => {
  describe('without options', () => {
    it('returns true for text files', () => {
      assert.strictEqual(shouldPrintPatch('index.js'), true);
      assert.strictEqual(shouldPrintPatch('style.css'), true);
      assert.strictEqual(shouldPrintPatch('README.md'), true);
      assert.strictEqual(shouldPrintPatch('package.json'), true);
    });

    it('returns false for binary files', () => {
      assert.strictEqual(shouldPrintPatch('image.png'), false);
      assert.strictEqual(shouldPrintPatch('font.woff2'), false);
      assert.strictEqual(shouldPrintPatch('video.mp4'), false);
      assert.strictEqual(shouldPrintPatch('archive.zip'), false);
    });

    it('returns true for files without extension', () => {
      assert.strictEqual(shouldPrintPatch('LICENSE'), true);
      assert.strictEqual(shouldPrintPatch('Makefile'), true);
    });
  });

  describe('with text option', () => {
    it('forces true for binary files when text is true', () => {
      assert.strictEqual(shouldPrintPatch('image.png', { text: true }), true);
      assert.strictEqual(shouldPrintPatch('font.woff2', { text: true }), true);
      assert.strictEqual(shouldPrintPatch('module.wasm', { text: true }), true);
    });

    it('still returns true for text files when text is true', () => {
      assert.strictEqual(shouldPrintPatch('index.js', { text: true }), true);
      assert.strictEqual(shouldPrintPatch('style.css', { text: true }), true);
    });

    it('respects text: false (same as default)', () => {
      assert.strictEqual(shouldPrintPatch('image.png', { text: false }), false);
      assert.strictEqual(shouldPrintPatch('index.js', { text: false }), true);
    });
  });

  describe('with empty options', () => {
    it('uses defaults when options is empty object', () => {
      assert.strictEqual(shouldPrintPatch('image.png', {}), false);
      assert.strictEqual(shouldPrintPatch('index.js', {}), true);
    });

    it('ignores unrelated options', () => {
      // @ts-expect-error - testing unrelated options
      assert.strictEqual(shouldPrintPatch('image.png', { nameOnly: true }), false);
      // @ts-expect-error - testing unrelated options
      assert.strictEqual(shouldPrintPatch('index.js', { context: 5 }), true);
    });
  });
});

describe('getBinaryExtensions', () => {
  it('returns an array', () => {
    const extensions = getBinaryExtensions();
    assert.ok(Array.isArray(extensions));
  });

  it('returns a copy (not the original)', () => {
    const ext1 = getBinaryExtensions();
    const ext2 = getBinaryExtensions();
    assert.notStrictEqual(ext1, ext2);

    // Modifying one should not affect the other
    ext1.push('custom');
    assert.ok(!ext2.includes('custom'));
  });

  it('contains common binary extensions', () => {
    const extensions = getBinaryExtensions();
    assert.ok(extensions.includes('png'));
    assert.ok(extensions.includes('jpg'));
    assert.ok(extensions.includes('mp3'));
    assert.ok(extensions.includes('zip'));
    assert.ok(extensions.includes('exe'));
    assert.ok(extensions.includes('gif'));
    assert.ok(extensions.includes('pdf'));
  });

  it('extensions do not have leading dots', () => {
    const extensions = getBinaryExtensions();
    for (const ext of extensions) {
      assert.ok(!ext.startsWith('.'), `Extension "${ext}" should not start with dot`);
    }
  });

  it('has substantial number of extensions', () => {
    const extensions = getBinaryExtensions();
    // binary-extensions v3 has 262 extensions
    assert.ok(extensions.length > 200, `Expected > 200 extensions, got ${extensions.length}`);
  });
});

describe('isBinaryExtension', () => {
  it('returns true for known binary extensions', () => {
    assert.strictEqual(isBinaryExtension('png'), true);
    assert.strictEqual(isBinaryExtension('jpg'), true);
    assert.strictEqual(isBinaryExtension('zip'), true);
    assert.strictEqual(isBinaryExtension('exe'), true);
    assert.strictEqual(isBinaryExtension('gif'), true);
    assert.strictEqual(isBinaryExtension('pdf'), true);
  });

  it('returns false for text extensions', () => {
    assert.strictEqual(isBinaryExtension('js'), false);
    assert.strictEqual(isBinaryExtension('ts'), false);
    assert.strictEqual(isBinaryExtension('css'), false);
    assert.strictEqual(isBinaryExtension('html'), false);
    assert.strictEqual(isBinaryExtension('json'), false);
    assert.strictEqual(isBinaryExtension('md'), false);
  });

  it('is case-insensitive', () => {
    assert.strictEqual(isBinaryExtension('PNG'), true);
    assert.strictEqual(isBinaryExtension('Png'), true);
    assert.strictEqual(isBinaryExtension('MP4'), true);
  });

  it('does not expect leading dot', () => {
    // If you accidentally include the dot, it won't match
    assert.strictEqual(isBinaryExtension('.png'), false);
    assert.strictEqual(isBinaryExtension('.jpg'), false);
  });

  it('handles edge cases', () => {
    assert.strictEqual(isBinaryExtension(''), false);
    // @ts-expect-error - testing invalid input
    assert.strictEqual(isBinaryExtension(null), false);
    // @ts-expect-error - testing invalid input
    assert.strictEqual(isBinaryExtension(undefined), false);
  });
});

describe('Integration: binary detection in diff workflow', () => {
  it('correctly categorizes typical npm package files', () => {
    // Files that should be diffed
    const textFiles = [
      'package.json',
      'README.md',
      'LICENSE',
      'lib/index.js',
      'lib/utils.mjs',
      'types/index.d.ts',
      '.npmignore',
      '.gitignore',
      'tsconfig.json',
      'src/component.tsx'
    ];

    for (const file of textFiles) {
      assert.strictEqual(
        shouldPrintPatch(file),
        true,
        `${file} should be printed`
      );
    }

    // Files that should only show headers
    // Note: wasm and .node are not in binary-extensions v3
    const binaryFiles = [
      'assets/logo.png',
      'assets/icon.ico',
      'fonts/custom.woff2',
      'assets/video.mp4',
      'dist/bundle.exe'
    ];

    for (const file of binaryFiles) {
      assert.strictEqual(
        shouldPrintPatch(file),
        false,
        `${file} should NOT be printed`
      );
    }
  });

  it('--diff-text flag overrides binary detection', () => {
    const binaryFiles = [
      'assets/logo.png',
      'fonts/custom.woff2',
      'assets/video.mp4'
    ];

    for (const file of binaryFiles) {
      assert.strictEqual(
        shouldPrintPatch(file, { text: true }),
        true,
        `${file} should be printed with text option`
      );
    }
  });
});
