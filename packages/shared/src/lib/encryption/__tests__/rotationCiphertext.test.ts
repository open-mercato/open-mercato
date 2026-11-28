import { encryptWithAesGcm, decryptWithAesGcm, isEncryptedPayloadShape, isRotationCiphertextShape } from '../aes'

const key = Buffer.alloc(32, 17).toString('base64')
const wrongKey = Buffer.alloc(32, 29).toString('base64')

test.each(['', 'text'])('recognizes and authenticates the v1 envelope for %j', (plaintext) => {
  const { raw: envelope } = encryptWithAesGcm(plaintext, key)

  expect(isEncryptedPayloadShape(envelope)).toBe(true)
  expect(isRotationCiphertextShape(envelope)).toBe(true)
  expect(decryptWithAesGcm(envelope, key)).toBe(plaintext)
  expect(decryptWithAesGcm(envelope, wrongKey)).toBeNull()
})

test('rejects a malformed empty v1 envelope', () => {
  const malformed = 'aaaa::bbbb:v1'

  expect(isEncryptedPayloadShape(malformed)).toBe(false)
  expect(isRotationCiphertextShape(malformed)).toBe(false)
})
