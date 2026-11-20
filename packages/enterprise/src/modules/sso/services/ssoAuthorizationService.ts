import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Role, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { lockAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import {
  assertActorCanGrantAcl,
  assertActorCanGrantRoles,
  assertActorCanModifySuperAdminUserTarget,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SsoRoleGrant, type SsoConfig } from '../data/entities'
import { isSsoUserDeactivated } from '../lib/deactivation'

type SsoAuthority = {
  userId: string
  feature: 'sso.config.manage' | 'sso.scim.manage'
  isRequester: boolean
}

export type SsoConfigurationAuthorizationOptions = {
  scimActorIsRequester?: boolean
}

export type SsoAccountAuthorization = {
  tenantId: string
  mappedRoleIds: readonly string[]
}

export class SsoAuthorizationService {
  constructor(
    private readonly em: EntityManager,
    private readonly rbacService: RbacService,
  ) {}

  async resolveTenant(em: EntityManager, config: SsoConfig): Promise<string> {
    const organization = await findOneWithDecryption(
      em ?? this.em,
      Organization,
      { id: config.organizationId, deletedAt: null },
      { refresh: true },
      { tenantId: null, organizationId: config.organizationId },
    )
    const tenantId = relationId(organization?.tenant)
    if (!tenantId || (config.tenantId != null && config.tenantId !== tenantId)) {
      return denyAuthorization()
    }
    return tenantId
  }

  async assertConfiguration(
    em: EntityManager,
    config: SsoConfig,
    actorUserId?: string | null,
    scimActorUserId?: string | null,
    options: SsoConfigurationAuthorizationOptions = {},
  ): Promise<string> {
    return (await this.assertAuthorization(em, config, actorUserId, scimActorUserId, undefined, 'locked', options)).tenantId
  }

  async assertAccount(
    em: EntityManager,
    config: SsoConfig,
    user: User,
    scimActorUserId?: string | null,
  ): Promise<string> {
    return (await this.authorizeAccount(em, config, user, scimActorUserId)).tenantId
  }

  async assertAccountInSnapshot(em: EntityManager, config: SsoConfig, user: User): Promise<string> {
    return (await this.assertAuthorization(em, config, undefined, undefined, user, 'snapshot')).tenantId
  }

  async authorizeAccount(
    em: EntityManager,
    config: SsoConfig,
    user: User,
    scimActorUserId?: string | null,
  ): Promise<SsoAccountAuthorization> {
    return this.assertAuthorization(em, config, undefined, scimActorUserId, user)
  }

  private async assertAuthorization(
    em: EntityManager,
    config: SsoConfig,
    actorUserId?: string | null,
    scimActorUserId?: string | null,
    targetUser?: User,
    mode: 'locked' | 'snapshot' = 'locked',
    options: SsoConfigurationAuthorizationOptions = {},
  ): Promise<SsoAccountAuthorization> {
    if (
      !em.isInTransaction()
      || typeof this.rbacService?.loadAclWithEntityManager !== 'function'
      || typeof this.rbacService?.userHasAllFeaturesWithEntityManager !== 'function'
    ) {
      return denyAuthorization()
    }

    const configurationActorId = normalizeId(actorUserId === undefined ? config.authorizationUserId : actorUserId)
    const scimActorId = normalizeId(scimActorUserId)
    if (!configurationActorId || (scimActorUserId !== undefined && !scimActorId)) return denyAuthorization()

    const authorities: SsoAuthority[] = [{
      userId: configurationActorId,
      feature: 'sso.config.manage',
      isRequester: actorUserId !== undefined,
    }]
    if (scimActorId) {
      authorities.push({ userId: scimActorId, feature: 'sso.scim.manage', isRequester: options.scimActorIsRequester === true })
    }

    const tenantId = await this.resolveTenant(em, config)
    const mappedRoles = mode === 'locked'
      ? await this.lockAccountAuthorization(em, config, tenantId, authorities, targetUser)
      : await this.resolveMappedRoles(em, config, tenantId)

    const scope = { tenantId, organizationId: config.organizationId }
    const currentTarget = targetUser ? await findOneWithDecryption(
      em,
      User,
      { id: targetUser.id, tenantId, organizationId: config.organizationId, deletedAt: null, kind: 'human' },
      { refresh: true },
      scope,
    ) : null
    if (targetUser && !currentTarget) return denyAuthorization()
    const targetRoles = currentTarget ? await this.findTargetRoles(em, currentTarget, tenantId) : []
    const targetAcl = currentTarget ? await findOneWithDecryption(
      em,
      UserAcl,
      { user: currentTarget.id, tenantId, deletedAt: null } as FilterQuery<UserAcl>,
      { refresh: true },
      scope,
    ) : null

    for (const authority of authorities) {
      const actor = await findOneWithDecryption(
        em,
        User,
        { id: authority.userId, deletedAt: null, kind: 'human', isConfirmed: true },
        { refresh: true },
        { tenantId: null, organizationId: null },
      )
      if (!actor) return denyAuthorization()
      if (await isSsoUserDeactivated(em, {
        userId: actor.id,
        tenantId: actor.tenantId ?? null,
        organizationId: actor.organizationId ?? null,
      })) return denyAuthorization()
      const actorAcl = await this.rbacService.loadAclWithEntityManager(em, actor.id, scope)
      if (!actorAcl.isSuperAdmin && actor.tenantId !== tenantId) return denyAuthorization()
      if (!await this.rbacService.userHasAllFeaturesWithEntityManager(em, actor.id, [authority.feature], scope)) {
        return denyAuthorization()
      }

      const context = {
        em,
        rbacService: this.rbacService,
        actorUserId: actor.id,
        ...scope,
        requireBoundRbac: true,
      }
      try {
        await assertActorCanGrantRoles({ ...context, roles: mappedRoles })
        if (currentTarget) {
          await assertActorCanModifySuperAdminUserTarget({ ...context, targetUserId: currentTarget.id })
          await assertActorCanGrantRoles({ ...context, roles: targetRoles })
          if (targetAcl) {
            await assertActorCanGrantAcl({
              ...context,
              features: targetAcl.featuresJson,
              isSuperAdmin: targetAcl.isSuperAdmin,
              organizations: targetAcl.organizationsJson ?? null,
            })
          }
        }
      } catch (error) {
        if (isCrudHttpError(error) && error.status === 403) {
          return authority.isRequester ? denyAuthorityCeiling() : denyAuthorization()
        }
        throw error
      }
    }

    return { tenantId, mappedRoleIds: Object.freeze(mappedRoles.map((role) => role.id)) }
  }

  private async lockAccountAuthorization(
    em: EntityManager,
    config: SsoConfig,
    tenantId: string,
    authorities: readonly SsoAuthority[],
    targetUser?: User,
  ): Promise<Role[]> {
    const initialRoles = await this.resolveMappedRoles(em, config, tenantId)
    const priorGrants = targetUser ? await this.findRoleGrants(em, config, targetUser, tenantId) : []
    const lockedRoleIds = new Set([...initialRoles.map((role) => role.id), ...priorGrants.map((grant) => grant.roleId)])

    await lockAuthorizationState(em, {
      userIds: [...new Set([...authorities.map((authority) => authority.userId), ...(targetUser ? [targetUser.id] : [])])],
      roleIds: [...lockedRoleIds],
      tenantIds: [tenantId],
    })

    if (await this.resolveTenant(em, config) !== tenantId) return denyAuthorization()
    const mappedRoles = await this.resolveMappedRoles(em, config, tenantId)
    if (mappedRoles.some((role) => !lockedRoleIds.has(role.id))) return denyAuthorization()
    const currentGrants = targetUser ? await this.findRoleGrants(em, config, targetUser, tenantId) : []
    if (currentGrants.some((grant) => !lockedRoleIds.has(grant.roleId))) return denyAuthorization()

    return mappedRoles
  }

  private async resolveMappedRoles(em: EntityManager, config: SsoConfig, tenantId: string): Promise<Role[]> {
    const desiredNames = [...new Set(Object.values(config.appRoleMappings ?? {}).map((name) => name.trim().toLowerCase()))]
    if (!desiredNames.length) return []
    const roles = await findWithDecryption(
      em,
      Role,
      { tenantId, deletedAt: null },
      { refresh: true },
      { tenantId, organizationId: config.organizationId },
    )
    const desiredNameSet = new Set(desiredNames)
    const rolesByName = new Map<string, Role>()
    for (const role of roles) {
      const normalizedName = role.name.trim().toLowerCase()
      if (!desiredNameSet.has(normalizedName)) continue
      if (rolesByName.has(normalizedName)) return denyAuthorization()
      rolesByName.set(normalizedName, role)
    }
    const mappedRoles: Role[] = []
    for (const name of desiredNames) {
      const role = rolesByName.get(name)
      if (!role) return denyAuthorization()
      mappedRoles.push(role)
    }
    return mappedRoles
  }

  private async findTargetRoles(em: EntityManager, user: User, tenantId: string): Promise<Role[]> {
    const links = await findWithDecryption(
      em,
      UserRole,
      { user: user.id, deletedAt: null, role: { tenantId, deletedAt: null } } as FilterQuery<UserRole>,
      { populate: ['role'], refresh: true },
      { tenantId, organizationId: user.organizationId ?? null },
    )
    const roleIds = [...new Set(links.map((link) => relationId(link.role)))]
    if (roleIds.some((roleId) => !roleId)) return denyAuthorization()
    if (!roleIds.length) return []
    const roles = await findWithDecryption(
      em,
      Role,
      { id: { $in: roleIds }, tenantId, deletedAt: null } as FilterQuery<Role>,
      { refresh: true },
      { tenantId, organizationId: user.organizationId ?? null },
    )
    if (roles.length !== roleIds.length) return denyAuthorization()
    return roles
  }

  private async findRoleGrants(em: EntityManager, config: SsoConfig, user: User, tenantId: string): Promise<SsoRoleGrant[]> {
    return findWithDecryption(
      em,
      SsoRoleGrant,
      { userId: user.id, ssoConfigId: config.id, tenantId, organizationId: config.organizationId },
      { refresh: true },
      { tenantId, organizationId: config.organizationId },
    )
  }
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && !normalized.startsWith('api_key:') ? normalized : null
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return normalizeId(value)
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  return typeof value.id === 'string' ? normalizeId(value.id) : null
}

async function denyAuthorityCeiling(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw forbidden(translate('sso.errors.authorityCeilingExceeded'))
}

async function denyAuthorization(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw forbidden(translate('sso.errors.authorizationDenied'))
}
