import { generateKeyPairSync } from 'node:crypto'

/**
 * A throwaway ES256 (P-256) private key in PKCS#8 PEM — the curve Apple's `.p8`
 * signing keys use.
 *
 * `apnsCredentialsSchema` structurally parses `p8Key` with `createPrivateKey`,
 * so fixtures need a genuinely parseable key. Generating one per test process
 * keeps a private key out of the repository while still exercising the real
 * validation path.
 */
export function generateApnsTestP8Key(): string {
  return generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
}

/** Shared instance so a suite's fixtures all agree on one key. */
export const APNS_TEST_P8_KEY = generateApnsTestP8Key()
