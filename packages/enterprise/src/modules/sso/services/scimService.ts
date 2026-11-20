import { EntityManager, LockMode, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { User, Session } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoIdentity, SsoUserDeactivation, ScimProvisioningLog } from '../data/entities'
import { toScimUserResource, fromScimUserPayload, type ScimUserResource, type ScimUserPayload } from '../lib/scim-mapper'
import { coerceBoolean } from '../lib/scim-utils'
import { parseScimFilter, scimFilterToWhere } from '../lib/scim-filter'
import { buildListResponse } from '../lib/scim-response'
import type { ScimScope } from '../api/scim/context'
import type { ScimPatchOperation } from '../lib/scim-patch'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SsoAuthorizationService } from './ssoAuthorizationService'
import { isBrandedSsoHttpError } from '../lib/errors'

export class ScimService {
  constructor(
    private em: EntityManager,
    private ssoAuthorizationService?: SsoAuthorizationService,
  ) {}

  async createUser(
    payload: Record<string, unknown>,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<{ resource: ScimUserResource; status: number }> {
    return this.em.transactional((txEm) => this.createUserInTransaction(txEm, payload, scope, baseUrl))
  }

  private async createUserInTransaction(
    txEm: EntityManager,
    payload: Record<string, unknown>,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<{ resource: ScimUserResource; status: number }> {
    const parsed = fromScimUserPayload(payload)
    const email = parsed.email ?? parsed.userName
    if (!email) {
      throw new ScimServiceError(400, 'userName or emails[0].value is required')
    }

<<<<<<< HEAD
    // Idempotency: if externalId already exists for this config, return existing
    if (parsed.externalId) {
      const existingIdentity = await findOneWithDecryption(txEm, SsoIdentity, {
        ssoConfigId: scope.ssoConfigId,
        externalId: parsed.externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId ?? null,
        deletedAt: null,
      }, {}, { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId })
      if (existingIdentity) {
        const existingUser = await findOneWithDecryption(
          txEm, User,
          { id: existingIdentity.userId, organizationId: scope.organizationId, ...(scope.tenantId ? { tenantId: scope.tenantId } : {}), deletedAt: null },
          {},
          { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
        )
        if (existingUser) {
          const deactivation = parsed.active === false
            ? await this.createDeactivationTx(txEm, existingUser.id, scope)
            : await findOneWithDecryption(txEm, SsoUserDeactivation, {
              userId: existingUser.id, ssoConfigId: scope.ssoConfigId,
              tenantId: scope.tenantId ?? null, organizationId: scope.organizationId,
            }, {}, { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId })
          await this.logTx(txEm, scope, 'CREATE', existingIdentity.id, parsed.externalId, 200)
          return {
            resource: toScimUserResource(existingUser, existingIdentity, baseUrl, deactivation),
            status: 200,
=======
    return this.withConfigTransaction(scope, async (txEm, scope, authorization) => {
      if (parsed.externalId) {
        const existingIdentity = await txEm.findOne(SsoIdentity, {
          ssoConfigId: scope.ssoConfigId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          externalId: parsed.externalId,
          deletedAt: null,
        })
        if (existingIdentity) {
          const existingUser = await findOneWithDecryption(
            txEm, User,
            { id: existingIdentity.userId, organizationId: scope.organizationId, deletedAt: null },
            {},
            { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
          )
          if (existingUser) {
            await authorization.assertAccount(txEm, scope.config, existingUser, scope.actorUserId ?? null)
            const deactivation = await txEm.findOne(SsoUserDeactivation, {
              userId: existingUser.id, ssoConfigId: scope.ssoConfigId,
            })
            await this.logTx(txEm, scope, 'CREATE', existingIdentity.id, parsed.externalId, 200)
            return {
              resource: toScimUserResource(existingUser, existingIdentity, baseUrl, deactivation),
              status: 200,
            }
>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
          }
        }
      }

<<<<<<< HEAD
    // Check if user already exists by email
    const emailHash = computeEmailHash(email)
    const where: FilterQuery<User> = {
      organizationId: scope.organizationId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      deletedAt: null,
      $or: [{ email }, { emailHash }],
    }
    const existingUser = await findOneWithDecryption(
      txEm, User,
      where,
      {},
      { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
    )

    if (existingUser) {
      // Check if already linked to this SSO config
      const existingLink = await findOneWithDecryption(txEm, SsoIdentity, {
        ssoConfigId: scope.ssoConfigId,
        userId: existingUser.id,
        tenantId: scope.tenantId ?? null, organizationId: scope.organizationId,
        deletedAt: null,
      }, {}, { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId })
      if (existingLink) {
        if (parsed.active === false) {
          const deactivation = await this.createDeactivationTx(txEm, existingUser.id, scope)
          await this.logTx(txEm, scope, 'CREATE', existingLink.id, parsed.externalId, 200)
          return { resource: toScimUserResource(existingUser, existingLink, baseUrl, deactivation), status: 200 }
        }
        throw new ScimServiceError(409, `User with email ${email} is already linked to this SSO configuration`)
      }

      // Auto-link: create SsoIdentity for existing user
=======
      const emailHash = computeEmailHash(email)
      const where: FilterQuery<User> = {
        organizationId: scope.organizationId,
        deletedAt: null,
        $or: [{ email }, { emailHash }],
      }
      const existingUser = await findOneWithDecryption(
        txEm, User,
        where,
        {},
        { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
      )

      if (existingUser) {
        await authorization.assertAccount(txEm, scope.config, existingUser, scope.actorUserId ?? null)
        const existingLink = await txEm.findOne(SsoIdentity, {
          ssoConfigId: scope.ssoConfigId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          userId: existingUser.id,
          deletedAt: null,
        })
        if (existingLink) {
          throw new ScimServiceError(409, `User with email ${email} is already linked to this SSO configuration`)
        }

        const now = new Date()
        const identity = txEm.create(SsoIdentity, {
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
        await txEm.persist(identity).flush()

        const deactivation = parsed.active === false
          ? await this.createDeactivationTx(txEm, existingUser.id, scope)
          : null

        await this.logTx(txEm, scope, 'CREATE', identity.id, parsed.externalId, 201)
        return {
          resource: toScimUserResource(existingUser, identity, baseUrl, deactivation),
          status: 201,
        }
      }

      const tenantId = await authorization.assertConfiguration(txEm, scope.config, undefined, scope.actorUserId ?? null)
      const user = txEm.create(User, {
        tenantId,
        organizationId: scope.organizationId,
        email,
        emailHash: computeEmailHash(email),
        name: buildDisplayName(parsed) ?? undefined,
        passwordHash: null,
        isConfirmed: true,
        createdAt: new Date(),
      })
      await txEm.persist(user).flush()

>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
      const now = new Date()
      const identity = txEm.create(SsoIdentity, {
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
      await txEm.persist(identity).flush()

      const deactivation = parsed.active === false
        ? await this.createDeactivationTx(txEm, existingUser.id, scope)
        : null

      await this.logTx(txEm, scope, 'CREATE', identity.id, parsed.externalId, 201)
      return {
        resource: toScimUserResource(existingUser, identity, baseUrl, deactivation),
        status: 201,
      }
    }

    // Create new user + identity
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
  }

  async getUser(scimId: string, scope: ScimScope, baseUrl: string): Promise<ScimUserResource> {
    return this.withConfigTransaction(scope, async (txEm, currentScope, authorization) => {
      const tenantId = await authorization.assertConfiguration(txEm, currentScope.config, undefined, currentScope.actorUserId ?? null)
      const identity = await txEm.findOne(SsoIdentity, {
        id: scimId,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!identity) throw new ScimServiceError(404, 'User not found')

      const user = await findOneWithDecryption(
        txEm, User,
        { id: identity.userId, tenantId, organizationId: currentScope.organizationId, deletedAt: null },
        {},
        { tenantId, organizationId: currentScope.organizationId },
      )
      if (!user) throw new ScimServiceError(404, 'User not found')

      const deactivation = await txEm.findOne(SsoUserDeactivation, {
        userId: user.id, ssoConfigId: scope.ssoConfigId,
      })

      return toScimUserResource(user, identity, baseUrl, deactivation)
    })
  }

  async listUsers(
    filter: string | null,
    startIndex: number,
    count: number,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    return this.withConfigTransaction(scope, async (txEm, currentScope, authorization) => {
      const tenantId = await authorization.assertConfiguration(txEm, currentScope.config, undefined, currentScope.actorUserId ?? null)
      const conditions = parseScimFilter(filter)
      const where = scimFilterToWhere(conditions, scope.ssoConfigId, scope.organizationId)

      const offset = Math.max(0, startIndex - 1)
      const [identities, total] = await txEm.findAndCount(SsoIdentity, where, {
        orderBy: { createdAt: 'asc' },
        limit: count,
        offset,
      })

      const userIds = identities.map((i) => i.userId)

      const users = userIds.length > 0
        ? await findWithDecryption(
            txEm, User,
            { id: { $in: userIds }, tenantId, organizationId: currentScope.organizationId, deletedAt: null },
            {},
            { tenantId, organizationId: currentScope.organizationId },
          )
        : []
      const userMap = new Map(users.map((u) => [u.id, u]))

      const deactivations = userIds.length > 0
        ? await txEm.find(SsoUserDeactivation, {
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
    })
  }

  async patchUser(
    scimId: string,
    operations: ScimPatchOperation[],
    scope: ScimScope,
    baseUrl: string,
  ): Promise<ScimUserResource> {
    return this.withConfigTransaction(scope, async (txEm, scope, authorization) => {
      const identity = await txEm.findOne(SsoIdentity, {
        id: scimId,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!identity) throw new ScimServiceError(404, 'User not found')

      const user = await findOneWithDecryption(
        txEm, User,
        { id: identity.userId, organizationId: scope.organizationId, deletedAt: null },
        {},
        { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
      )
      if (!user) throw new ScimServiceError(404, 'User not found')

      await authorization.assertAccount(txEm, scope.config, user, scope.actorUserId ?? null)

      for (const op of operations) {
        const normalizedOp = op.op.toLowerCase()
        if (normalizedOp === 'replace' || normalizedOp === 'add') {
          this.applyPatchValue(user, identity, op.path, op.value)
        }
        if (normalizedOp === 'remove' && op.path) {
          this.applyPatchValue(user, identity, op.path, null)
        }
      }

      await txEm.flush()

      const activeOp = operations.find((op) =>
        op.path?.toLowerCase() === 'active' ||
        (!op.path && op.value && typeof op.value === 'object' && 'active' in (op.value as Record<string, unknown>)),
      )

      if (activeOp) {
        const activeValue = activeOp.path
          ? coerceBoolean(activeOp.value)
          : coerceBoolean((activeOp.value as Record<string, unknown>).active)

        if (activeValue === false) {
          await this.deactivateUserInTransaction(txEm, user.id, scope)
        } else if (activeValue === true) {
          await this.reactivateUserInTransaction(txEm, user.id, scope)
        }
      }

      await txEm.flush()

      const deactivation = await txEm.findOne(SsoUserDeactivation, {
        userId: user.id, ssoConfigId: scope.ssoConfigId,
      })

      await this.logTx(txEm, scope, 'PATCH', identity.id, identity.externalId, 200)
      return toScimUserResource(user, identity, baseUrl, deactivation)
    })
  }

  async deleteUser(scimId: string, scope: ScimScope): Promise<void> {
    return this.withConfigTransaction(scope, async (txEm, scope, authorization) => {
      const identity = await txEm.findOne(SsoIdentity, {
        id: scimId,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!identity) throw new ScimServiceError(404, 'User not found')

      const user = await findOneWithDecryption(
        txEm, User,
        { id: identity.userId, organizationId: scope.organizationId, deletedAt: null },
        {},
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      if (!user) throw new ScimServiceError(404, 'User not found')
      await authorization.assertAccount(txEm, scope.config, user, scope.actorUserId ?? null)
      await this.deactivateUserInTransaction(txEm, identity.userId, scope)
      await this.logTx(txEm, scope, 'DELETE', identity.id, identity.externalId, 204)
    })
  }

  private async withConfigTransaction<Result>(
    scope: ScimScope,
    operation: (em: EntityManager, scope: ScimScope, authorization: SsoAuthorizationService) => Promise<Result>,
  ): Promise<Result> {
    const authorization = this.ssoAuthorizationService
    if (!authorization || !scope.actorUserId) {
      const { translate } = await resolveTranslations()
      throw forbidden(translate('sso.errors.authorizationDenied'))
    }
    return this.em.transactional(async (txEm) => {
      const config = await findOneWithDecryption(
        txEm, SsoConfig,
        {
          id: scope.ssoConfigId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          isActive: true,
          deletedAt: null,
        },
        { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      if (!config || config.jitEnabled) {
        const { translate } = await resolveTranslations()
        throw forbidden(translate('sso.errors.authorizationDenied'))
      }
      return operation(txEm, { ...scope, config }, authorization)
    })
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

  private async deactivateUserInTransaction(
    txEm: EntityManager,
    userId: string,
    scope: ScimScope,
  ): Promise<SsoUserDeactivation> {
    await lockAuthorizationUserRows(txEm, [userId])
    let deactivation = await findOneWithDecryption(
      txEm, SsoUserDeactivation,
      { userId, ssoConfigId: scope.ssoConfigId, organizationId: scope.organizationId, tenantId: scope.tenantId ?? null },
      { refresh: true },
      { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId },
    )
    if (deactivation) {
      deactivation.deactivatedAt = new Date()
      deactivation.reactivatedAt = null
    } else {
      deactivation = txEm.create(SsoUserDeactivation, {
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
        userId,
        ssoConfigId: scope.ssoConfigId,
        deactivatedAt: new Date(),
      } as RequiredEntityData<SsoUserDeactivation>)
      txEm.persist(deactivation)
    }
    const sessionWhere: FilterQuery<Session> = { user: userId }
    await txEm.nativeDelete(Session, sessionWhere)
    const user = await findOneWithDecryption(txEm, User, {
      id: userId, organizationId: scope.organizationId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    }, { fields: ['id', 'tenantId'], refresh: true }, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    await txEm.nativeUpdate(ApiKey, {
      sessionUserId: userId,
      tenantId: user?.tenantId ?? scope.tenantId ?? null,
      organizationId: scope.organizationId,
      deletedAt: null,
    }, { deletedAt: new Date() })
    return deactivation
  }

<<<<<<< HEAD
  private async reactivateUser(userId: string, scope: ScimScope): Promise<void> {
    await this.em.transactional(async (txEm) => {
      await lockAuthorizationUserRows(txEm, [userId])
      const deactivation = await findOneWithDecryption(
        txEm, SsoUserDeactivation,
        { userId, ssoConfigId: scope.ssoConfigId, organizationId: scope.organizationId, tenantId: scope.tenantId ?? null },
        { refresh: true },
        { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId },
      )
      if (deactivation && !deactivation.reactivatedAt) {
        deactivation.reactivatedAt = new Date()
      }
    })
=======
  private async reactivateUserInTransaction(txEm: EntityManager, userId: string, scope: ScimScope): Promise<void> {
    await lockAuthorizationUserRows(txEm, [userId])
    const deactivation = await findOneWithDecryption(
      txEm, SsoUserDeactivation,
      { userId, ssoConfigId: scope.ssoConfigId, organizationId: scope.organizationId, tenantId: scope.tenantId ?? null },
      { refresh: true },
      { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId },
    )
    if (deactivation && !deactivation.reactivatedAt) {
      deactivation.reactivatedAt = new Date()
    }
>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
  }

  private async createDeactivationTx(txEm: EntityManager, userId: string, scope: ScimScope): Promise<SsoUserDeactivation> {
    return this.deactivateUserInTransaction(txEm, userId, scope)
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

const SCIM_SERVICE_ERROR_MARKER = Symbol.for('@open-mercato/sso/ScimServiceError')

export class ScimServiceError extends Error {
  readonly [SCIM_SERVICE_ERROR_MARKER] = true

  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ScimServiceError'
  }
}

export function isScimServiceError(error: unknown): error is ScimServiceError {
  return error instanceof ScimServiceError || isBrandedSsoHttpError(error, SCIM_SERVICE_ERROR_MARKER, 'ScimServiceError')
}
