import { describe, it } from 'node:test';
import assert from 'node:assert';
import { gzipSync } from 'node:zlib';
import {
  decompress,
  decompressWithErrorHandling
} from '../src/decompress.js';
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
 * Collect all chunks from a ReadableStream into a single Uint8Array
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<Uint8Array>}
 */
async function collectStream(stream) {
  const chunks = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

describe('decompress', () => {
  it('decompresses valid gzip data', async () => {
    const original = new TextEncoder().encode('Hello, World!');
    const compressed = gzipSync(original);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);

    assert.deepStrictEqual(result, original);
  });

  it('decompresses larger gzip data', async () => {
    // Create a larger payload to test chunked decompression
    const original = new TextEncoder().encode('x'.repeat(10000));
    const compressed = gzipSync(original);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);

    assert.deepStrictEqual(result, original);
  });

  it('handles multi-chunk input', async () => {
    const original = new TextEncoder().encode('Hello, World!');
    const compressed = new Uint8Array(gzipSync(original));

    // Split compressed data into multiple chunks
    const mid = Math.floor(compressed.length / 2);
    const chunk1 = compressed.slice(0, mid);
    const chunk2 = compressed.slice(mid);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      }
    });

    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);

    assert.deepStrictEqual(result, original);
  });

  it('throws DECOMPRESS error for null input', () => {
    assert.throws(
      () => decompress(null),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('throws DECOMPRESS error for undefined input', () => {
    assert.throws(
      () => decompress(undefined),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('throws DECOMPRESS error for non-stream input', () => {
    assert.throws(
      () => decompress({ not: 'a stream' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('throws DECOMPRESS error for string input', () => {
    assert.throws(
      () => decompress('not a stream'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS';
      }
    );
  });

  it('handles empty gzip stream', async () => {
    // Empty gzip file (just headers)
    const emptyGzip = gzipSync(Buffer.alloc(0));
    const stream = streamFromBytes(new Uint8Array(emptyGzip));

    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);

    assert.strictEqual(result.length, 0);
  });

  it('stream errors on invalid gzip data during consumption', async () => {
    // Random bytes that are not valid gzip
    const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const stream = streamFromBytes(invalidData);

    const decompressed = decompress(stream);

    // The error occurs during consumption, not creation
    await assert.rejects(
      collectStream(decompressed),
      (err) => {
        // The native DecompressionStream throws a generic error
        return err instanceof Error;
      }
    );
  });
});

describe('decompressWithErrorHandling', () => {
  it('decompresses valid gzip data', async () => {
    const original = new TextEncoder().encode('Hello, World!');
    const compressed = gzipSync(original);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const decompressed = decompressWithErrorHandling(stream);
    const result = await collectStream(decompressed);

    assert.deepStrictEqual(result, original);
  });

  it('wraps errors in DiffError with DECOMPRESS phase', async () => {
    // Invalid gzip data
    const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const stream = streamFromBytes(invalidData);

    const decompressed = decompressWithErrorHandling(stream);

    await assert.rejects(
      collectStream(decompressed),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS' &&
          err.message.includes('Invalid gzip data');
      }
    );
  });

  it('throws DECOMPRESS error for invalid input', () => {
    assert.throws(
      () => decompressWithErrorHandling(null),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS' &&
          err.message.includes('expected a ReadableStream');
      }
    );
  });

  it('handles larger invalid data', async () => {
    // Random bytes that start with gzip magic but are invalid
    const invalidData = new Uint8Array(1000);
    invalidData[0] = 0x1f; // gzip magic byte 1
    invalidData[1] = 0x8b; // gzip magic byte 2
    // Rest is garbage

    const stream = streamFromBytes(invalidData);
    const decompressed = decompressWithErrorHandling(stream);

    await assert.rejects(
      collectStream(decompressed),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'DECOMPRESS';
      }
    );
  });

  it('supports stream cancellation', async () => {
    const original = new TextEncoder().encode('x'.repeat(10000));
    const compressed = gzipSync(original);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const decompressed = decompressWithErrorHandling(stream);
    const reader = decompressed.getReader();

    // Read one chunk then cancel
    await reader.read();
    await reader.cancel('Test cancellation');

    // Should not throw
    assert.ok(true);
  });
});

describe('Integration: decompress with real tar data structure', () => {
  it('decompresses a minimal tar-like structure', async () => {
    // Create data that represents a minimal file in tar format
    // (Just testing that arbitrary binary data survives compression/decompression)
    const tarHeader = new Uint8Array(512);
    const filename = 'package/index.js';
    new TextEncoder().encodeInto(filename, tarHeader);

    const compressed = gzipSync(tarHeader);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);

    assert.strictEqual(result.length, 512);
    // Verify filename is preserved
    const decodedFilename = new TextDecoder().decode(result.slice(0, filename.length));
    assert.strictEqual(decodedFilename, filename);
  });
});

describe('Performance: decompress handles large data', () => {
  it('decompresses 1MB of data efficiently', async () => {
    // 1MB of compressible data
    const size = 1024 * 1024;
    const original = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      original[i] = i % 256;
    }

    const compressed = gzipSync(original);
    const stream = streamFromBytes(new Uint8Array(compressed));

    const start = performance.now();
    const decompressed = decompress(stream);
    const result = await collectStream(decompressed);
    const elapsed = performance.now() - start;

    assert.strictEqual(result.length, size);
    assert.deepStrictEqual(result, original);

    // Should complete in reasonable time (< 1 second for 1MB)
    assert.ok(elapsed < 1000, `Decompression took ${elapsed}ms, expected < 1000ms`);
  });
});
