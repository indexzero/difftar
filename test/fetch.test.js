import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  applyAuth,
  fetchUrl,
  fetchTarball,
  MAX_TARBALL_SIZE
} from '../src/fetch.js';
import { DiffError, isDiffError } from '../src/errors.js';

describe('MAX_TARBALL_SIZE', () => {
  it('is 20MB', () => {
    assert.strictEqual(MAX_TARBALL_SIZE, 20 * 1024 * 1024);
  });
});

describe('applyAuth', () => {
  it('does nothing for auth type "none"', () => {
    const headers = new Headers();
    applyAuth(headers, 'none', undefined);
    assert.strictEqual(headers.has('Authorization'), false);
  });

  it('does nothing when auth is undefined', () => {
    const headers = new Headers();
    applyAuth(headers, undefined, undefined);
    assert.strictEqual(headers.has('Authorization'), false);
  });

  it('applies bearer token', () => {
    const headers = new Headers();
    applyAuth(headers, 'bearer', 'npm_abc123');
    assert.strictEqual(headers.get('Authorization'), 'Bearer npm_abc123');
  });

  it('applies basic auth', () => {
    const headers = new Headers();
    const credential = Buffer.from('user:pass').toString('base64');
    applyAuth(headers, 'basic', credential);
    assert.strictEqual(headers.get('Authorization'), `Basic ${credential}`);
  });

  it('throws AUTH error when bearer requires credential', () => {
    const headers = new Headers();
    assert.throws(
      () => applyAuth(headers, 'bearer', undefined),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.message.includes('requires a credential');
      }
    );
  });

  it('throws AUTH error when basic requires credential', () => {
    const headers = new Headers();
    assert.throws(
      () => applyAuth(headers, 'basic', ''),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.message.includes('requires a credential');
      }
    );
  });

  it('throws AUTH error for unknown auth type', () => {
    const headers = new Headers();
    assert.throws(
      () => applyAuth(headers, 'oauth', 'token'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.message.includes('Unknown auth type');
      }
    );
  });
});

describe('fetchUrl', () => {
  /** @type {typeof globalThis.fetch} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns stream and size on successful fetch', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });

    globalThis.fetch = mock.fn(async () => {
      return new Response(mockBody, {
        status: 200,
        headers: { 'Content-Length': '3' }
      });
    });

    const result = await fetchUrl('https://example.com/test.tgz');

    assert.ok(result.stream instanceof ReadableStream);
    assert.strictEqual(result.size, 3);
  });

  it('returns null size when Content-Length is absent', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });

    globalThis.fetch = mock.fn(async () => {
      return new Response(mockBody, { status: 200 });
    });

    const result = await fetchUrl('https://example.com/test.tgz');

    assert.strictEqual(result.size, null);
  });

  it('passes headers to fetch', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    /** @type {Request | undefined} */
    let capturedRequest;

    globalThis.fetch = mock.fn(async (url, init) => {
      capturedRequest = new Request(url, init);
      return new Response(mockBody, { status: 200 });
    });

    const headers = new Headers();
    headers.set('Authorization', 'Bearer test123');
    headers.set('X-Custom', 'value');

    await fetchUrl('https://example.com/test.tgz', headers);

    assert.strictEqual(capturedRequest?.headers.get('Authorization'), 'Bearer test123');
    assert.strictEqual(capturedRequest?.headers.get('X-Custom'), 'value');
  });

  it('throws SIZE error when Content-Length exceeds limit', async () => {
    const oversizeLength = MAX_TARBALL_SIZE + 1;

    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(oversizeLength) }
      });
    });

    await assert.rejects(
      fetchUrl('https://example.com/huge.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'SIZE' &&
          err.status === 413 &&
          err.message.includes('exceeds limit');
      }
    );
  });

  it('throws AUTH error on 401 response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 401,
        statusText: 'Unauthorized'
      });
    });

    await assert.rejects(
      fetchUrl('https://example.com/private.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.status === 401 &&
          err.message.includes('Authentication failed');
      }
    );
  });

  it('throws AUTH error on 403 response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 403,
        statusText: 'Forbidden'
      });
    });

    await assert.rejects(
      fetchUrl('https://example.com/private.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.status === 401;
      }
    );
  });

  it('throws FETCH error on 404 response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 404,
        statusText: 'Not Found'
      });
    });

    await assert.rejects(
      fetchUrl('https://example.com/missing.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.status === 502 &&
          err.message.includes('HTTP 404');
      }
    );
  });

  it('throws FETCH error on 500 response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      });
    });

    await assert.rejects(
      fetchUrl('https://example.com/error.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('HTTP 500');
      }
    );
  });

  it('throws FETCH error on network failure', async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError('Network request failed');
    });

    await assert.rejects(
      fetchUrl('https://example.com/test.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('Network error');
      }
    );
  });

  it('throws FETCH error when response has no body', async () => {
    // Create a response without a body
    globalThis.fetch = mock.fn(async () => {
      const response = new Response(null, { status: 200 });
      // Simulate a response with body=null (edge case)
      Object.defineProperty(response, 'body', { value: null });
      return response;
    });

    await assert.rejects(
      fetchUrl('https://example.com/nobody.tgz'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('no body');
      }
    );
  });
});

describe('fetchTarball', () => {
  /** @type {typeof globalThis.fetch} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches URL with no auth', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });

    /** @type {Request | undefined} */
    let capturedRequest;

    globalThis.fetch = mock.fn(async (url, init) => {
      capturedRequest = new Request(url, init);
      return new Response(mockBody, {
        status: 200,
        headers: { 'Content-Length': '3' }
      });
    });

    const result = await fetchTarball({
      transport: 'url',
      source: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
    });

    assert.ok(result.stream instanceof ReadableStream);
    assert.strictEqual(capturedRequest?.headers.has('Authorization'), false);
  });

  it('fetches URL with bearer auth', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    /** @type {Request | undefined} */
    let capturedRequest;

    globalThis.fetch = mock.fn(async (url, init) => {
      capturedRequest = new Request(url, init);
      return new Response(mockBody, { status: 200 });
    });

    await fetchTarball({
      transport: 'url',
      source: 'https://npm.pkg.github.com/download/@org/pkg/1.0.0/abc',
      auth: 'bearer',
      credential: 'ghp_xxxx'
    });

    assert.strictEqual(capturedRequest?.headers.get('Authorization'), 'Bearer ghp_xxxx');
  });

  it('fetches URL with basic auth', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    /** @type {Request | undefined} */
    let capturedRequest;

    globalThis.fetch = mock.fn(async (url, init) => {
      capturedRequest = new Request(url, init);
      return new Response(mockBody, { status: 200 });
    });

    const credential = Buffer.from('user:pass').toString('base64');

    await fetchTarball({
      transport: 'url',
      source: 'https://registry.example.com/pkg/-/pkg-1.0.0.tgz',
      auth: 'basic',
      credential
    });

    assert.strictEqual(capturedRequest?.headers.get('Authorization'), `Basic ${credential}`);
  });

  it('throws FETCH error for missing config', async () => {
    await assert.rejects(
      fetchTarball(null),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('configuration is required');
      }
    );
  });

  it('throws FETCH error for missing transport', async () => {
    await assert.rejects(
      fetchTarball({ source: 'https://example.com/test.tgz' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('Transport type is required');
      }
    );
  });

  it('throws FETCH error for missing URL source', async () => {
    await assert.rejects(
      fetchTarball({ transport: 'url' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('URL source is required');
      }
    );
  });

  it('throws FETCH error for empty URL source', async () => {
    await assert.rejects(
      fetchTarball({ transport: 'url', source: '' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('URL source is required');
      }
    );
  });

  it('throws FETCH error for unknown transport', async () => {
    await assert.rejects(
      fetchTarball({ transport: 'ftp', source: 'ftp://example.com/test.tgz' }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('Unknown transport');
      }
    );
  });

  it('throws FETCH error for s3 transport (Phase 2)', async () => {
    await assert.rejects(
      fetchTarball({
        transport: 's3',
        source: 's3://bucket/key.tgz',
        s3: { accessKeyId: 'key', secretAccessKey: 'secret' }
      }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('not yet implemented');
      }
    );
  });

  it('throws FETCH error for inline transport (Phase 2)', async () => {
    await assert.rejects(
      fetchTarball({
        transport: 'inline',
        data: new Uint8Array([1, 2, 3])
      }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('not yet implemented');
      }
    );
  });

  it('throws FETCH error for file transport (Phase 2)', async () => {
    await assert.rejects(
      fetchTarball({
        transport: 'file',
        source: '/path/to/package.tgz'
      }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'FETCH' &&
          err.message.includes('not yet implemented');
      }
    );
  });

  it('propagates AUTH errors from applyAuth', async () => {
    await assert.rejects(
      fetchTarball({
        transport: 'url',
        source: 'https://example.com/test.tgz',
        auth: 'bearer'
        // credential intentionally missing
      }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'AUTH' &&
          err.message.includes('requires a credential');
      }
    );
  });
});

describe('Integration: fetchTarball with SIZE validation', () => {
  /** @type {typeof globalThis.fetch} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects oversized tarballs with SIZE error', async () => {
    const oversizeLength = MAX_TARBALL_SIZE + 1024;

    globalThis.fetch = mock.fn(async () => {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(oversizeLength) }
      });
    });

    await assert.rejects(
      fetchTarball({
        transport: 'url',
        source: 'https://registry.npmjs.org/huge/-/huge-1.0.0.tgz'
      }),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'SIZE' &&
          err.status === 413;
      }
    );
  });

  it('accepts tarball at exactly the size limit', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    globalThis.fetch = mock.fn(async () => {
      return new Response(mockBody, {
        status: 200,
        headers: { 'Content-Length': String(MAX_TARBALL_SIZE) }
      });
    });

    const result = await fetchTarball({
      transport: 'url',
      source: 'https://registry.npmjs.org/big/-/big-1.0.0.tgz'
    });

    assert.strictEqual(result.size, MAX_TARBALL_SIZE);
  });
});
