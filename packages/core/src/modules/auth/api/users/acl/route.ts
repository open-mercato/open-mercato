import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import {
  assertActorCanAccessUserTarget,
  assertActorCanGrantAcl,
  assertActorCanModifySuperAdminUserTarget,
  normalizeGrantFeatureList,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  AUTH_USER_ACL_UPDATE_COMMAND_ID,
  type AclUpdateResult,
  type UserAclUpdateInput,
} from '@open-mercato/core/modules/auth/commands/acl'

const getSchema = z.object({ userId: z.string().uuid() })
const putSchema = z.object({
  userId: z.string().uuid(),
  isSuperAdmin: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  organizations: z.array(z.string()).nullable().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
}

const userAclResponseSchema = z.object({
  hasCustomAcl: z.boolean(),
  isSuperAdmin: z.boolean(),
  features: z.array(z.string()),
  organizations: z.array(z.string()).nullable(),
  updatedAt: z.string().nullable(),
})

const userAclUpdateResponseSchema = z.object({
  ok: z.literal(true),
  sanitized: z.boolean(),
})

const userAclErrorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbacService = container.resolve('rbacService') as any
  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  if (!actorAcl?.isSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
        organizationScope: await resolveOrganizationScopeForRequest({
          container,
          auth,
          request: req,
          tenantId: auth.tenantId ?? null,
        }),
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }
  const acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  const response = acl
    ? {
        hasCustomAcl: true,
        isSuperAdmin: !!acl.isSuperAdmin,
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null,
        updatedAt: acl.updatedAt instanceof Date ? acl.updatedAt.toISOString() : null,
      }
    : { hasCustomAcl: false, isSuperAdmin: false, features: [], organizations: null, updatedAt: null }

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [{ id: parsed.data.userId, ...response }],
    idField: 'id',
    resourceKind: 'auth.user_acl',
    organizationId: auth.orgId ?? null,
    tenantId: auth.tenantId ?? null,
    query: { userId: parsed.data.userId },
    accessType: 'read:item',
  })

  return NextResponse.json(response)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbacService = container.resolve('rbacService') as any

  // A user ACL row is tenant-scoped (`user_acls.tenant_id` is NOT NULL), but the
  // actor's tenant can legitimately be null — `users.tenant_id` is nullable, so a
  // global account logs in without one. Resolve the actor's tenant first and fall
  // back to the target user's, mirroring how the role ACL route derives its scope
  // (`parsed.tenantId ?? roleTenantId ?? authTenantId`) before refusing.
  //
  // Without this the lookup ran with an undefined tenant predicate, which
  // MikroORM drops: the update and clear paths then matched whichever row
  // happened to exist, in any tenant, and the create path hit a NOT NULL
  // violation.
  const targetUser = await em.findOne(User, { id: parsed.data.userId as any })
  const tenantId: string | null =
    auth.tenantId ?? (targetUser?.tenantId ? String(targetUser.tenantId) : null)
  if (!tenantId) return NextResponse.json({ error: 'Tenant required' }, { status: 400 })

  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  if (!actorIsSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
        organizationScope: await resolveOrganizationScopeForRequest({
          container,
          auth,
          request: req,
          tenantId: auth.tenantId ?? null,
        }),
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  const requestedFeatures = normalizeGrantFeatureList(parsed.data.features)
  const organizations = normalizeOrganizations(parsed.data.organizations)

  const acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId })
  // Optimistic lock: refuse a stale per-user ACL overwrite so concurrent edits
  // cannot silently clobber each other (#2055). Strictly additive — a no-op when
  // the client sends no expected-version header; skipped when no ACL row exists.
  if (acl) {
    try {
      await enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'auth.user_acl',
        resourceId: acl.id,
        current: acl.updatedAt ?? null,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }
  const existingIsSuperAdmin = acl ? !!acl.isSuperAdmin : false
  const existingFeatures = acl ? normalizeGrantFeatureList(acl.featuresJson) : []

  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? false

  try {
    await assertActorCanGrantAcl({
      em: em as EntityManager,
      rbacService: rbacService as RbacService,
      actorUserId: auth.sub,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      isSuperAdmin: requestedIsSuperAdmin,
      features: requestedFeatures,
      organizations,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  const effectiveFeatures = actorIsSuperAdmin
    ? requestedFeatures
    : sanitizeTenantFeatures(requestedFeatures)

  let effectiveIsSuperAdmin = requestedIsSuperAdmin

  if (!actorIsSuperAdmin) {
    if (requestedIsSuperAdmin && !existingIsSuperAdmin) {
      throw forbidden('Only super administrators can grant super admin access.')
    }
    if (existingIsSuperAdmin && requestedIsSuperAdmin === false) {
      effectiveIsSuperAdmin = false
    } else {
      effectiveIsSuperAdmin = existingIsSuperAdmin
    }
  }

  const hasCustomAcl = effectiveIsSuperAdmin || effectiveFeatures.length > 0

  // Route the write through the command bus so the permission change lands in
  // the action log. The command owns the transactional write (or removal) and
  // the RBAC cache invalidation that used to live here.
  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
    request: req,
  }
  await commandBus.execute<UserAclUpdateInput, AclUpdateResult>(AUTH_USER_ACL_UPDATE_COMMAND_ID, {
    input: {
      userId: parsed.data.userId,
      tenantId,
      isSuperAdmin: effectiveIsSuperAdmin,
      features: effectiveFeatures,
      organizations,
      clear: !hasCustomAcl,
    },
    ctx: commandCtx,
  })

  return NextResponse.json({
    ok: true,
    sanitized: !actorIsSuperAdmin && (hasRestrictedChanges(requestedFeatures, effectiveFeatures, existingFeatures) || requestedIsSuperAdmin !== effectiveIsSuperAdmin),
  })
}

function normalizeOrganizations(organizations: unknown): string[] | null {
  if (!Array.isArray(organizations)) return null
  return normalizeGrantFeatureList(organizations)
}

function sanitizeTenantFeatures(features: string[]): string[] {
  return features.filter((feature) => !isTenantRestrictedFeature(feature))
}

function isTenantRestrictedFeature(feature: string): boolean {
  if (feature === '*' || feature === 'directory.*') return true
  if (feature.startsWith('directory.tenants')) return true
  return false
}

function hasRestrictedChanges(requested: string[], effective: string[], existing: string[]): boolean {
  if (requested.length === effective.length) return false
  const effectiveSet = new Set(effective)
  const existingSet = new Set(existing)
  // If the effective set matches existing, we only trimmed restricted duplicates and should not report
  if (effectiveSet.size === existingSet.size) {
    let identical = true
    for (const value of effectiveSet) {
      if (!existingSet.has(value)) {
        identical = false
        break
      }
    }
    if (identical) return false
  }
  return true
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'User ACL management',
  methods: {
    GET: {
      summary: 'Fetch user ACL',
      description: 'Returns custom ACL overrides for a user within the current tenant, if any.',
      query: getSchema,
      responses: [
        { status: 200, description: 'User ACL entry', schema: userAclResponseSchema },
        { status: 400, description: 'Invalid user id', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update user ACL',
      description: 'Configures per-user ACL overrides, including super admin access, feature list, and organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: putSchema,
      },
      responses: [
        { status: 200, description: 'User ACL updated', schema: userAclUpdateResponseSchema },
        { status: 400, description: 'Invalid payload or unresolved tenant scope', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
        { status: 403, description: 'Insufficient privileges to modify ACL', schema: userAclErrorSchema },
      ],
    },
  },
}
