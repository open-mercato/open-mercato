import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type {
  MfaMethodRecord,
  MfaProviderInterface,
  MfaProviderUser,
  MfaVerifyContext,
} from '../mfa-provider-interface'
import { generateOtpCode, hashOtpCode, verifyOtpCode } from '../otp'
import OtpCodeEmail from '../../emails/otp-code'
import type { SecurityModuleConfig } from '../security-config'
import { readSecurityModuleConfig } from '../security-config'

const setupPayloadSchema = z.object({
  email: z.string().email().optional(),
  label: z.string().min(1).max(100).optional(),
})

const confirmPayloadSchema = z.object({
  email: z.string().email().optional(),
  label: z.string().min(1).max(100).optional(),
})

const verifyPayloadSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
})

type PendingSetup = {
  userId: string
  email?: string
  label?: string
  createdAt: number
}

type PendingOtpChallenge = {
  userId: string
  codeHash: string
  createdAt: number
}

type OtpVerifyChallenge = {
  userId: string
  methodId: string
  codeHash: string
  createdAt: number
}

export class OtpEmailProvider implements MfaProviderInterface {
  readonly type = 'otp_email'
  readonly label = 'Email OTP'
  readonly icon = 'Mail'
  readonly allowMultiple = false
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = verifyPayloadSchema

  private readonly pendingSetups = new Map<string, PendingSetup>()
  private readonly pendingChallenges = new Map<string, PendingOtpChallenge>()

  constructor(
    private readonly securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
  ) {}

  resolveSetupPayload(user: MfaProviderUser, payload: unknown): unknown {
    const parsed = setupPayloadSchema.partial().parse(payload ?? {})
    if (parsed.email) {
      return parsed
    }

    const email = typeof user.email === 'string' ? user.email.trim() : ''
    if (email.length === 0) {
      throw new Error('Unable to configure Email OTP without a destination email')
    }

    return {
      ...parsed,
      email,
    }
  }

  async setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const setupId = randomBytes(16).toString('hex')
    const now = Date.now()
    this.cleanupExpiredSetups(now)
    this.pendingSetups.set(setupId, {
      userId,
      email: parsed.email,
      label: parsed.label,
      createdAt: now,
    })
    return {
      setupId,
      clientData: {
        channel: 'email',
        emailHint: this.maskEmail(parsed.email),
      },
    }
  }

  async confirmSetup(
    userId: string,
    setupId: string,
    payload: unknown,
  ): Promise<{ metadata: Record<string, unknown> }> {
    const parsed = confirmPayloadSchema.parse(payload ?? {})
    const pending = this.pendingSetups.get(setupId)
    if (!pending || pending.userId !== userId) {
      throw new Error('Email OTP setup session not found')
    }
    if (Date.now() - pending.createdAt > this.securityConfig.otpEmail.setupTtlMs) {
      this.pendingSetups.delete(setupId)
      throw new Error('Email OTP setup session expired')
    }
    this.pendingSetups.delete(setupId)
    const email = parsed.email ?? pending.email
    return {
      metadata: {
        email,
        label: parsed.label ?? pending.label ?? 'Email OTP',
      },
    }
  }

  async prepareChallenge(
    userId: string,
    method: MfaMethodRecord,
  ): Promise<{ clientData?: Record<string, unknown>; verifyContext?: MfaVerifyContext }> {
    if (method.userId !== userId) {
      throw new Error('MFA method does not belong to user')
    }
    const code = generateOtpCode()
    const codeHash = await hashOtpCode(code)
    const now = Date.now()
    this.cleanupExpiredChallenges(now)
    const challengeTtlMs = this.securityConfig.otpEmail.challengeTtlMs
    const challenge: OtpVerifyChallenge = {
      userId,
      methodId: method.id,
      codeHash,
      createdAt: now,
    }
    this.pendingChallenges.set(method.id, challenge)
    const emailValue = method.providerMetadata?.email
    const email = typeof emailValue === 'string' ? emailValue : undefined
    if (!email) {
      throw new Error('Email OTP method is missing a destination email address')
    }

    await sendEmail({
      to: email,
      subject: this.securityConfig.otpEmail.subject,
      react: OtpCodeEmail({
        code,
        expiresInMinutes: Math.max(1, Math.ceil(challengeTtlMs / (60 * 1000))),
      }),
    })

    const exposeCode = parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
    return {
      clientData: {
        channel: 'email',
        emailHint: this.maskEmail(email),
        ...(exposeCode ? { code } : {}),
        expiresAt: new Date(now + challengeTtlMs).toISOString(),
      },
      verifyContext: {
        challenge,
      },
    }
  }

  async verify(
    userId: string,
    method: MfaMethodRecord,
    payload: unknown,
    context?: MfaVerifyContext,
  ): Promise<boolean> {
    const parsed = verifyPayloadSchema.parse(payload)
    if (method.userId !== userId) return false
    const challenge = this.readChallengeContext(context, userId, method.id)
      ?? this.pendingChallenges.get(method.id)
    if (!challenge || challenge.userId !== userId) return false
    if (Date.now() - challenge.createdAt > this.securityConfig.otpEmail.challengeTtlMs) {
      this.pendingChallenges.delete(method.id)
      return false
    }
    const valid = await verifyOtpCode(parsed.code, challenge.codeHash)
    if (valid) {
      this.pendingChallenges.delete(method.id)
    }
    return valid
  }

  private cleanupExpiredSetups(now: number): void {
    for (const [setupId, setup] of this.pendingSetups.entries()) {
      if (now - setup.createdAt > this.securityConfig.otpEmail.setupTtlMs) {
        this.pendingSetups.delete(setupId)
      }
    }
  }

  private cleanupExpiredChallenges(now: number): void {
    for (const [methodId, challenge] of this.pendingChallenges.entries()) {
      if (now - challenge.createdAt > this.securityConfig.otpEmail.challengeTtlMs) {
        this.pendingChallenges.delete(methodId)
      }
    }
  }

  private maskEmail(email?: string): string | undefined {
    if (!email) return undefined
    const [localPart, domain] = email.split('@')
    if (!localPart || !domain) return undefined
    if (localPart.length <= 2) return `${localPart[0] ?? '*'}*@${domain}`
    return `${localPart.slice(0, 2)}***@${domain}`
  }

  private readChallengeContext(
    context: MfaVerifyContext | undefined,
    userId: string,
    methodId: string,
  ): OtpVerifyChallenge | null {
    const challenge = context?.challenge
    if (!challenge || typeof challenge !== 'object') return null

    const challengeUserId = challenge.userId
    const challengeMethodId = challenge.methodId
    const challengeCodeHash = challenge.codeHash
    const challengeCreatedAt = challenge.createdAt

    if (
      typeof challengeUserId !== 'string' ||
      typeof challengeMethodId !== 'string' ||
      typeof challengeCodeHash !== 'string' ||
      typeof challengeCreatedAt !== 'number'
    ) {
      return null
    }

    if (challengeUserId !== userId || challengeMethodId !== methodId) {
      return null
    }

    return {
      userId: challengeUserId,
      methodId: challengeMethodId,
      codeHash: challengeCodeHash,
      createdAt: challengeCreatedAt,
    }
  }
}

export default OtpEmailProvider
