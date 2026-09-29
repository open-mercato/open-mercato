const BASE64_PART = /^[A-Za-z0-9+/]+={0,2}$/

export function isPotentialEncryptedPayload(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  if (parts.length !== 4 || parts[3] !== 'v1') return false
  const [iv, ciphertext, tag] = parts
  return iv.length === 16
    && ciphertext.length > 0
    && tag.length === 24
    && BASE64_PART.test(iv)
    && BASE64_PART.test(ciphertext)
    && BASE64_PART.test(tag)
}

export function readSafeDecryptedString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim().length || isPotentialEncryptedPayload(value)) return null
  return value.trim()
}
