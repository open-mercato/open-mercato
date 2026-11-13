import { randomBytes } from 'node:crypto'
import { encryptWithAesGcm, decryptWithAesGcm, isEncryptedPayloadShape, isRotationCiphertextShape } from '../aes'

test('recognizes valid empty ciphertext without weakening the established nonempty shape contract', () => {
  const key = randomBytes(32).toString('base64'); const envelope = encryptWithAesGcm('', key).value
  expect(isEncryptedPayloadShape(envelope)).toBe(false)
  expect(isRotationCiphertextShape(envelope)).toBe(true)
  expect(decryptWithAesGcm(envelope, key)).toBe('')
  expect(decryptWithAesGcm(envelope, randomBytes(32).toString('base64'))).toBeNull()
  expect(isRotationCiphertextShape('aaaa::bbbb:v1')).toBe(false)
})
