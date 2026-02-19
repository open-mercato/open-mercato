import { EntityManager } from '@mikro-orm/postgresql'
import { User, UserRole, Role } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SsoConfig, SsoIdentity } from '../data/entities'
import { emitSsoEvent } from '../events'
import type { SsoIdentityPayload } from '../lib/types'

export class AccountLinkingService {
  constructor(private em: EntityManager) {}

  async resolveUser(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    const existing = await this.findExistingLink(config.id, idpPayload.subject, tenantId, config.organizationId)
    if (existing) return existing

    if (!idpPayload.emailVerified) {
      throw new Error('IdP email is not verified — cannot link or provision account')
    }

    const emailDomain = idpPayload.email.split('@')[1]?.toLowerCase()
    if (!emailDomain || !config.allowedDomains.some((d) => d.toLowerCase() === emailDomain)) {
      throw new Error('Email domain is not in the allowed domains for this SSO configuration')
    }

    const emailLinked = config.autoLinkByEmail
      ? await this.linkByEmail(config, idpPayload, tenantId)
      : null
    if (emailLinked) return emailLinked

    if (config.jitEnabled) {
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
    if (!user) return null

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
      } as any,
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
    } as any)
    await this.em.persistAndFlush(identity)

    void emitSsoEvent('sso.identity.linked', {
      id: identity.id,
      tenantId,
      organizationId: config.organizationId,
    }).catch(() => undefined)

    return { user, identity: identity as SsoIdentity }
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
      } as any)
      await txEm.persistAndFlush(user)

      if (config.defaultRoleId) {
        const role = await txEm.findOne(Role, { id: config.defaultRoleId })
        if (role) {
          const userRole = txEm.create(UserRole, { user, role } as any)
          await txEm.persistAndFlush(userRole)
        }
      }

      const now = new Date()
      const identity = txEm.create(SsoIdentity, {
        tenantId,
        organizationId: config.organizationId,
        ssoConfigId: config.id,
        userId: (user as User).id,
        idpSubject: idpPayload.subject,
        idpEmail: idpPayload.email,
        idpName: idpPayload.name ?? null,
        idpGroups: idpPayload.groups ?? [],
        provisioningMethod: 'jit',
        firstLoginAt: now,
        lastLoginAt: now,
      } as any)
      await txEm.persistAndFlush(identity)

      void emitSsoEvent('sso.identity.created', {
        id: identity.id,
        tenantId,
        organizationId: config.organizationId,
      }).catch(() => undefined)

      return { user: user as User, identity: identity as SsoIdentity }
    })
  }
}
