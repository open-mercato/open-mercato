import crypto from 'node:crypto'
import { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import type { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SsoConfig } from '../data/entities'
import type { SsoProviderRegistry } from '../lib/registry'
import type { AccountLinkingService } from './accountLinkingService'
import type { SsoAuthService } from './ssoAuthService'
import { encryptStateCookie, decryptStateCookie, createFlowState } from '../lib/state-cookie'
import { emitSsoEvent } from '../events'
import { isSsoRolesRevokedError } from '../lib/errors'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { issueStaffSessionToken } from '../../../lib/staffSessionToken'

const logger = createLogger('sso').child({ component: 'service' })
const millisecondsPerDay = 24 * 60 * 60 * 1000

export class SsoService {
  constructor(
    private em: EntityManager,
    private ssoProviderRegistry: SsoProviderRegistry,
    private accountLinkingService: AccountLinkingService,
    private tenantEncryptionService: TenantDataEncryptionService,
    private authService: AuthService & Pick<SsoAuthService, 'createSession'>,
    private rbacService: RbacService,
  ) {}

  async findConfigByEmail(email: string): Promise<SsoConfig | null> {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return null

    const configs = await findWithDecryption(
      this.em,
      SsoConfig,
      { isActive: true, deletedAt: null },
      {},
      { tenantId: null },
    )
    const matches = configs.filter((c) => c.allowedDomains.some((d) => d.toLowerCase() === domain))
    return matches.length === 1 ? matches[0]! : null
  }

  async initiateLogin(
    configId: string,
    returnUrl: string,
    redirectUri: string,
  ): Promise<{ redirectUrl: string; stateCookie: string }> {
    const config = await findOneWithDecryption(
      this.em,
      SsoConfig,
      { id: configId, isActive: true, deletedAt: null },
      {},
      { tenantId: null },
    )
    if (!config) throw new Error('[internal] SSO configuration not found or inactive')

    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) throw new Error(`[internal] No provider registered for protocol: ${config.protocol}`)

    const clientSecret = await this.decryptClientSecret(config)

    const { state } = createFlowState({ configId, returnUrl })

    void emitSsoEvent('sso.login.initiated', {
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    const authUrl = await provider.buildAuthUrl(config, {
      state: state.state,
      nonce: state.nonce,
      redirectUri,
      codeVerifier: state.codeVerifier,
      clientSecret,
    })

    const stateCookie = encryptStateCookie(state)
    return { redirectUrl: authUrl, stateCookie }
  }

  async handleOidcCallback(
    callbackParams: Record<string, string>,
    stateCookie: string,
    redirectUri: string,
  ): Promise<{
    token: string
    sessionToken: string
    sessionExpiresAt: Date
    redirectUrl: string
    tenantId: string | null
    organizationId: string
  }> {
    const flowState = decryptStateCookie(stateCookie)
    if (!flowState) throw new Error('[internal] Invalid or expired SSO state')

    const receivedState = Buffer.from(callbackParams.state || '')
    const expectedState = Buffer.from(flowState.state)
    if (receivedState.length !== expectedState.length || !crypto.timingSafeEqual(receivedState, expectedState)) {
      throw new Error('[internal] State mismatch — possible CSRF attack')
    }

    const config = await findOneWithDecryption(
      this.em,
      SsoConfig,
      { id: flowState.configId, isActive: true, deletedAt: null },
      {},
      { tenantId: null },
    )
    if (!config) throw new Error('[internal] SSO configuration no longer active')

    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) throw new Error(`[internal] No provider for protocol: ${config.protocol}`)

    const clientSecret = await this.decryptClientSecret(config)

    const configUpdatedAt = config.updatedAt instanceof Date ? config.updatedAt.getTime() : Number.NaN
    const idpPayload = await provider.handleCallback(config, {
      callbackParams,
      redirectUri,
      expectedState: flowState.state,
      expectedNonce: flowState.nonce,
      codeVerifier: flowState.codeVerifier,
      clientSecret,
    })

    let user: User
    try {
      ;({ user } = await this.accountLinkingService.resolveUser(config, idpPayload, config.tenantId ?? '', configUpdatedAt))
    } catch (err) {
      if (isSsoRolesRevokedError(err)) await this.rbacService.invalidateUserCache(err.userId)
      throw err
    }

    const { token, sessionToken, sessionExpiresAt, tenantId } =
      await this.issueLinkedAccountSession(user, config, configUpdatedAt)

    void emitSsoEvent('sso.login.completed', {
      id: String(user.id),
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    return {
      token,
      sessionToken,
      sessionExpiresAt,
      redirectUrl: flowState.returnUrl || '/backend',
      tenantId,
      organizationId: config.organizationId,
    }
  }

  private async issueLinkedAccountSession(account: User, config: SsoConfig, configUpdatedAt: number) {
    const subject = String(account.id)
    await this.rbacService.invalidateUserCache(subject)
    const tenantId = account.tenantId ?? null
    const roles = await this.authService.getUserRoles(account, tenantId || null)
    await this.authService.updateLastLoginAt(account)

    const sessionLifetime = Number(process.env.REMEMBER_ME_DAYS || '30') * millisecondsPerDay
    const sessionExpiresAt = new Date(Date.now() + sessionLifetime)
    // Persist the session through the locked auth service before signing its access token.
    const { session, token: sessionToken } = await this.authService.createSession(account, sessionExpiresAt, {
      tenantId,
      organizationId: config.organizationId,
      ssoConfigId: config.id,
      configUpdatedAt,
    })
    const token = issueStaffSessionToken({
      subject,
      sessionId: String(session.id),
      tenantId: tenantId || null,
      organizationId: account.organizationId ? String(account.organizationId) : null,
      email: account.email,
      roles,
    })
    return { token, sessionToken, sessionExpiresAt, tenantId }
  }

  private async decryptClientSecret(config: SsoConfig): Promise<string | undefined> {
    if (!config.clientSecretEnc) return undefined

    const decrypted = await this.tenantEncryptionService.decryptEntityPayload(
      config.id,
      { clientSecretEnc: config.clientSecretEnc },
      config.tenantId,
      config.organizationId,
    )
    return (decrypted.clientSecretEnc as string) ?? undefined
  }
}
