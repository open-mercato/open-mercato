import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { MfaMethodRecord, MfaProviderInterface } from '../mfa-provider-interface'

const SETUP_TTL_MS = 10 * 60 * 1000
const CHALLENGE_TTL_MS = 5 * 60 * 1000

const setupPayloadSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
})

const confirmPayloadSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  challenge: z.string().min(1),
  transports: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).max(100).optional(),
})

const verifyPayloadSchema = z.object({
  credentialId: z.string().min(1),
  challenge: z.string().min(1),
})

type PendingSetup = {
  userId: string
  challenge: string
  label?: string
  createdAt: number
}

type PendingChallenge = {
  userId: string
  challenge: string
  createdAt: number
}

export class PasskeyProvider implements MfaProviderInterface {
  readonly type = 'passkey'
  readonly label = 'Passkey'
  readonly icon = 'Key'
  readonly allowMultiple = true
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = verifyPayloadSchema

  private readonly pendingSetups = new Map<string, PendingSetup>()
  private readonly pendingChallenges = new Map<string, PendingChallenge>()

  async setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const setupId = randomBytes(16).toString('hex')
    const challenge = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.cleanupExpiredSetups(now)
    this.pendingSetups.set(setupId, {
      userId,
      challenge,
      label: parsed.label,
      createdAt: now,
    })
    return {
      setupId,
      clientData: {
        challenge,
        rpName: 'Open Mercato',
        userId,
        label: parsed.label ?? 'Passkey',
        authenticatorAttachment: parsed.authenticatorAttachment,
      },
    }
  }

  async confirmSetup(
    userId: string,
    setupId: string,
    payload: unknown,
  ): Promise<{ metadata: Record<string, unknown> }> {
    const parsed = confirmPayloadSchema.parse(payload)
    const pending = this.pendingSetups.get(setupId)
    if (!pending || pending.userId !== userId) {
      throw new Error('Passkey setup session not found')
    }
    if (Date.now() - pending.createdAt > SETUP_TTL_MS) {
      this.pendingSetups.delete(setupId)
      throw new Error('Passkey setup session expired')
    }
    if (parsed.challenge !== pending.challenge) {
      throw new Error('Invalid passkey setup challenge')
    }
    this.pendingSetups.delete(setupId)
    return {
      metadata: {
        credentialId: parsed.credentialId,
        publicKey: parsed.publicKey,
        transports: parsed.transports ?? [],
        label: parsed.label ?? pending.label ?? 'Passkey',
      },
    }
  }

  async prepareChallenge(userId: string, method: MfaMethodRecord): Promise<{ clientData?: Record<string, unknown> }> {
    if (method.userId !== userId) {
      throw new Error('MFA method does not belong to user')
    }
    const credentialId = method.providerMetadata?.credentialId
    if (typeof credentialId !== 'string' || credentialId.length === 0) {
      throw new Error('Passkey credential is not configured')
    }
    const challenge = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.cleanupExpiredChallenges(now)
    this.pendingChallenges.set(method.id, {
      userId,
      challenge,
      createdAt: now,
    })
    return {
      clientData: {
        challenge,
        credentialId,
      },
    }
  }

  async verify(userId: string, method: MfaMethodRecord, payload: unknown): Promise<boolean> {
    const parsed = verifyPayloadSchema.parse(payload)
    if (method.userId !== userId) return false
    const metadataCredentialId = method.providerMetadata?.credentialId
    if (typeof metadataCredentialId !== 'string' || metadataCredentialId !== parsed.credentialId) {
      return false
    }
    const pending = this.pendingChallenges.get(method.id)
    if (!pending || pending.userId !== userId) return false
    if (Date.now() - pending.createdAt > CHALLENGE_TTL_MS) {
      this.pendingChallenges.delete(method.id)
      return false
    }
    if (pending.challenge !== parsed.challenge) return false
    this.pendingChallenges.delete(method.id)
    return true
  }

  private cleanupExpiredSetups(now: number): void {
    for (const [setupId, setup] of this.pendingSetups.entries()) {
      if (now - setup.createdAt > SETUP_TTL_MS) {
        this.pendingSetups.delete(setupId)
      }
    }
  }

  private cleanupExpiredChallenges(now: number): void {
    for (const [methodId, challenge] of this.pendingChallenges.entries()) {
      if (now - challenge.createdAt > CHALLENGE_TTL_MS) {
        this.pendingChallenges.delete(methodId)
      }
    }
  }
}

export default PasskeyProvider
