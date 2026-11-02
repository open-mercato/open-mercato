import { encryptWithAesGcm, generateDek, looksLikeEncryptedPayload } from '../aes'
import { NoopKmsService, resolveEncryptionMode } from '../kms'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

/**
 * Once encryption is switched off the KMS is a noop, so `decryptWithAesGcm` cannot tell ciphertext
 * from plaintext — it returns null for both. Every caller that has to answer "is this column still
 * holding an envelope?" in that state depends on the shape check instead.
 */
describe('looksLikeEncryptedPayload', () => {
  it('recognises what encryptWithAesGcm produces', () => {
    const payload = encryptWithAesGcm('sk_live_secret', generateDek()).value
    expect(looksLikeEncryptedPayload(payload)).toBe(true)
  })

  it.each([
    ['plain text', 'Renewal for ACME Ltd'],
    ['empty string', ''],
    ['a colon-separated value with the wrong arity', 'a:b:v1'],
    ['a four-part value with the wrong version', 'aaaaaaaaaaaaaaaa:Y2lwaGVy:aaaaaaaaaaaaaaaaaaaaaaaa:v2'],
    ['a time-like string', '12:30:00:v1'],
    ['non-base64 components of the right length', '****************:Y2lwaGVy:************************:v1'],
    ['an empty ciphertext component', 'YWJjZGVmZ2hpamtsbW5v:' + ':YWJjZGVmZ2hpamtsbW5vcHFyc3R1:v1'],
  ])('rejects %s', (_label, value) => {
    expect(looksLikeEncryptedPayload(value)).toBe(false)
  })

  it.each([[null], [undefined], [42], [{}], [[]]])('rejects the non-string %p', (value) => {
    expect(looksLikeEncryptedPayload(value)).toBe(false)
  })
})

/**
 * The distinction this type exists to make. `NoopKmsService.isHealthy()` is deliberately inverted
 * — it reports healthy exactly when encryption is OFF — so that `enabled && healthy` collapses
 * correctly. The cost is that a bare `if (!kms.isHealthy())` reads "operator opted out" and "Vault
 * is down" as the same condition, and they need opposite handling.
 */
describe('resolveEncryptionMode', () => {
  it('reports disabled when the operator opted out, however the KMS answers', () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    expect(resolveEncryptionMode(new NoopKmsService())).toBe('disabled')
    expect(resolveEncryptionMode({ isHealthy: () => true })).toBe('disabled')
    expect(resolveEncryptionMode({ isHealthy: () => false })).toBe('disabled')
  })

  it('reports active when encryption is on and a DEK is reachable', () => {
    delete process.env.TENANT_DATA_ENCRYPTION
    expect(resolveEncryptionMode({ isHealthy: () => true })).toBe('active')
  })

  it('separates an unreachable KMS from an operator opt-out', () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    expect(resolveEncryptionMode({ isHealthy: () => false })).toBe('unavailable')
    // Same KMS object, same `isHealthy()` answer, opposite mode — the toggle is what differs.
    expect(new NoopKmsService().isHealthy()).toBe(false)
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    expect(new NoopKmsService().isHealthy()).toBe(true)
    expect(resolveEncryptionMode(new NoopKmsService())).toBe('disabled')
  })

  it('defaults to encrypting when the toggle is unset', () => {
    delete process.env.TENANT_DATA_ENCRYPTION
    expect(resolveEncryptionMode({ isHealthy: () => true })).toBe('active')
    expect(resolveEncryptionMode({ isHealthy: () => false })).toBe('unavailable')
  })
})
