import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import {
  assertActorCanAccessUserTarget,
  assertActorCanGrantAcl,
  assertActorCanModifySuperAdminUserTarget,
  normalizeGrantFeatureList,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

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

  let acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
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
  const existingOrganizations = acl ? normalizeOrganizations(acl.organizationsJson) : null

  // A per-user ACL is an absolute override, so an omitted dimension must keep
  // its stored value. Normalizing an omitted `features` to `[]` or an omitted
  // `organizations` to `null` turned a single-dimension edit into a silent
  // clear, deleting the row and widening the user back to their full role.
  const featuresWereProvided = parsed.data.features !== undefined
  const requestedFeatures = featuresWereProvided
    ? normalizeGrantFeatureList(parsed.data.features)
    : existingFeatures
  const requestedOrganizations = parsed.data.organizations === undefined
    ? existingOrganizations
    : normalizeOrganizations(parsed.data.organizations)

  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? existingIsSuperAdmin

  try {
    await assertActorCanGrantAcl({
      em: em as EntityManager,
      rbacService: rbacService as RbacService,
      actorUserId: auth.sub,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      isSuperAdmin: requestedIsSuperAdmin,
      features: requestedFeatures,
      organizations: requestedOrganizations,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  // An omitted feature list is already stored and in effect. Re-sanitizing it
  // during an unrelated organization edit would silently revoke grants the
  // actor did not touch, so only an explicitly submitted list is sanitized.
  const effectiveFeatures = actorIsSuperAdmin || !featuresWereProvided
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

  // Retaining an organization-only override with no features would revoke every
  // role-granted feature instead of narrowing the role. Refuse that state rather
  // than persisting it or silently dropping the organization scope.
  if (!effectiveIsSuperAdmin && effectiveFeatures.length === 0 && hasOrganizationRestriction(requestedOrganizations)) {
    const { translate } = await resolveTranslations()
    return NextResponse.json({
      error: translate(
        'auth.acl.organizationWarning',
        'Organization restrictions are saved only when at least one feature override is selected. Add a feature or enable a module wildcard before saving.',
      ),
    }, { status: 400 })
  }

  // An unrestricted organization list carries no override on its own, and the guard
  // above already refused the restricted-but-featureless case, so the override is
  // custom exactly when it grants super admin or at least one feature.
  const hasCustomAcl = effectiveIsSuperAdmin || effectiveFeatures.length > 0

  // Persist the ACL mutation inside a transaction so the per-user permission
  // write (or removal) commits atomically (proper ACL-edit transaction handling).
  if (!hasCustomAcl) {
    if (acl) {
      const aclToRemove = acl
      await withAtomicFlush(em, [() => em.remove(aclToRemove)], { transaction: true })
    }
  } else {
    if (!acl) {
      acl = em.create(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
    }
    const aclRecord = acl as any
    await withAtomicFlush(
      em,
      [
        () => {
          aclRecord.isSuperAdmin = effectiveIsSuperAdmin
          aclRecord.featuresJson = effectiveFeatures
          aclRecord.organizationsJson = requestedOrganizations
          em.persist(aclRecord)
        },
      ],
      { transaction: true },
    )
  }

  // Invalidate cache for this user
  await rbacService.invalidateUserCache(parsed.data.userId)
  try {
    const cache = container.resolve('cache') as any
    if (cache) await cache.deleteByTags([`rbac:user:${parsed.data.userId}`])
  } catch {}

  return NextResponse.json({
    ok: true,
    sanitized: !actorIsSuperAdmin && (hasRestrictedChanges(requestedFeatures, effectiveFeatures, existingFeatures) || requestedIsSuperAdmin !== effectiveIsSuperAdmin),
  })
}

function normalizeOrganizations(organizations: unknown): string[] | null {
  if (!Array.isArray(organizations)) return null
  return normalizeGrantFeatureList(organizations)
}

// Whether the caller expressed an intentional narrowing. `null` and `__all__`
// are the two documented ways to say "every organization"; an empty list is the
// editor's "no organization picked" state ("Empty = all organizations"), which
// is not a restriction an administrator chose. Only a concrete list narrows, so
// only a concrete list has to justify itself against the feature grant below.
function hasOrganizationRestriction(organizations: string[] | null): boolean {
  if (!organizations || organizations.length === 0) return false
  return !organizations.includes('__all__')
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
      description: 'Updates a per-user ACL override. Omitted super admin, feature, and organization fields preserve their stored values. An organization-scoped non-super-admin override requires at least one feature grant.',
      requestBody: {
        contentType: 'application/json',
        schema: putSchema,
      },
      responses: [
        { status: 200, description: 'User ACL updated', schema: userAclUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
        { status: 403, description: 'Insufficient privileges to modify ACL', schema: userAclErrorSchema },
      ],
    },
  },
}
