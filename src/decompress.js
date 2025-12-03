/**
 * Decompression layer for npm-diff-worker.
 *
 * Wraps the web-standard DecompressionStream to transform .tgz to tar.
 * Uses native gzip decompression available in all target runtimes
 * (Node 22+, Bun, Deno, Cloudflare Workers).
 *
 * @module decompress
 */

import { DiffError } from './errors.js';

/**
 * Decompress a gzip-compressed stream.
 *
 * npm tarballs are .tgz files (gzipped tar archives). This function
 * transforms the compressed byte stream into an uncompressed tar stream
 * using the web-standard DecompressionStream API.
 *
 * @param {ReadableStream<Uint8Array>} stream - Gzip-compressed byte stream
 * @returns {ReadableStream<Uint8Array>} Decompressed byte stream
 * @throws {DiffError} If the stream is not valid gzip data
 *
 * @example
 * ```js
 * const { stream } = await fetchTarball(config);
 * const tarStream = decompress(stream);
 * // tarStream is now uncompressed tar data
 * ```
 *
 * @example
 * ```js
 * // Full pipeline: fetch -> decompress -> untar
 * const { stream } = await fetchTarball(config);
 * const tarStream = decompress(stream);
 * const files = await extractTar(tarStream);
 * ```
 */
export function decompress(stream) {
  if (!stream || typeof stream.pipeThrough !== 'function') {
    throw new DiffError(
      'DECOMPRESS',
      'Invalid input: expected a ReadableStream'
    );
  }

  try {
    // DecompressionStream is available in all target runtimes:
    // - Node.js 22+ (via web streams)
    // - Bun
    // - Deno
    // - Cloudflare Workers
    //
    // This is the "native" approach - no pako or other libraries needed.
    const decompressor = new DecompressionStream('gzip');

    // @ts-expect-error - TypeScript's DOM typings incorrectly type DecompressionStream
    // as accepting BufferSource, but it works correctly with Uint8Array streams at runtime.
    // See: https://github.com/microsoft/TypeScript/issues/52102
    return stream.pipeThrough(decompressor);
  } catch (error) {
    // DecompressionStream constructor itself shouldn't throw,
    // but pipeThrough might if the stream is locked or errored
    throw DiffError.wrap(
      'DECOMPRESS',
      error,
      'Failed to create decompression pipeline'
    );
  }
}

/**
 * Create a TransformStream that wraps decompression errors.
 *
 * The native DecompressionStream throws generic errors on invalid gzip data.
 * This wrapper catches those and converts them to DiffError instances
 * with the DECOMPRESS phase.
 *
 * Use this when you need error handling in the stream pipeline itself
 * rather than at consumption time.
 *
 * @returns {TransformStream<Uint8Array, Uint8Array>} Error-wrapping transform stream
 *
 * @example
 * ```js
 * const tarStream = stream
 *   .pipeThrough(new DecompressionStream('gzip'))
 *   .pipeThrough(createDecompressErrorWrapper());
 * ```
 */
export function createDecompressErrorWrapper() {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    flush(controller) {
      // All data passed through successfully
    }
  });
}

/**
 * Decompress with explicit error handling.
 *
 * This variant catches decompression errors during consumption and
 * wraps them in DiffError. Useful when you want to handle errors
 * at the point of stream consumption rather than creation.
 *
 * @param {ReadableStream<Uint8Array>} stream - Gzip-compressed byte stream
 * @returns {ReadableStream<Uint8Array>} Decompressed stream with error wrapping
 *
 * @example
 * ```js
 * const tarStream = decompressWithErrorHandling(gzipStream);
 * try {
 *   for await (const chunk of tarStream) {
 *     // process chunk
 *   }
 * } catch (err) {
 *   // err will be a DiffError with phase 'DECOMPRESS'
 * }
 * ```
 */
export function decompressWithErrorHandling(stream) {
  if (!stream || typeof stream.pipeThrough !== 'function') {
    throw new DiffError(
      'DECOMPRESS',
      'Invalid input: expected a ReadableStream'
    );
  }

  // Create the decompression stream
  const decompressor = new DecompressionStream('gzip');

  // Build the pipeline with error transformation
  // The error wrapping happens when the reader encounters an error
  // @ts-expect-error - TypeScript's DOM typings incorrectly type DecompressionStream
  // as accepting BufferSource, but it works correctly with Uint8Array streams at runtime.
  const decompressedStream = stream.pipeThrough(decompressor);

  // Track the reader so we can cancel it properly
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
  let reader = null;
  /** @type {boolean} */
  let cancelled = false;

  // Return a new ReadableStream that wraps errors
  return new ReadableStream({
    async pull(controller) {
      // Lazily acquire reader on first pull
      if (!reader) {
        reader = decompressedStream.getReader();
      }

      if (cancelled) {
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        // Convert decompression errors to DiffError
        const diffError = DiffError.wrap(
          'DECOMPRESS',
          error,
          'Invalid gzip data'
        );
        controller.error(diffError);
      }
    },

    cancel(reason) {
      cancelled = true;
      // Cancel through the reader if we have one, otherwise cancel the stream directly
      if (reader) {
        return reader.cancel(reason);
      }
      return decompressedStream.cancel(reason);
    }
  });
}
