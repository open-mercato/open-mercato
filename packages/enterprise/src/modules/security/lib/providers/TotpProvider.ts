import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'
import { z } from 'zod'
import type {
  MfaMethodRecord,
  MfaProviderInterface,
  MfaProviderUser,
  MfaVerifyContext,
} from '../mfa-provider-interface'

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_WINDOW = 1
const SETUP_TTL_MS = 10 * 60 * 1000
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const setupPayloadSchema = z.object({
  issuer: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(100).optional(),
})

const confirmPayloadSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
})

type PendingSetup = {
  userId: string
  secret: string
  createdAt: number
}

type SerializedSetup = {
  u: string
  s: string
  c: number
}

export class TotpProvider implements MfaProviderInterface {
  readonly type = 'totp'
  readonly label = 'Authenticator App'
  readonly icon = 'Smartphone'
  readonly allowMultiple = true
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = confirmPayloadSchema

  private readonly pendingSetups = new Map<string, PendingSetup>()

  resolveSetupPayload(user: MfaProviderUser, payload: unknown): unknown {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    if (parsed.label) {
      return parsed
    }

    const email = typeof user.email === 'string' ? user.email.trim() : ''
    return {
      ...parsed,
      ...(email.length > 0 ? { label: email } : {}),
    }
  }

  async setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const secret = this.generateSecret()
    const setupId = this.createSetupToken(userId, secret, Date.now())
    const label = parsed.label ?? userId
    const issuer = parsed.issuer ?? 'Open Mercato'
    const uri = this.buildOtpAuthUri(secret, issuer, label)
    const qrDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
    })
    const now = Date.now()
    this.cleanupExpiredSetups(now)
    this.pendingSetups.set(setupId, {
      userId,
      secret,
      createdAt: now,
    })

    return {
      setupId,
      clientData: {
        secret,
        uri,
        qrDataUrl,
        issuer,
        label,
      },
    }
  }

  async confirmSetup(
    userId: string,
    setupId: string,
    payload: unknown,
  ): Promise<{ metadata: Record<string, unknown> }> {
    const parsed = confirmPayloadSchema.parse(payload)
    const setup = this.resolveSetup(setupId)
    if (!setup || setup.userId !== userId) {
      throw new Error('TOTP setup session not found')
    }
    if (Date.now() - setup.createdAt > SETUP_TTL_MS) {
      this.pendingSetups.delete(setupId)
      throw new Error('TOTP setup session expired')
    }
    const valid = this.verifyTotpCode(setup.secret, parsed.code)
    if (!valid) {
      throw new Error('Invalid TOTP code')
    }
    this.pendingSetups.delete(setupId)
    return {
      metadata: {
        secret: setup.secret,
        algorithm: 'SHA1',
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
      },
    }
  }

  async prepareChallenge(): Promise<{ clientData?: Record<string, unknown>; verifyContext?: MfaVerifyContext }> {
    return {}
  }

  async verify(
    userId: string,
    method: MfaMethodRecord,
    payload: unknown,
    _context?: MfaVerifyContext,
  ): Promise<boolean> {
    const parsed = confirmPayloadSchema.parse(payload)
    if (method.userId !== userId) return false
    const secretValue = method.providerMetadata?.secret
    if (typeof secretValue !== 'string' || secretValue.length === 0) return false
    return this.verifyTotpCode(secretValue, parsed.code)
  }

  private generateSecret(): string {
    return this.encodeBase32(randomBytes(20))
  }

  private buildOtpAuthUri(secret: string, issuer: string, label: string): string {
    const encodedIssuer = encodeURIComponent(issuer)
    const encodedLabel = encodeURIComponent(label)
    return `otpauth://totp/${encodedIssuer}:${encodedLabel}?secret=${encodeURIComponent(secret)}&issuer=${encodedIssuer}&period=${TOTP_PERIOD_SECONDS}&digits=${TOTP_DIGITS}`
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    const now = Math.floor(Date.now() / 1000)
    const input = Buffer.from(code.padStart(TOTP_DIGITS, '0'))
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
      const counter = Math.floor((now + offset * TOTP_PERIOD_SECONDS) / TOTP_PERIOD_SECONDS)
      const expected = Buffer.from(this.generateCodeForCounter(secret, counter))
      if (input.length === expected.length && timingSafeEqual(input, expected)) {
        return true
      }
    }
    return false
  }

  private generateCodeForCounter(secret: string, counter: number): string {
    const key = this.decodeTotpSecret(secret)
    const counterBuffer = Buffer.alloc(8)
    counterBuffer.writeBigUInt64BE(BigInt(counter))
    const digest = createHmac('sha1', key).update(counterBuffer).digest()
    const offset = digest[digest.length - 1] & 0x0f
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)
    const otp = binary % 10 ** TOTP_DIGITS
    return String(otp).padStart(TOTP_DIGITS, '0')
  }

  private decodeTotpSecret(secret: string): Buffer {
    const normalized = secret.trim().replaceAll(' ', '').replaceAll('-', '').toUpperCase()
    try {
      return this.decodeBase32(normalized)
    } catch {
      return Buffer.from(secret, 'base64')
    }
  }

  private encodeBase32(input: Buffer): string {
    let bits = 0
    let value = 0
    let output = ''
    for (const byte of input) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 5) {
        output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
        bits -= 5
      }
    }
    if (bits > 0) {
      output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
    }
    return output
  }

  private decodeBase32(input: string): Buffer {
    if (input.length === 0) {
      throw new Error('Invalid empty base32 input')
    }
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const char of input) {
      const index = BASE32_ALPHABET.indexOf(char)
      if (index === -1) {
        throw new Error('Invalid base32 character')
      }
      value = (value << 5) | index
      bits += 5
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff)
        bits -= 8
      }
    }
    return Buffer.from(bytes)
  }

  private cleanupExpiredSetups(now: number): void {
    for (const [setupId, setup] of this.pendingSetups.entries()) {
      if (now - setup.createdAt > SETUP_TTL_MS) {
        this.pendingSetups.delete(setupId)
      }
    }
  }

  private resolveSetup(setupId: string): PendingSetup | null {
    const inMemory = this.pendingSetups.get(setupId)
    if (inMemory) return inMemory

    const tokenSetup = this.readSetupToken(setupId)
    if (!tokenSetup) return null

    return {
      userId: tokenSetup.u,
      secret: tokenSetup.s,
      createdAt: tokenSetup.c,
    }
  }

  private createSetupToken(userId: string, secret: string, createdAt: number): string {
    const payload: SerializedSetup = { u: userId, s: secret, c: createdAt }
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', this.getSetupTokenSecret())
      .update(encodedPayload)
      .digest('base64url')
    return `${encodedPayload}.${signature}`
  }

  private readSetupToken(token: string): SerializedSetup | null {
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [encodedPayload, signature] = parts
    const expectedSignature = createHmac('sha256', this.getSetupTokenSecret())
      .update(encodedPayload)
      .digest('base64url')

    const expectedBuffer = Buffer.from(expectedSignature)
    const signatureBuffer = Buffer.from(signature)
    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return null
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf-8'),
      ) as Partial<SerializedSetup>

      if (
        typeof parsed.u !== 'string' ||
        typeof parsed.s !== 'string' ||
        typeof parsed.c !== 'number'
      ) {
        return null
      }

      return { u: parsed.u, s: parsed.s, c: parsed.c }
    } catch {
      return null
    }
  }

  private getSetupTokenSecret(): string {
    return (
      process.env.SECURITY_MFA_SETUP_SECRET ??
      process.env.AUTH_JWT_SECRET ??
      process.env.JWT_SECRET ??
      'open-mercato-security-mfa-setup'
    )
  }
}

export default TotpProvider
