import crypto from 'node:crypto'
import type { SsoFlowState } from './types'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const TTL_MS = 5 * 60 * 1000
const HKDF_SALT = Buffer.from('open-mercato-sso-state-v1')
const HKDF_INFO = Buffer.from('sso-state-cookie')

function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32))
}

function getSecret(): string {
  const secret = process.env.SSO_STATE_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('SSO_STATE_SECRET or JWT_SECRET must be set')
  return secret
}

export function encryptStateCookie(payload: SsoFlowState): string {
  const secret = getSecret()
  const key = deriveKey(secret)
  const iv = crypto.randomBytes(IV_LENGTH)
  const json = JSON.stringify(payload)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const combined = Buffer.concat([iv, tag, ciphertext])
  return combined.toString('base64url')
}

export function decryptStateCookie(cookie: string): SsoFlowState | null {
  try {
    const secret = getSecret()
    const key = deriveKey(secret)
    const combined = Buffer.from(cookie, 'base64url')

    if (combined.length < IV_LENGTH + TAG_LENGTH) return null

    const iv = combined.subarray(0, IV_LENGTH)
    const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')

    const payload = JSON.parse(decrypted) as SsoFlowState
    if (payload.expiresAt < Date.now()) return null

    return payload
  } catch {
    return null
  }
}

export function createFlowState(params: {
  configId: string
  returnUrl: string
}): { state: SsoFlowState; codeVerifier: string } {
  const state = crypto.randomBytes(32).toString('base64url')
  const nonce = crypto.randomBytes(16).toString('base64url')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')

  return {
    state: {
      state,
      nonce,
      codeVerifier,
      configId: params.configId,
      returnUrl: params.returnUrl,
      expiresAt: Date.now() + TTL_MS,
    },
    codeVerifier,
  }
}
