import { EntityManager, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { User, Session } from '@open-mercato/core/modules/auth/data/entities'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoIdentity, SsoUserDeactivation, ScimProvisioningLog } from '../data/entities'
import { toScimUserResource, fromScimUserPayload, type ScimUserResource, type ScimUserPayload } from '../lib/scim-mapper'
import { coerceBoolean } from '../lib/scim-utils'
import { parseScimFilter, scimFilterToWhere } from '../lib/scim-filter'
import { buildListResponse } from '../lib/scim-response'
import type { ScimScope } from '../api/scim/context'
import type { ScimPatchOperation } from '../lib/scim-patch'

export class ScimService {
  constructor(private em: EntityManager) {}

  async createUser(
    payload: Record<string, unknown>,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<{ resource: ScimUserResource; status: number }> {
    const parsed = fromScimUserPayload(payload)
    const email = parsed.email ?? parsed.userName
    if (!email) {
      throw new ScimServiceError(400, 'userName or emails[0].value is required')
    }

    // Idempotency: if externalId already exists for this config, return existing
    if (parsed.externalId) {
      const existingIdentity = await this.em.findOne(SsoIdentity, {
        ssoConfigId: scope.ssoConfigId,
        externalId: parsed.externalId,
        deletedAt: null,
      })
      if (existingIdentity) {
        const existingUser = await findOneWithDecryption(
          this.em, User,
          { id: existingIdentity.userId, deletedAt: null },
          {},
          { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
        )
        if (existingUser) {
          const deactivation = await this.em.findOne(SsoUserDeactivation, {
            userId: existingUser.id, ssoConfigId: scope.ssoConfigId,
          })
          await this.log(scope, 'CREATE', existingIdentity.id, parsed.externalId, 200)
          return {
            resource: toScimUserResource(existingUser, existingIdentity, baseUrl, deactivation),
            status: 200,
          }
        }
      }
    }

    // Check if user already exists by email
    const emailHash = computeEmailHash(email)
    const where: FilterQuery<User> = {
      organizationId: scope.organizationId,
      deletedAt: null,
      $or: [{ email }, { emailHash }],
    }
    const existingUser = await findOneWithDecryption(
      this.em, User,
      where,
      {},
      { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
    )

    if (existingUser) {
      // Check if already linked to this SSO config
      const existingLink = await this.em.findOne(SsoIdentity, {
        ssoConfigId: scope.ssoConfigId,
        userId: existingUser.id,
        deletedAt: null,
      })
      if (existingLink) {
        throw new ScimServiceError(409, `User with email ${email} is already linked to this SSO configuration`)
      }

      // Auto-link: create SsoIdentity for existing user
      const now = new Date()
      const identity = this.em.create(SsoIdentity, {
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
        ssoConfigId: scope.ssoConfigId,
        userId: existingUser.id,
        idpSubject: parsed.externalId ?? email,
        idpEmail: email,
        idpName: buildDisplayName(parsed),
        idpGroups: [],
        externalId: parsed.externalId ?? null,
        provisioningMethod: 'scim',
        createdAt: now,
        updatedAt: now,
      } as RequiredEntityData<SsoIdentity>)
      await this.em.persist(identity).flush()

      const deactivation = parsed.active === false
        ? await this.createDeactivation(existingUser.id, scope)
        : null

      await this.log(scope, 'CREATE', identity.id, parsed.externalId, 201)
      return {
        resource: toScimUserResource(existingUser, identity, baseUrl, deactivation),
        status: 201,
      }
    }

    // Create new user + identity
    return this.em.transactional(async (txEm) => {
      const user = txEm.create(User, {
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
        email,
        emailHash: computeEmailHash(email),
        name: buildDisplayName(parsed) ?? undefined,
        passwordHash: null,
        isConfirmed: true,
        createdAt: new Date(),
      })
      await txEm.persist(user).flush()

      const now = new Date()
      const identity = txEm.create(SsoIdentity, {
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
        ssoConfigId: scope.ssoConfigId,
        userId: user.id,
        idpSubject: parsed.externalId ?? email,
        idpEmail: email,
        idpName: buildDisplayName(parsed),
        idpGroups: [],
        externalId: parsed.externalId ?? null,
        provisioningMethod: 'scim',
        createdAt: now,
        updatedAt: now,
      } as RequiredEntityData<SsoIdentity>)
      await txEm.persist(identity).flush()

      const deactivation = parsed.active === false
        ? await this.createDeactivationTx(txEm, user.id, scope)
        : null

      await this.logTx(txEm, scope, 'CREATE', identity.id, parsed.externalId, 201)
      return {
        resource: toScimUserResource(user, identity, baseUrl, deactivation),
        status: 201,
      }
    })
  }

  async getUser(scimId: string, scope: ScimScope, baseUrl: string): Promise<ScimUserResource> {
    const identity = await this.em.findOne(SsoIdentity, {
      id: scimId,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!identity) throw new ScimServiceError(404, 'User not found')

    const user = await findOneWithDecryption(
      this.em, User,
      { id: identity.userId, deletedAt: null },
      {},
      { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
    )
    if (!user) throw new ScimServiceError(404, 'User not found')

    const deactivation = await this.em.findOne(SsoUserDeactivation, {
      userId: user.id, ssoConfigId: scope.ssoConfigId,
    })

    return toScimUserResource(user, identity, baseUrl, deactivation)
  }

  async listUsers(
    filter: string | null,
    startIndex: number,
    count: number,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    const conditions = parseScimFilter(filter)
    const where = scimFilterToWhere(conditions, scope.ssoConfigId, scope.organizationId)

    const offset = Math.max(0, startIndex - 1)
    const [identities, total] = await this.em.findAndCount(SsoIdentity, where, {
      orderBy: { createdAt: 'asc' },
      limit: count,
      offset,
    })

    const userIds = identities.map((i) => i.userId)

    const users = userIds.length > 0
      ? await findWithDecryption(
          this.em, User,
          { id: { $in: userIds }, deletedAt: null },
          {},
          { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
        )
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    const deactivations = userIds.length > 0
      ? await this.em.find(SsoUserDeactivation, {
          userId: { $in: userIds }, ssoConfigId: scope.ssoConfigId,
        })
      : []
    const deactivationMap = new Map(deactivations.map((d) => [d.userId, d]))

    const resources: ScimUserResource[] = []
    for (const identity of identities) {
      const user = userMap.get(identity.userId)
      if (!user) continue

      const deactivation = deactivationMap.get(user.id) ?? null
      resources.push(toScimUserResource(user, identity, baseUrl, deactivation))
    }

    return buildListResponse(resources, total, startIndex, resources.length)
  }

  async patchUser(
    scimId: string,
    operations: ScimPatchOperation[],
    scope: ScimScope,
    baseUrl: string,
  ): Promise<ScimUserResource> {
    const identity = await this.em.findOne(SsoIdentity, {
      id: scimId,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!identity) throw new ScimServiceError(404, 'User not found')

    const user = await findOneWithDecryption(
      this.em, User,
      { id: identity.userId, deletedAt: null },
      {},
      { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
    )
    if (!user) throw new ScimServiceError(404, 'User not found')

    for (const op of operations) {
      const normalizedOp = op.op.toLowerCase()
      if (normalizedOp === 'replace' || normalizedOp === 'add') {
        this.applyPatchValue(user, identity, op.path, op.value)
      }
      // 'remove' operations on optional fields — set to null
      if (normalizedOp === 'remove' && op.path) {
        this.applyPatchValue(user, identity, op.path, null)
      }
    }

    // Handle active status changes
    const activeOp = operations.find((op) =>
      op.path?.toLowerCase() === 'active' ||
      (!op.path && op.value && typeof op.value === 'object' && 'active' in (op.value as Record<string, unknown>)),
    )

    if (activeOp) {
      const activeValue = activeOp.path
        ? coerceBoolean(activeOp.value)
        : coerceBoolean((activeOp.value as Record<string, unknown>).active)

      if (activeValue === false) {
        await this.deactivateUser(user.id, scope)
      } else if (activeValue === true) {
        await this.reactivateUser(user.id, scope)
      }
    }

    await this.em.flush()

    const deactivation = await this.em.findOne(SsoUserDeactivation, {
      userId: user.id, ssoConfigId: scope.ssoConfigId,
    })

    await this.log(scope, 'PATCH', identity.id, identity.externalId, 200)
    return toScimUserResource(user, identity, baseUrl, deactivation)
  }

  async deleteUser(scimId: string, scope: ScimScope): Promise<void> {
    const identity = await this.em.findOne(SsoIdentity, {
      id: scimId,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!identity) throw new ScimServiceError(404, 'User not found')

    await this.deactivateUser(identity.userId, scope)
    await this.log(scope, 'DELETE', identity.id, identity.externalId, 204)
  }

  private applyPatchValue(
    user: User,
    identity: SsoIdentity,
    path: string | undefined,
    value: unknown,
  ): void {
    if (!path) {
      // No path means value is an object with attribute keys
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>
        for (const [key, val] of Object.entries(obj)) {
          this.applyPatchValue(user, identity, key, val)
        }
      }
      return
    }

    const normalizedPath = path.toLowerCase()
    switch (normalizedPath) {
      case 'displayname':
        user.name = (value as string) || undefined
        identity.idpName = (value as string) ?? null
        break
      case 'name.givenname': {
        const currentParts = (user.name ?? '').split(' ')
        currentParts[0] = (value as string) ?? ''
        user.name = currentParts.join(' ').trim() || undefined
        break
      }
      case 'name.familyname': {
        const currentParts = (user.name ?? '').split(' ')
        const given = currentParts[0] ?? ''
        user.name = value ? `${given} ${value}`.trim() : given || undefined
        break
      }
      case 'username':
        identity.idpEmail = (value as string) ?? identity.idpEmail
        break
      case 'externalid':
        identity.externalId = (value as string) ?? null
        break
      case 'active':
        // Handled separately via deactivation logic
        break
    }
  }

  private async deactivateUser(userId: string, scope: ScimScope): Promise<void> {
    let deactivation = await this.em.findOne(SsoUserDeactivation, {
      userId, ssoConfigId: scope.ssoConfigId,
    })

    if (deactivation) {
      deactivation.deactivatedAt = new Date()
      deactivation.reactivatedAt = null
    } else {
      deactivation = this.em.create(SsoUserDeactivation, {
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
        userId,
        ssoConfigId: scope.ssoConfigId,
        deactivatedAt: new Date(),
      } as RequiredEntityData<SsoUserDeactivation>)
      this.em.persist(deactivation)
    }
    await this.em.flush()

    // Revoke all active sessions
    const sessionWhere: FilterQuery<Session> = { user: userId }
    await this.em.nativeDelete(Session, sessionWhere)
  }

  private async reactivateUser(userId: string, scope: ScimScope): Promise<void> {
    const deactivation = await this.em.findOne(SsoUserDeactivation, {
      userId, ssoConfigId: scope.ssoConfigId,
    })
    if (deactivation && !deactivation.reactivatedAt) {
      deactivation.reactivatedAt = new Date()
      await this.em.flush()
    }
  }

  private async createDeactivation(userId: string, scope: ScimScope): Promise<SsoUserDeactivation> {
    const deactivation = this.em.create(SsoUserDeactivation, {
      tenantId: scope.tenantId ?? null,
      organizationId: scope.organizationId,
      userId,
      ssoConfigId: scope.ssoConfigId,
      deactivatedAt: new Date(),
    } as RequiredEntityData<SsoUserDeactivation>)
    await this.em.persist(deactivation).flush()
    return deactivation
  }

  private async createDeactivationTx(txEm: EntityManager, userId: string, scope: ScimScope): Promise<SsoUserDeactivation> {
    const deactivation = txEm.create(SsoUserDeactivation, {
      tenantId: scope.tenantId ?? null,
      organizationId: scope.organizationId,
      userId,
      ssoConfigId: scope.ssoConfigId,
      deactivatedAt: new Date(),
    } as RequiredEntityData<SsoUserDeactivation>)
    await txEm.persist(deactivation).flush()
    return deactivation
  }

  private async log(
    scope: ScimScope,
    operation: string,
    resourceId: string | null | undefined,
    externalId: string | null | undefined,
    responseStatus: number,
    errorMessage?: string,
  ): Promise<void> {
    const entry = this.em.create(ScimProvisioningLog, {
      tenantId: scope.tenantId ?? null,
      organizationId: scope.organizationId,
      ssoConfigId: scope.ssoConfigId,
      operation,
      resourceType: 'User',
      resourceId: resourceId ?? null,
      scimExternalId: externalId ?? null,
      responseStatus,
      errorMessage: errorMessage ?? null,
    } as RequiredEntityData<ScimProvisioningLog>)
    await this.em.persist(entry).flush()
  }

  private async logTx(
    txEm: EntityManager,
    scope: ScimScope,
    operation: string,
    resourceId: string | null | undefined,
    externalId: string | null | undefined,
    responseStatus: number,
  ): Promise<void> {
    const entry = txEm.create(ScimProvisioningLog, {
      tenantId: scope.tenantId ?? null,
      organizationId: scope.organizationId,
      ssoConfigId: scope.ssoConfigId,
      operation,
      resourceType: 'User',
      resourceId: resourceId ?? null,
      scimExternalId: externalId ?? null,
      responseStatus,
    } as RequiredEntityData<ScimProvisioningLog>)
    await txEm.persist(entry).flush()
  }
}

function buildDisplayName(parsed: ScimUserPayload): string | null {
  if (parsed.displayName) return parsed.displayName
  const parts = [parsed.givenName, parsed.familyName].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

export class ScimServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ScimServiceError'
  }
}
