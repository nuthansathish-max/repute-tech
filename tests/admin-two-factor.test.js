import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, totp } from '../admin-two-factor.js';

// RFC 6238 Appendix B, SHA-1 test secret, represented as Base32.
// The implementation intentionally returns six digits, so compare the
// RFC's eight-digit values modulo 1,000,000.
const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const vectors = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

test('Base32 encoding and decoding round-trip authenticator secret bytes', () => {
  const bytes = Buffer.from(Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255));
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
});

test('TOTP matches RFC 6238 SHA-1 test vectors (six-digit mode)', () => {
  for (const [seconds, expected] of vectors) {
    assert.equal(totp(rfcSecret, seconds * 1000), expected, `RFC vector at ${seconds}s`);
  }
});
