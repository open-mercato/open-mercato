import crypto from 'node:crypto'
import { isEncryptionDebugEnabled } from './toggles'

export type EncryptionPayload = {
  value: string | null
  raw: string
  version: string
}

export function generateDek(): string {
  return crypto.randomBytes(32).toString('base64')
}

function logDebug(event: string, payload: Record<string, unknown>) {
  if (!isEncryptionDebugEnabled()) return
  try {
    // eslint-disable-next-line no-console
    console.debug('[encryption]', event, payload)
  } catch {
    // ignore
  }
}

export function encryptWithAesGcm(value: string, dekBase64: string): EncryptionPayload {
  const dek = Buffer.from(dekBase64, 'base64')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = [
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
    'v1',
  ].join(':')
  logDebug('encrypt', { length: ciphertext.length })
  return { value: payload, raw: payload, version: 'v1' }
}

export function decryptWithAesGcm(payload: string, dekBase64: string): string | null {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 4) return null
  const [ivB64, ciphertextB64, tagB64, version] = parts
  if (version !== 'v1') return null
  const dek = Buffer.from(dekBase64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    logDebug('decrypt', { iv: ivB64, tag: tagB64 })
    return decrypted
  } catch (err) {
    logDebug('decrypt_error', { message: (err as Error)?.message || String(err) })
    return null
  }
}

export function hashForLookup(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex')
}
