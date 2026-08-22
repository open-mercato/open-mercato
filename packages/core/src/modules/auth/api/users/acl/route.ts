import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  AUTH_USER_ACL_UPDATE_COMMAND_ID,
  type AclUpdateResult,
  type UserAclUpdateInput,
} from '@open-mercato/core/modules/auth/commands/acl'

const getSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
})
const putSchema = z.object({
  userId: z.string().uuid(),
  isSuperAdmin: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  organizations: z.array(z.string()).nullable().optional(),
  tenantId: z.string().uuid().optional(),
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

type TenantResolution = { tenantId: string | null } | { error: NextResponse }

/**
 * The single tenant scope both handlers work in. GET and PUT MUST resolve it the
 * same way: the admin user form PUTs the ACL panel's state on every save, so a
 * GET that reads a narrower scope than the PUT writes hands the operator an
 * empty form and turns the next name-only edit into a silent revocation, with no
 * `updatedAt` to arm the optimistic lock against it.
 *
 * `user_acls.tenant_id` is NOT NULL while `users.tenant_id` is nullable, so a
 * global account legitimately signs in with `auth.tenantId === null` and the
 * scope has to come from the target user instead. That fallback is reserved for
 * a super admin: for anyone else it would let the target pick the scope its own
 * access is then checked against, and it decrypts a possibly foreign user ahead
 * of every guard. A tenant-less non-super-admin therefore resolves to `null`,
 * which reads as "no override" and refuses to write — the behaviour that held
 * before this route resolved a scope at all. The read is also skipped whenever a
 * tenant is already known.
 *
 * An explicit `tenantId` wins, mirroring the role ACL route (additive there and
 * here; no caller sends it yet) — but only for a super admin or for the actor's
 * own tenant, so it cannot widen anyone's reach. The result is that for a
 * non-super-admin the resolved scope is always the actor's own.
 */
async function resolveAclTenantId(args: {
  em: EntityManager
  auth: NonNullable<AuthContext>
  actorIsSuperAdmin: boolean
  userId: string
  requestedTenantId?: string
}): Promise<TenantResolution> {
  const authTenantId = args.auth.tenantId ?? null
  if (args.requestedTenantId && args.requestedTenantId !== authTenantId && !args.actorIsSuperAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const known = args.requestedTenantId ?? authTenantId
  if (known) return { tenantId: known }
  if (!args.actorIsSuperAdmin) return { tenantId: null }
  const targetUser = await findOneWithDecryption(
    args.em,
    User,
    { id: args.userId } as FilterQuery<User>,
    {},
    { tenantId: null, organizationId: args.auth.orgId ?? null },
  )
  return { tenantId: targetUser?.tenantId ? String(targetUser.tenantId) : null }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({
    userId: url.searchParams.get('userId'),
    tenantId: url.searchParams.get('tenantId') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbacService = container.resolve('rbacService') as any
  // Every grant check is answered in the actor's own scope, never in the scope
  // resolved for the record: passing the resolved one would ask a foreign tenant
  // whether this caller may act there, and for a tenant-less actor — whose scope
  // comes from the target — it would compare the target against itself.
  const actorTenantId = auth.tenantId ?? null
  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: actorTenantId, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  const resolution = await resolveAclTenantId({
    em: em as EntityManager,
    auth,
    actorIsSuperAdmin,
    userId: parsed.data.userId,
    requestedTenantId: parsed.data.tenantId,
  })
  if ('error' in resolution) return resolution.error
  // An unresolvable scope reads as "no override", which is what PUT then refuses
  // to write (`Tenant required`) — so the pair still cannot destroy a row.
  const tenantId = resolution.tenantId

  if (!actorIsSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: actorTenantId,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: actorTenantId,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
        organizationScope: await resolveOrganizationScopeForRequest({
          container,
          auth,
          request: req,
          tenantId: actorTenantId,
        }),
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }
  const acl = tenantId
    ? await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId })
    : null
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
    tenantId,
    query: { userId: parsed.data.userId, tenantId },
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

  // Every grant check is answered in the actor's own scope, never in the scope
  // resolved for the record: passing the resolved one would ask a foreign tenant
  // whether this caller may act there, and for a tenant-less actor — whose scope
  // comes from the target — it would compare the target against itself.
  const actorTenantId = auth.tenantId ?? null
  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: actorTenantId, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  // The scope the row is read and written in. `auth.tenantId` is `string | null`
  // — never `undefined`, since every producer normalizes with `?? null` — so the
  // pre-fix lookup ran `tenant_id IS NULL` against a NOT NULL column: it matched
  // no row, leaving create/update to fail the NOT NULL constraint and clear to
  // no-op silently. Nothing cross-tenant was ever matched; the fix turns a 500
  // into a working, correctly scoped write.
  const resolution = await resolveAclTenantId({
    em: em as EntityManager,
    auth,
    actorIsSuperAdmin,
    userId: parsed.data.userId,
    requestedTenantId: parsed.data.tenantId,
  })
  if ('error' in resolution) return resolution.error
  const tenantId = resolution.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Tenant required' }, { status: 400 })

  if (!actorIsSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: actorTenantId,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: actorTenantId,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
        organizationScope: await resolveOrganizationScopeForRequest({
          container,
          auth,
          request: req,
          tenantId: actorTenantId,
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
      tenantId: actorTenantId,
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

  // What the caller asked for, handed to the command only when it exceeds what
  // is about to be written. `assertActorCanGrantAcl` above refuses the blatant
  // escalations; what reaches the strip is quieter — a restricted grant the
  // actor does hold — and it leaves before/after identical, so the audit entry
  // would otherwise be indistinguishable from a no-op and skipped as one.
  //
  // Features are the only axis that can be trimmed. A super-admin request is
  // either honoured or refused outright above, never silently downgraded, so
  // comparing the two flags here would be dead weight.
  //
  // Deliberately independent of the `sanitized` response flag below:
  // `hasRestrictedChanges` stays false when the trimmed result equals the
  // existing ACL, to avoid nagging the user about a save that changed nothing —
  // but that is precisely an attempt the trail must keep.
  const strippedFeatures = requestedFeatures.filter((feature) => !effectiveFeatures.includes(feature))

  // Route the write through the command bus so the permission change lands in
  // the action log. The command owns the transactional write (or removal) and
  // the RBAC cache invalidation that used to live here.
  const commandBus = container.resolve('commandBus') as CommandBus
  // A tenant-less actor edits an override in the target user's tenant, so their
  // organization belongs to a tenant the entry is not about. The bus resolves
  // the log row's organization as `metadata.organizationId ??
  // ctx.selectedOrganizationId ?? ctx.auth.orgId` — a `??` chain, so the
  // handler's `resolveOrganizationId` cannot express "explicitly no
  // organization" and the actor's would be restored. Strip it from the context
  // instead, exactly as the roles route does: otherwise the entry carries a
  // (target tenant, foreign organization) pair that `ActionLogService` — which
  // filters organization with strict equality — can never surface for anyone.
  const isForeignTenant = tenantId !== (auth.tenantId ?? null)
  const actorOrgId = isForeignTenant ? null : auth.orgId ?? null
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: isForeignTenant ? { ...auth, orgId: null } : auth,
    organizationScope: null,
    selectedOrganizationId: actorOrgId,
    organizationIds: actorOrgId ? [actorOrgId] : null,
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
      requested: strippedFeatures.length ? { features: requestedFeatures } : null,
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
      description: 'Returns custom ACL overrides for a user, scoped to the requested tenant when supplied and to the actor or target user tenant otherwise.',
      query: getSchema,
      responses: [
        { status: 200, description: 'User ACL entry', schema: userAclResponseSchema },
        { status: 400, description: 'Invalid user id', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
        { status: 403, description: 'Insufficient privileges for the requested tenant scope', schema: userAclErrorSchema },
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
