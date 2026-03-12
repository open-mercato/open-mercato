import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { z } from 'zod'
import type {
  MfaMethodRecord,
  MfaProviderConfirmResult,
  MfaProviderInterface,
  MfaProviderRuntimeContext,
  MfaProviderUser,
  MfaVerifyContext,
} from '../mfa-provider-interface'
import type { SecurityModuleConfig } from '../security-config'
import {
  readSecurityModuleConfig,
  readSecuritySetupTokenSecret,
  resolveSecurityModuleConfigForRequest,
} from '../security-config'

const SETUP_TOKEN_VERSION = 'v1'

const setupPayloadSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  userName: z.string().min(1).max(255).optional(),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
})

const setupConfirmationPayloadSchema = z.union([
  z.object({
    response: z.record(z.string(), z.unknown()),
    label: z.string().min(1).max(100).optional(),
  }),
  z.object({
    credentialId: z.string().min(1),
    publicKey: z.string().min(1),
    challenge: z.string().min(1),
    transports: z.array(z.string().min(1)).optional(),
    label: z.string().min(1).max(100).optional(),
  }),
])

const verifyPayloadSchema = z.union([
  z.object({
    response: z.record(z.string(), z.unknown()),
  }),
  z.object({
    credentialId: z.string().min(1),
    challenge: z.string().min(1),
  }),
])

const setupTokenSchema = z.object({
  version: z.string().min(1),
  userId: z.string().min(1),
  challenge: z.string().min(1),
  label: z.string().min(1).max(100).optional(),
  createdAt: z.number().int().nonnegative(),
  nonce: z.string().min(1),
})

type PendingSetup = {
  version: string
  userId: string
  challenge: string
  label?: string
  createdAt: number
  nonce: string
}

const verifyContextSchema = z.object({
  challenge: z.object({
    challenge: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  }),
})

const AUTHENTICATOR_TRANSPORTS: AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]

export class PasskeyProvider implements MfaProviderInterface {
  readonly type = 'passkey'
  readonly label = 'Passkey'
  readonly icon = 'Key'
  readonly allowMultiple = true
  readonly setupSchema = setupPayloadSchema
  readonly verifySchema = verifyPayloadSchema

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
      ...(parsed.userName || email.length === 0 ? {} : { userName: email }),
    }
  }

  async setup(
    userId: string,
    payload: unknown,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const parsed = setupPayloadSchema.parse(payload ?? {})
    const userName = parsed.userName ?? parsed.label ?? userId
    const userDisplayName = parsed.label ?? parsed.userName ?? userId
    const securityConfig = this.resolveSecurityConfig(context)
    const options = await generateRegistrationOptions({
      rpName: this.getRpName(securityConfig),
      rpID: this.getRpId(securityConfig),
      userID: this.toWebAuthnUserId(userId),
      userName,
      userDisplayName,
      timeout: securityConfig.webauthn.setupTtlMs,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
        ...(parsed.authenticatorAttachment ? { authenticatorAttachment: parsed.authenticatorAttachment } : {}),
      },
    })

    const now = Date.now()
    const setupId = this.createSetupToken({
      version: SETUP_TOKEN_VERSION,
      userId,
      challenge: options.challenge,
      label: parsed.label,
      createdAt: now,
      nonce: randomBytes(16).toString('hex'),
    })

    return {
      setupId,
      clientData: options as unknown as Record<string, unknown>,
    }
  }

  async confirmSetup(
    userId: string,
    setupId: string,
    payload: unknown,
    context?: MfaProviderRuntimeContext,
  ): Promise<MfaProviderConfirmResult> {
    const parsed = setupConfirmationPayloadSchema.parse(payload)
    const pending = this.readSetupToken(setupId)
    const securityConfig = this.resolveSecurityConfig(context)
    if (!pending || pending.version !== SETUP_TOKEN_VERSION || pending.userId !== userId) {
      throw new Error('Passkey setup session not found')
    }
    if (Date.now() - pending.createdAt > securityConfig.webauthn.setupTtlMs) {
      throw new Error('Passkey setup session expired')
    }

    if ('response' in parsed) {
      const verification = await verifyRegistrationResponse({
        response: parsed.response as never,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.getExpectedOrigins(securityConfig),
        expectedRPID: this.getRpId(securityConfig),
        requireUserVerification: false,
      })

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Passkey registration verification failed')
      }

      const registrationInfo = verification.registrationInfo as {
        credential?: {
          id: string
          publicKey: Uint8Array
          counter: number
          transports?: string[]
        }
        credentialID?: string
        credentialPublicKey?: Uint8Array
        counter?: number
      }

      const credentialId = registrationInfo.credential?.id ?? registrationInfo.credentialID
      const publicKeyBytes = registrationInfo.credential?.publicKey ?? registrationInfo.credentialPublicKey
      const counter = registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0
      const transports = this.normalizeTransports(registrationInfo.credential?.transports)

      if (!credentialId || !publicKeyBytes) {
        throw new Error('Passkey registration did not return credential data')
      }

      return {
        metadata: {
          credentialId,
          credentialPublicKey: this.bytesToBase64Url(publicKeyBytes),
          counter,
          transports,
          label: parsed.label ?? pending.label ?? 'Passkey',
        },
      }
    }

    if (parsed.challenge !== pending.challenge) {
      throw new Error('Invalid passkey setup challenge')
    }

    return {
      metadata: {
        credentialId: parsed.credentialId,
        credentialPublicKey: parsed.publicKey,
        counter: 0,
        transports: parsed.transports ?? [],
        label: parsed.label ?? pending.label ?? 'Passkey',
      },
    }
  }

  async prepareChallenge(
    userId: string,
    method: MfaMethodRecord,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ clientData?: Record<string, unknown>; verifyContext?: MfaVerifyContext }> {
    if (method.userId !== userId) {
      throw new Error('MFA method does not belong to user')
    }

    const metadata = method.providerMetadata ?? {}
    const credentialId = typeof metadata.credentialId === 'string' ? metadata.credentialId : null
    if (!credentialId) {
      throw new Error('Passkey credential is not configured')
    }

    const securityConfig = this.resolveSecurityConfig(context)
    const options = await generateAuthenticationOptions({
      rpID: this.getRpId(securityConfig),
      userVerification: 'preferred',
      timeout: securityConfig.webauthn.challengeTtlMs,
      allowCredentials: [{
        id: credentialId,
        transports: this.normalizeTransports(metadata.transports),
      }],
    })

    const now = Date.now()

    return {
      clientData: options as unknown as Record<string, unknown>,
      verifyContext: {
        challenge: {
          challenge: options.challenge,
          createdAt: now,
        },
      },
    }
  }

  async verify(
    userId: string,
    method: MfaMethodRecord,
    payload: unknown,
    context?: MfaVerifyContext,
    runtimeContext?: MfaProviderRuntimeContext,
  ): Promise<boolean> {
    const parsed = verifyPayloadSchema.parse(payload)
    if (method.userId !== userId) return false

    const parsedContext = verifyContextSchema.safeParse(context)
    const securityConfig = this.resolveSecurityConfig(runtimeContext)
    if (!parsedContext.success) {
      if ('credentialId' in parsed) {
        const metadataCredentialId = method.providerMetadata?.credentialId
        return typeof metadataCredentialId === 'string' && metadataCredentialId === parsed.credentialId
      }
      return false
    }
    const pending = parsedContext.data.challenge
    if (Date.now() - pending.createdAt > securityConfig.webauthn.challengeTtlMs) {
      return false
    }

    if ('response' in parsed) {
      const metadata = method.providerMetadata ?? {}
      const credentialId = typeof metadata.credentialId === 'string' ? metadata.credentialId : null
      const credentialPublicKey = typeof metadata.credentialPublicKey === 'string'
        ? metadata.credentialPublicKey
        : typeof metadata.publicKey === 'string'
          ? metadata.publicKey
          : null
      const counter = typeof metadata.counter === 'number' && Number.isFinite(metadata.counter)
        ? metadata.counter
        : 0

      if (!credentialId || !credentialPublicKey) {
        return false
      }

      const verification = await verifyAuthenticationResponse({
        response: parsed.response as never,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.getExpectedOrigins(securityConfig),
        expectedRPID: this.getRpId(securityConfig),
        requireUserVerification: false,
        credential: {
          id: credentialId,
          publicKey: this.base64UrlToBytes(credentialPublicKey),
          counter,
          transports: this.normalizeTransports(metadata.transports),
        },
      })

      if (!verification.verified) {
        return false
      }

      const nextCounter = verification.authenticationInfo?.newCounter
      if (typeof nextCounter === 'number' && Number.isFinite(nextCounter)) {
        const providerMetadata = method.providerMetadata ?? {}
        providerMetadata.counter = nextCounter
        method.providerMetadata = providerMetadata
      }

      return true
    }

    const metadataCredentialId = method.providerMetadata?.credentialId
    if (typeof metadataCredentialId !== 'string' || metadataCredentialId !== parsed.credentialId) {
      return false
    }
    if (pending.challenge !== parsed.challenge) {
      return false
    }

    return true
  }

  private normalizeTransports(raw: unknown): AuthenticatorTransportFuture[] {
    if (!Array.isArray(raw)) return []
    return raw.filter((value: unknown): value is AuthenticatorTransportFuture =>
      typeof value === 'string' && AUTHENTICATOR_TRANSPORTS.includes(value as AuthenticatorTransportFuture),
    )
  }

  private bytesToBase64Url(value: Uint8Array): string {
    return Buffer.from(value).toString('base64url')
  }

  private base64UrlToBytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64url'))
  }

  private createSetupToken(setup: PendingSetup): string {
    const encodedPayload = Buffer.from(JSON.stringify(setup), 'utf8').toString('base64url')
    const signature = this.signSetupPayload(encodedPayload)
    return `${encodedPayload}.${signature}`
  }

  private readSetupToken(token: string): PendingSetup | null {
    const [encodedPayload, signature, ...extra] = token.split('.')
    if (!encodedPayload || !signature || extra.length > 0) {
      return null
    }

    const expectedSignature = this.signSetupPayload(encodedPayload)
    const providedBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null
    }

    try {
      const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
      const parsed = JSON.parse(raw)
      const result = setupTokenSchema.safeParse(parsed)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  private signSetupPayload(encodedPayload: string): string {
    return createHmac('sha256', this.getSetupTokenSecret()).update(encodedPayload).digest('base64url')
  }

  private getSetupTokenSecret(): string {
    return this.setupTokenSecret
  }

  private getRpName(securityConfig: SecurityModuleConfig): string {
    return securityConfig.webauthn.rpName
  }

  private getRpId(securityConfig: SecurityModuleConfig): string {
    return securityConfig.webauthn.rpId
  }

  private getExpectedOrigins(securityConfig: SecurityModuleConfig): string[] {
    return [...securityConfig.webauthn.expectedOrigins]
  }

  private resolveSecurityConfig(context?: MfaProviderRuntimeContext): SecurityModuleConfig {
    return resolveSecurityModuleConfigForRequest(this.securityConfig, context?.request)
  }

  private toWebAuthnUserId(userId: string): Uint8Array {
    return new TextEncoder().encode(userId)
  }
}

export default PasskeyProvider
