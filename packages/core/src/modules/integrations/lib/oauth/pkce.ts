import { createHash, randomBytes } from 'node:crypto'

const CODE_VERIFIER_BYTES = 32

/** RFC 7636: a 43-character base64url verifier from 32 random bytes and its S256 challenge. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string; method: 'S256' } {
  const codeVerifier = randomBytes(CODE_VERIFIER_BYTES).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  return { codeVerifier, codeChallenge, method: 'S256' }
}
