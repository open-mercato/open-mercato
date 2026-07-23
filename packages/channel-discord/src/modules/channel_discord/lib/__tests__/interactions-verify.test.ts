import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import {
  verifyDiscordSignature,
  parseInteractionBody,
  DiscordInteractionType,
} from '../interactions-verify'

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  // Raw 32-byte public key is the last 32 bytes of the SPKI DER document.
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const publicKeyHex = spki.subarray(spki.length - 32).toString('hex')
  return {
    publicKeyHex,
    sign(message: string): string {
      return cryptoSign(null, Buffer.from(message, 'utf-8'), privateKey).toString('hex')
    },
  }
}

describe('verifyDiscordSignature (Ed25519, fail-closed)', () => {
  const signer = makeSigner()
  const timestamp = '1700000000'
  const rawBody = JSON.stringify({ type: 1 })
  const signatureHex = signer.sign(timestamp + rawBody)

  it('accepts a correctly signed request', () => {
    expect(
      verifyDiscordSignature({ publicKeyHex: signer.publicKeyHex, signatureHex, timestamp, rawBody }),
    ).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(
      verifyDiscordSignature({
        publicKeyHex: signer.publicKeyHex,
        signatureHex,
        timestamp,
        rawBody: JSON.stringify({ type: 2 }),
      }),
    ).toBe(false)
  })

  it('rejects a tampered timestamp', () => {
    expect(
      verifyDiscordSignature({ publicKeyHex: signer.publicKeyHex, signatureHex, timestamp: '1700000001', rawBody }),
    ).toBe(false)
  })

  it('rejects a missing signature (fail-closed)', () => {
    expect(
      verifyDiscordSignature({ publicKeyHex: signer.publicKeyHex, signatureHex: undefined, timestamp, rawBody }),
    ).toBe(false)
  })

  it('rejects a missing timestamp (fail-closed)', () => {
    expect(
      verifyDiscordSignature({ publicKeyHex: signer.publicKeyHex, signatureHex, timestamp: null, rawBody }),
    ).toBe(false)
  })

  it('rejects a malformed public key without throwing', () => {
    expect(
      verifyDiscordSignature({ publicKeyHex: 'not-hex', signatureHex, timestamp, rawBody }),
    ).toBe(false)
  })

  it('rejects a signature that verifies under a different key', () => {
    const otherSigner = makeSigner()
    expect(
      verifyDiscordSignature({ publicKeyHex: otherSigner.publicKeyHex, signatureHex, timestamp, rawBody }),
    ).toBe(false)
  })
})

describe('parseInteractionBody', () => {
  it('parses a JSON interaction with a numeric type', () => {
    const parsed = parseInteractionBody(JSON.stringify({ type: DiscordInteractionType.PING }))
    expect(parsed?.type).toBe(DiscordInteractionType.PING)
  })

  it('returns null for a non-interaction body', () => {
    expect(parseInteractionBody(JSON.stringify({ hello: 'world' }))).toBeNull()
    expect(parseInteractionBody('not json')).toBeNull()
  })
})
