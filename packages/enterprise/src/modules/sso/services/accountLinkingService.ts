import { EntityManager, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SsoConfig, SsoIdentity, SsoRoleGrant, ScimToken } from '../data/entities'
import { emitSsoEvent } from '../events'
import { EmailNotVerifiedError } from '../lib/errors'
import type { SsoIdentityPayload } from '../lib/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { syncSsoRoleGrants } from '../lib/sso-role-sync'

const logger = createLogger('sso').child({ component: 'account-linking' })

export class AccountLinkingService {
  constructor(private em: EntityManager) {}

  async resolveUser(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    const existing = await this.findExistingLink(config.id, idpPayload.subject, tenantId, config.organizationId)
    if (existing) {
      await this.assignRolesFromSso(this.em, existing.user, config, tenantId, idpPayload.groups)
      return existing
    }

    if (idpPayload.emailVerified !== true) {
      throw new EmailNotVerifiedError('IdP did not verify the email claim — cannot link or provision account')
    }

    const emailDomain = idpPayload.email.split('@')[1]?.toLowerCase()
    if (!emailDomain || !config.allowedDomains.some((d) => d.toLowerCase() === emailDomain)) {
      throw new Error('Email domain is not in the allowed domains for this SSO configuration')
    }

    const emailLinked = config.autoLinkByEmail
      ? await this.linkByEmail(config, idpPayload, tenantId)
      : null
    if (emailLinked) {
      await this.assignRolesFromSso(this.em, emailLinked.user, config, tenantId, idpPayload.groups)
      return emailLinked
    }

    if (config.jitEnabled) {
      const scimActive = await this.em.count(ScimToken, { ssoConfigId: config.id, isActive: true }) > 0
      if (scimActive) {
        throw new Error('JIT provisioning is disabled because SCIM directory sync is active')
      }
      return this.jitProvision(config, idpPayload, tenantId)
    }

    throw new Error('No matching user found and JIT provisioning is disabled')
  }

  private async findExistingLink(
    ssoConfigId: string,
    idpSubject: string,
    tenantId: string,
    organizationId: string,
  ): Promise<{ user: User; identity: SsoIdentity } | null> {
    const identity = await findOneWithDecryption(
      this.em,
      SsoIdentity,
      { ssoConfigId, idpSubject, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!identity) return null

    const user = await findOneWithDecryption(
      this.em,
      User,
      { id: identity.userId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!user) {
      identity.deletedAt = new Date()
      await this.em.flush()
      return null
    }

    identity.lastLoginAt = new Date()
    await this.em.flush()

    return { user, identity }
  }

  private async linkByEmail(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity } | null> {
    const emailHash = computeEmailHash(idpPayload.email)
    const user = await findOneWithDecryption(
      this.em,
      User,
      {
        organizationId: config.organizationId,
        deletedAt: null,
        $or: [
          { email: idpPayload.email },
          { emailHash },
        ],
      } as FilterQuery<User>,
      {},
      { tenantId, organizationId: config.organizationId },
    )
    if (!user) return null

    const now = new Date()
    const identity = this.em.create(SsoIdentity, {
      tenantId,
      organizationId: config.organizationId,
      ssoConfigId: config.id,
      userId: user.id,
      idpSubject: idpPayload.subject,
      idpEmail: idpPayload.email,
      idpName: idpPayload.name ?? null,
      idpGroups: idpPayload.groups ?? [],
      provisioningMethod: 'manual',
      firstLoginAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    } as RequiredEntityData<SsoIdentity>)
    await this.em.persist(identity).flush()

    void emitSsoEvent('sso.identity.linked', {
      id: identity.id,
      tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    return { user, identity }
  }

  private async jitProvision(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    return this.em.transactional(async (txEm) => {
      const user = txEm.create(User, {
        tenantId,
        organizationId: config.organizationId,
        email: idpPayload.email,
        emailHash: computeEmailHash(idpPayload.email),
        name: idpPayload.name ?? null,
        passwordHash: null,
        isConfirmed: true,
        createdAt: new Date(),
      })
      await txEm.persist(user).flush()

      await this.assignRolesFromSso(txEm, user, config, tenantId, idpPayload.groups)

      const now = new Date()
      const identity = txEm.create(SsoIdentity, {
        tenantId,
        organizationId: config.organizationId,
        ssoConfigId: config.id,
        userId: user.id,
        idpSubject: idpPayload.subject,
        idpEmail: idpPayload.email,
        idpName: idpPayload.name ?? null,
        idpGroups: idpPayload.groups ?? [],
        provisioningMethod: 'jit',
        firstLoginAt: now,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      } as RequiredEntityData<SsoIdentity>)
      await txEm.persist(identity).flush()

      void emitSsoEvent('sso.identity.created', {
        id: identity.id,
        tenantId,
        organizationId: config.organizationId,
      }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

      return { user, identity }
    })
  }

  private async assignRolesFromSso(
    em: EntityManager,
    user: User,
    config: SsoConfig,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<void> {
    const hasMappings = config.appRoleMappings && Object.keys(config.appRoleMappings).length > 0
    if (!hasMappings) return

    await this.syncMappedRoles(em, user, config, tenantId, idpGroups)

    const hasAnySsoRole = await em.findOne(SsoRoleGrant, {
      userId: user.id,
      ssoConfigId: config.id,
    })
    if (!hasAnySsoRole) {
      throw new Error('No roles could be resolved from IdP groups — login denied. Configure role mappings or ensure the IdP sends matching group claims.')
    }
  }

  /**
   * Sync/replace SSO-sourced roles: on each login, SSO-managed roles are replaced
   * with what the IdP sends, while manually-assigned roles are preserved.
   */
  private async syncMappedRoles(
    em: EntityManager,
    user: User,
    config: SsoConfig,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<void> {
    await syncSsoRoleGrants(em, user, config, tenantId, idpGroups)
  }
}
