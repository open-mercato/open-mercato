import { isPotentialEncryptedPayload, readSafeDecryptedString } from '../lib/decryptionSafety'

describe('warranty_claims decrypted display value safety', () => {
  const encrypted = 'tO7TyMk5X1EdR4K1:jtiaFLv2DE/ITjAAuEE=:RqYjgUkWp75s5n3aBf5Ixg==:v1'

  it('recognizes AES-GCM field payloads and prevents them from reaching the UI', () => {
    expect(isPotentialEncryptedPayload(encrypted)).toBe(true)
    expect(readSafeDecryptedString(encrypted)).toBeNull()
  })

  it('keeps ordinary colon-delimited text and trims normal display values', () => {
    expect(isPotentialEncryptedPayload('user:supplied:colon:v1')).toBe(false)
    expect(readSafeDecryptedString('  Alice Staff  ')).toBe('Alice Staff')
  })
})
