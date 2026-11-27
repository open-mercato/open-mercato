import { randomBytes } from 'node:crypto'
import { encryptWithAesGcm, decryptWithAesGcm, isEncryptedPayloadShape, isRotationCiphertextShape } from '../aes'

test.each(['', 'nonempty'])('recognizes and authenticates ciphertext for plaintext %p', (plaintext) => {
  const key = randomBytes(32).toString('base64')
  const envelope = encryptWithAesGcm(plaintext, key).value
  expect(isEncryptedPayloadShape(envelope)).toBe(true)
  expect(isRotationCiphertextShape(envelope)).toBe(true)
  expect(decryptWithAesGcm(envelope, key)).toBe(plaintext)
  expect(decryptWithAesGcm(envelope, randomBytes(32).toString('base64'))).toBeNull()
  expect(isRotationCiphertextShape('aaaa::bbbb:v1')).toBe(false)
})
