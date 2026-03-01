import crypto from 'node:crypto'
import { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SsoConfig } from '../data/entities'
import type { SsoProviderRegistry } from '../lib/registry'
import type { AccountLinkingService } from './accountLinkingService'
import { encryptStateCookie, decryptStateCookie, createFlowState } from '../lib/state-cookie'
import { emitSsoEvent } from '../events'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

export class SsoService {
  constructor(
    private em: EntityManager,
    private ssoProviderRegistry: SsoProviderRegistry,
    private accountLinkingService: AccountLinkingService,
    private tenantEncryptionService: TenantDataEncryptionService,
    private authService: AuthService,
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
    return configs.find((c) => c.allowedDomains.some((d) => d.toLowerCase() === domain)) ?? null
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
    if (!config) throw new Error('SSO configuration not found or inactive')

    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) throw new Error(`No provider registered for protocol: ${config.protocol}`)

    const clientSecret = await this.decryptClientSecret(config)

    const { state } = createFlowState({ configId, returnUrl })

    void emitSsoEvent('sso.login.initiated', {
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch(() => undefined)

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
    if (!flowState) throw new Error('Invalid or expired SSO state')

    const receivedState = Buffer.from(callbackParams.state || '')
    const expectedState = Buffer.from(flowState.state)
    if (receivedState.length !== expectedState.length || !crypto.timingSafeEqual(receivedState, expectedState)) {
      throw new Error('State mismatch — possible CSRF attack')
    }

    const config = await findOneWithDecryption(
      this.em,
      SsoConfig,
      { id: flowState.configId, isActive: true, deletedAt: null },
      {},
      { tenantId: null },
    )
    if (!config) throw new Error('SSO configuration no longer active')

    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) throw new Error(`No provider for protocol: ${config.protocol}`)

    const clientSecret = await this.decryptClientSecret(config)

    const idpPayload = await provider.handleCallback(config, {
      callbackParams,
      redirectUri,
      expectedState: flowState.state,
      expectedNonce: flowState.nonce,
      codeVerifier: flowState.codeVerifier,
      clientSecret,
    })

    const tenantId = config.tenantId ?? ''
    const { user } = await this.accountLinkingService.resolveUser(config, idpPayload, tenantId)

    await this.rbacService.invalidateUserCache(String(user.id))

    const roles = await this.authService.getUserRoles(user, tenantId || null)
    const token = signJwt({
      sub: String(user.id),
      tenantId: tenantId || null,
      orgId: user.organizationId ? String(user.organizationId) : null,
      email: user.email,
      roles,
    })

    await this.authService.updateLastLoginAt(user)

    const days = Number(process.env.REMEMBER_ME_DAYS || '30')
    const sessionExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const session = await this.authService.createSession(user, sessionExpiresAt)

    void emitSsoEvent('sso.login.completed', {
      id: String(user.id),
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch(() => undefined)

    return {
      token,
      sessionToken: session.token,
      sessionExpiresAt,
      redirectUrl: flowState.returnUrl || '/backend',
      tenantId: config.tenantId ?? null,
      organizationId: config.organizationId,
    }
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
