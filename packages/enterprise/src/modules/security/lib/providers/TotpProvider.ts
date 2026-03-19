import { createHmac, timingSafeEqual } from 'node:crypto'
import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'
import { z } from 'zod'
import type {
  MfaMethodRecord,
  MfaProviderConfirmResult,
  MfaProviderInterface,
  MfaProviderUser,
  MfaVerifyContext,
} from '../mfa-provider-interface'
import type { SecurityModuleConfig } from '../security-config'
import { readSecurityModuleConfig, readSecuritySetupTokenSecret } from '../security-config'

const TOTP_ALGORITHM = 'SHA1'
const TOTP_SECRET_SIZE_BYTES = 20

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
  readonly allowMultiple = false
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = confirmPayloadSchema

  private readonly pendingSetups = new Map<string, PendingSetup>()

  constructor(
    private readonly securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
    private readonly setupTokenSecret: string = readSecuritySetupTokenSecret(),
  ) {}

  resolveSetupPayload(user: MfaProviderUser, payload: unknown): unknown {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const email = typeof user.email === 'string' ? user.email.trim() : ''

    return {
      ...parsed,
      ...(parsed.label || email.length === 0 ? {} : { label: email }),
    }
  }

  async setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const secret = this.generateSecret()
    const setupId = this.createSetupToken(userId, secret, Date.now())
    const label = parsed.label ?? userId
    const issuer = parsed.issuer ?? this.securityConfig.totp.issuer
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
  ): Promise<MfaProviderConfirmResult> {
    const parsed = confirmPayloadSchema.parse(payload)
    const setup = this.resolveSetup(setupId)
    if (!setup || setup.userId !== userId) {
      throw new Error('TOTP setup session not found')
    }
    if (Date.now() - setup.createdAt > this.securityConfig.totp.setupTtlMs) {
      this.pendingSetups.delete(setupId)
      throw new Error('TOTP setup session expired')
    }
    const valid = this.verifyTotpCode(setup.secret, parsed.code)
    if (!valid) {
      throw new Error('Invalid TOTP code')
    }
    this.pendingSetups.delete(setupId)
    return {
      metadata: {},
      secret: setup.secret,
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
    const secretValue = this.readStoredSecret(method)
    if (!secretValue) return false
    return this.verifyTotpCode(secretValue, parsed.code)
  }

  private generateSecret(): string {
    return new Secret({ size: TOTP_SECRET_SIZE_BYTES }).base32
  }

  private buildOtpAuthUri(secret: string, issuer: string, label: string): string {
    return new TOTP({
      issuer,
      label,
      secret: this.parseSecret(secret),
      algorithm: TOTP_ALGORITHM,
      digits: this.securityConfig.totp.digits,
      period: this.securityConfig.totp.periodSeconds,
    }).toString()
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    try {
      const totp = new TOTP({
        secret: this.parseSecret(secret),
        algorithm: TOTP_ALGORITHM,
        digits: this.securityConfig.totp.digits,
        period: this.securityConfig.totp.periodSeconds,
      })
      return totp.validate({
        token: code,
        timestamp: Date.now(),
        window: this.securityConfig.totp.window,
      }) !== null
    } catch {
      return false
    }
  }

  private cleanupExpiredSetups(now: number): void {
    for (const [setupId, setup] of this.pendingSetups.entries()) {
      if (now - setup.createdAt > this.securityConfig.totp.setupTtlMs) {
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

    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')
    const signatureBuffer = Buffer.from(signature, 'base64url')
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

  private readStoredSecret(method: MfaMethodRecord): string | null {
    const currentSecret = typeof method.secret === 'string'
      ? method.secret.trim()
      : ''
    if (currentSecret.length > 0) {
      return currentSecret
    }

    const legacySecret = method.providerMetadata?.secret
    if (typeof legacySecret === 'string') {
      const normalized = legacySecret.trim()
      if (normalized.length > 0) {
        return normalized
      }
    }

    return null
  }

  private parseSecret(secret: string): Secret {
    const normalized = secret.trim().replaceAll(' ', '').replaceAll('-', '').toUpperCase()
    if (normalized.length === 0) {
      throw new Error('Invalid empty TOTP secret')
    }
    return Secret.fromBase32(normalized)
  }

  private getSetupTokenSecret(): string {
    return this.setupTokenSecret
  }
}

export default TotpProvider
