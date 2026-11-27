import {
  decryptWithAesGcm,
  decryptWithAesGcmStrict,
  encryptWithAesGcm,
  isEncryptedPayloadShape,
  looksLikeEncryptedPayload,
  TenantDataEncryptionErrorCode,
} from '../aes'

const key = Buffer.alloc(32, 17).toString('base64')

describe('AES-GCM empty plaintext (#10849)', () => {
  it.each(['', 'text', 'Zażółć gęślą jaźń'])('round-trips %j with the existing v1 envelope', (plaintext) => {
    const { raw: payload, version } = encryptWithAesGcm(plaintext, key)

    expect(version).toBe('v1')
    expect(isEncryptedPayloadShape(payload)).toBe(true)
    expect(looksLikeEncryptedPayload(payload)).toBe(true)
    expect(decryptWithAesGcmStrict(payload, key)).toBe(plaintext)
    expect(decryptWithAesGcm(payload, key)).toBe(plaintext)
  })

  it('authenticates an empty envelope before returning plaintext', () => {
    const { raw: payload } = encryptWithAesGcm('', key)
    const [iv, ciphertext, tag] = payload.split(':')
    expect(ciphertext).toBe('')
    const modifiedTag = Buffer.from(tag, 'base64')
    modifiedTag[0] ^= 1
    const tampered = `${iv}:${ciphertext}:${modifiedTag.toString('base64')}:v1`
    const otherKey = Buffer.alloc(32, 29).toString('base64')

    expect(() => decryptWithAesGcmStrict(payload, otherKey)).toThrow(expect.objectContaining({ code: TenantDataEncryptionErrorCode.AUTH_FAILED }))
    expect(() => decryptWithAesGcmStrict(tampered, key)).toThrow(expect.objectContaining({ code: TenantDataEncryptionErrorCode.AUTH_FAILED }))
  })

  it.each(['$', '=', ' ', '!!!'])('rejects malformed ciphertext %j even with an empty-message tag', (ciphertext) => {
    const { raw: payload } = encryptWithAesGcm('', key)
    const [iv, , tag] = payload.split(':')
    const malformed = `${iv}:${ciphertext}:${tag}:v1`

    expect(isEncryptedPayloadShape(malformed)).toBe(false)
    expect(looksLikeEncryptedPayload(malformed)).toBe(false)
    expect(() => decryptWithAesGcmStrict(malformed, key)).toThrow(expect.objectContaining({ code: TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD }))
  })

  it.each(['missing-iv', 'missing-tag', 'short-iv', 'short-tag', 'wrong-version', 'extra-part'])('rejects an empty envelope with %s', (mutation) => {
    const { raw: payload } = encryptWithAesGcm('', key)
    const [iv, , tag] = payload.split(':')
    const malformed = {
      'missing-iv': `::${tag}:v1`,
      'missing-tag': `${iv}:::v1`,
      'short-iv': `YQ==::${tag}:v1`,
      'short-tag': `${iv}::YQ==:v1`,
      'wrong-version': `${iv}::${tag}:v2`,
      'extra-part': `${payload}:extra`,
    }[mutation]!

    expect(isEncryptedPayloadShape(malformed)).toBe(false)
    expect(looksLikeEncryptedPayload(malformed)).toBe(false)
    expect(() => decryptWithAesGcmStrict(malformed, key)).toThrow()
  })
})
