import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DiffError,
  isDiffError,
  assertDiff,
  sanitizeCredentials
} from '../src/errors.js';

describe('DiffError', () => {
  it('creates error with correct phase and status', () => {
    const err = new DiffError('FETCH', 'Network error');

    assert.strictEqual(err.name, 'DiffError');
    assert.strictEqual(err.phase, 'FETCH');
    assert.strictEqual(err.status, 502);
    assert.strictEqual(err.httpStatus, 502);
    assert.strictEqual(err.message, 'Network error');
  });

  it('maps phases to correct HTTP status codes', () => {
    const mappings = [
      ['AUTH', 401],
      ['SIZE', 413],
      ['FETCH', 502],
      ['DECOMPRESS', 422],
      ['TAR', 422],
      ['DIFF', 500]
    ];

    for (const [phase, expectedStatus] of mappings) {
      const err = new DiffError(phase, 'test');
      assert.strictEqual(err.status, expectedStatus, `${phase} should map to ${expectedStatus}`);
    }
  });

  it('includes cause when provided', () => {
    const cause = new Error('underlying error');
    const err = new DiffError('FETCH', 'Network error', cause);

    assert.strictEqual(err.cause, cause);
  });

  it('generates JSON with all fields', () => {
    const cause = new Error('underlying error');
    const err = new DiffError('FETCH', 'Network error', cause);
    const json = err.toJSON();

    assert.deepStrictEqual(json, {
      error: 'DiffError',
      phase: 'FETCH',
      status: 502,
      message: 'Network error',
      cause: 'underlying error'
    });
  });

  it('generates JSON without cause when not provided', () => {
    const err = new DiffError('SIZE', 'Too large');
    const json = err.toJSON();

    assert.deepStrictEqual(json, {
      error: 'DiffError',
      phase: 'SIZE',
      status: 413,
      message: 'Too large'
    });
  });

  it('generates Response with correct status and body', async () => {
    const err = new DiffError('AUTH', 'Invalid token');
    const response = err.toResponse();

    assert.strictEqual(response.status, 401);
    assert.strictEqual(
      response.headers.get('Content-Type'),
      'application/json; charset=utf-8'
    );

    const body = await response.json();
    assert.deepStrictEqual(body, {
      error: 'DiffError',
      phase: 'AUTH',
      status: 401,
      message: 'Invalid token'
    });
  });
});

describe('DiffError.wrap', () => {
  it('wraps regular Error', () => {
    const original = new Error('original message');
    const wrapped = DiffError.wrap('FETCH', original);

    assert.strictEqual(wrapped.phase, 'FETCH');
    assert.strictEqual(wrapped.message, 'original message');
    assert.strictEqual(wrapped.cause, original);
  });

  it('wraps with context', () => {
    const original = new Error('original message');
    const wrapped = DiffError.wrap('FETCH', original, 'Failed to fetch left tarball');

    assert.strictEqual(wrapped.message, 'Failed to fetch left tarball: original message');
  });

  it('wraps non-Error values', () => {
    const wrapped = DiffError.wrap('DIFF', 'string error');

    assert.strictEqual(wrapped.message, 'string error');
    assert.strictEqual(wrapped.cause, undefined);
  });

  it('passes through existing DiffError without context', () => {
    const original = new DiffError('AUTH', 'unauthorized');
    const wrapped = DiffError.wrap('FETCH', original);

    assert.strictEqual(wrapped, original);
  });

  it('creates new DiffError from existing one with context', () => {
    const original = new DiffError('AUTH', 'unauthorized');
    const wrapped = DiffError.wrap('AUTH', original, 'Left source');

    assert.notStrictEqual(wrapped, original);
    assert.strictEqual(wrapped.message, 'Left source: unauthorized');
  });
});

describe('isDiffError', () => {
  it('returns true for DiffError', () => {
    const err = new DiffError('FETCH', 'test');
    assert.strictEqual(isDiffError(err), true);
  });

  it('returns false for regular Error', () => {
    const err = new Error('test');
    assert.strictEqual(isDiffError(err), false);
  });

  it('returns false for non-Error values', () => {
    assert.strictEqual(isDiffError('string'), false);
    assert.strictEqual(isDiffError(null), false);
    assert.strictEqual(isDiffError(undefined), false);
    assert.strictEqual(isDiffError({}), false);
  });
});

describe('assertDiff', () => {
  it('does nothing when condition is true', () => {
    assert.doesNotThrow(() => {
      assertDiff(true, 'SIZE', 'Should not throw');
    });
  });

  it('throws DiffError when condition is false', () => {
    assert.throws(
      () => assertDiff(false, 'SIZE', 'Package too large'),
      (err) => {
        return isDiffError(err) &&
          err.phase === 'SIZE' &&
          err.message === 'Package too large';
      }
    );
  });
});

describe('sanitizeCredentials', () => {
  it('sanitizes Authorization headers', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('eyJ'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('sanitizes Basic auth', () => {
    const input = 'Authorization: Basic dXNlcjpwYXNz';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('dXNlcjpwYXNz'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('sanitizes URL credentials', () => {
    const input = 'https://user:password@registry.example.com/pkg.tgz';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('password'));
    assert.ok(sanitized.includes('[REDACTED]'));
    assert.ok(sanitized.includes('registry.example.com'));
  });

  it('sanitizes AWS credentials', () => {
    const input = 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('sanitizes Bearer tokens', () => {
    const input = 'Bearer npm_1234567890abcdef';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('npm_1234567890'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('sanitizes token query parameters', () => {
    const input = 'https://example.com/pkg.tgz?token=secrettoken123456';
    const sanitized = sanitizeCredentials(input);
    assert.ok(!sanitized.includes('secrettoken123456'));
  });

  it('returns non-string values unchanged', () => {
    // @ts-expect-error - testing invalid input
    assert.strictEqual(sanitizeCredentials(123), 123);
    // @ts-expect-error - testing invalid input
    assert.strictEqual(sanitizeCredentials(null), null);
  });

  it('handles strings without credentials', () => {
    const input = 'Normal error message without secrets';
    assert.strictEqual(sanitizeCredentials(input), input);
  });
});

describe('DiffError credential sanitization', () => {
  it('sanitizes credentials in message', () => {
    const err = new DiffError(
      'FETCH',
      'Failed to fetch https://user:pass@registry.com/pkg.tgz'
    );

    assert.ok(!err.message.includes('pass'));
    assert.ok(err.message.includes('[REDACTED]'));
  });

  it('sanitizes credentials in toJSON()', () => {
    const cause = new Error('Authorization: Bearer secret123token');
    const err = new DiffError('AUTH', 'Auth failed', cause);
    const json = err.toJSON();

    assert.ok(!json.cause?.includes('secret123token'));
  });

  it('sanitizes credentials in stack trace', () => {
    const err = new DiffError(
      'FETCH',
      'Failed with token=mysecrettoken123'
    );

    const stack = err.sanitizedStack;
    if (stack) {
      assert.ok(!stack.includes('mysecrettoken123'));
    }
  });
});
