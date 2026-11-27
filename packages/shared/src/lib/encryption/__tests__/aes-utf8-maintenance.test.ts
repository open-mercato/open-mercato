import { createCipheriv, randomBytes } from 'node:crypto'
import { decryptWithAesGcm, encryptWithAesGcm } from '../aes'

const key = randomBytes(32).toString('base64')
function sealBytes(bytes: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  return [iv.toString('base64'), ciphertext.toString('base64'), cipher.getAuthTag().toString('base64'), 'v1'].join(':')
}

test.each([
  [0x80], [0x81], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
])('protected decoding rejects authenticated invalid UTF-8 bytes %j', (...bytes: number[]) => {
  const payload = sealBytes(Buffer.from(bytes))
  expect(decryptWithAesGcm(payload, key, { requireValidUtf8: true })).toBeNull()
  expect(decryptWithAesGcm(payload, key)).toBe(Buffer.from(bytes).toString('utf8'))
})

test('strict decoding distinguishes a genuine replacement character from colliding invalid plaintext bytes', () => {
  const genuine = encryptWithAesGcm('\ufffd', key).raw
  const invalid = [sealBytes(Buffer.from([0x80])), sealBytes(Buffer.from([0x81]))]
  expect(invalid.map(payload => decryptWithAesGcm(payload, key))).toEqual(['\ufffd', '\ufffd'])
  expect(decryptWithAesGcm(genuine, key, { requireValidUtf8: true })).toBe('\ufffd')
  expect(invalid.map(payload => decryptWithAesGcm(payload, key, { requireValidUtf8: true }))).toEqual([null, null])
})

test.each(['', 'plain ASCII', '\u0000', '日本語 😀', '\ufeffkept BOM', '\ufffd'])('protected decoding preserves valid text %j exactly', text => {
  expect(decryptWithAesGcm(encryptWithAesGcm(text, key).raw, key, { requireValidUtf8: true })).toBe(text)
})

test('protected decoding still requires the authenticated key', () => {
  const payload = sealBytes(Buffer.from('valid text'))
  expect(decryptWithAesGcm(payload, randomBytes(32).toString('base64'), { requireValidUtf8: true })).toBeNull()
})
