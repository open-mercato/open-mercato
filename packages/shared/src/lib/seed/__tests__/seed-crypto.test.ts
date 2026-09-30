import {
  decryptSeedEnvelope,
  encryptSeedDocument,
  generateSeedKey,
  resolveSeedKey,
  SEED_KEY_ENV,
} from '../crypto'
import { encryptedSeedEnvelopeSchema, type SeedDocument } from '../types'

const sampleDocument: SeedDocument = {
  format: 'om-seed',
  version: 1,
  records: [
    { entity: 'customers:customer_entity', match: ['id'], data: { id: 'abc', displayName: 'Jane Doe' } },
    { entity: 'customers:customer_address', data: { name: 'HQ', city: 'Warsaw' } },
  ],
}

describe('seed crypto', () => {
  const originalEnv = process.env[SEED_KEY_ENV]
  afterEach(() => {
    if (originalEnv === undefined) delete process.env[SEED_KEY_ENV]
    else process.env[SEED_KEY_ENV] = originalEnv
  })

  it('generates a 32-byte base64 key', () => {
    const key = generateSeedKey()
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
  })

  it('round-trips a document through encrypt/decrypt', () => {
    const key = generateSeedKey()
    const envelope = encryptSeedDocument(sampleDocument, key)
    expect(() => encryptedSeedEnvelopeSchema.parse(envelope)).not.toThrow()
    // The envelope must not leak plaintext.
    expect(envelope.payload).not.toContain('Jane Doe')
    const decrypted = decryptSeedEnvelope(envelope, key)
    expect(decrypted).toEqual(sampleDocument)
  })

  it('produces a different ciphertext each time (randomized IV)', () => {
    const key = generateSeedKey()
    const a = encryptSeedDocument(sampleDocument, key)
    const b = encryptSeedDocument(sampleDocument, key)
    expect(a.payload).not.toEqual(b.payload)
  })

  it('fails to decrypt with the wrong key', () => {
    const envelope = encryptSeedDocument(sampleDocument, generateSeedKey())
    expect(() => decryptSeedEnvelope(envelope, generateSeedKey())).toThrow()
  })

  it('resolves the key from OM_SEED_KEY', () => {
    const key = generateSeedKey()
    process.env[SEED_KEY_ENV] = key
    expect(resolveSeedKey()).toBe(key)
  })

  it('rejects a missing or malformed key', () => {
    delete process.env[SEED_KEY_ENV]
    expect(() => resolveSeedKey()).toThrow()
    expect(() => resolveSeedKey('not-32-bytes')).toThrow()
  })
})
