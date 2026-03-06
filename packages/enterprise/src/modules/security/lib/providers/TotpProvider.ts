import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { MfaMethodRecord, MfaProviderInterface } from '../mfa-provider-interface'

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_WINDOW = 1
const SETUP_TTL_MS = 10 * 60 * 1000

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

export class TotpProvider implements MfaProviderInterface {
  readonly type = 'totp'
  readonly label = 'Authenticator App'
  readonly icon = 'Smartphone'
  readonly allowMultiple = true
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = confirmPayloadSchema

  private readonly pendingSetups = new Map<string, PendingSetup>()

  async setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const setupId = randomBytes(16).toString('hex')
    const secret = this.generateSecret()
    const label = parsed.label ?? userId
    const issuer = parsed.issuer ?? 'Open Mercato'
    const uri = this.buildOtpAuthUri(secret, issuer, label)
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
        qrDataUrl: uri,
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
    const setup = this.pendingSetups.get(setupId)
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

  async prepareChallenge(): Promise<{ clientData?: Record<string, unknown> }> {
    return {}
  }

  async verify(userId: string, method: MfaMethodRecord, payload: unknown): Promise<boolean> {
    const parsed = confirmPayloadSchema.parse(payload)
    if (method.userId !== userId) return false
    const secretValue = method.providerMetadata?.secret
    if (typeof secretValue !== 'string' || secretValue.length === 0) return false
    return this.verifyTotpCode(secretValue, parsed.code)
  }

  private generateSecret(): string {
    return randomBytes(20).toString('base64')
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
    const key = Buffer.from(secret, 'base64')
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

  private cleanupExpiredSetups(now: number): void {
    for (const [setupId, setup] of this.pendingSetups.entries()) {
      if (now - setup.createdAt > SETUP_TTL_MS) {
        this.pendingSetups.delete(setupId)
      }
    }
  }
}

export default TotpProvider
