import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SsoConfig } from './data/entities'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sso.*'],
    admin: ['sso.config.view', 'sso.config.manage'],
  },

  async seedDefaults({ em, tenantId, organizationId, container }) {
    if (process.env.NODE_ENV !== 'development') return
    if (process.env.SSO_DEV_SEED !== 'true') return

    const clientSecret = process.env.SSO_DEV_CLIENT_SECRET
    if (!clientSecret) return

    const domains = (process.env.SSO_DEV_ALLOWED_DOMAINS || 'example.com')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)

    const existing = await em.findOne(SsoConfig, { organizationId })
    if (existing) {
      existing.allowedDomains = domains
      await em.flush()
      return
    }

    const encryptionService = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
    const encrypted = await encryptionService.encryptEntityPayload(
      'SsoConfig',
      { clientSecretEnc: clientSecret },
      tenantId,
      organizationId,
    )

    const config = em.create(SsoConfig, {
      tenantId,
      organizationId,
      protocol: 'oidc',
      issuer: process.env.SSO_DEV_ISSUER || 'http://localhost:8080/realms/open-mercato',
      clientId: process.env.SSO_DEV_CLIENT_ID || 'open-mercato-app',
      clientSecretEnc: encrypted.clientSecretEnc as string,
      allowedDomains: domains,
      jitEnabled: true,
      autoLinkByEmail: true,
      isActive: true,
      ssoRequired: false,
    } as any)
    await em.persistAndFlush(config)
  },
}

export default setup
