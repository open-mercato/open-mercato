import { NextResponse } from 'next/server'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('audit_logs').child({ component: 'undo' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['audit_logs.undo_self'] },
}

type UndoRequestBody = {
  undoToken?: string
}

const undoRequestSchema = z.object({
  undoToken: z.string().min(1).describe('Undo token issued by the action log entry'),
})

const undoResponseSchema = z.object({
  ok: z.literal(true),
  logId: z.string().describe('Identifier of the action log that was undone'),
})

const errorSchema = z.object({
  error: z.string(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as UndoRequestBody | null
  const undoToken = body?.undoToken?.trim()
  if (!undoToken) return NextResponse.json({ error: 'Invalid undo token' }, { status: 400 })

  const container = await createRequestContainer()
  const commandBus = (container.resolve('commandBus') as CommandBus)
  const logs = (container.resolve('actionLogService') as ActionLogService)
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  const { organizationId } = await resolveFeatureCheckContext({ container, auth, request: req })

  const canUndoTenant = rbac
    ? await rbac.userHasAllFeatures(auth.sub, ['audit_logs.undo_tenant'], {
        tenantId: auth.tenantId ?? null,
        organizationId,
      })
    : false

  const target = await logs.findByUndoToken(undoToken)
  if (!target || target.executionState !== 'done') {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }
  if (target.actorUserId && target.actorUserId !== auth.sub && !canUndoTenant) {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }
  // Fail closed on tenant scope: `audit_logs.undo_tenant` only widens scope WITHIN a
  // tenant, never across tenants, so a tenant-scoped target always requires a caller
  // bound to that same tenant. A caller whose tenantId is null (tenant-less global
  // account or unscoped API key) must never undo a tenant-scoped row (issue #2685).
  if (target.tenantId && target.tenantId !== (auth.tenantId ?? null)) {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }
  const scopedOrgId = canUndoTenant ? organizationId ?? null : organizationId ?? auth.orgId ?? null
  // Tenant-level undoers may undo across organizations within the tenant, so an
  // unresolved (null) caller org is allowed and only an explicit mismatch is rejected.
  // Every other caller must resolve to the target's own organization — a null caller
  // org must not bypass an org-scoped target (issue #2685).
  const orgScopeMismatch = canUndoTenant
    ? Boolean(target.organizationId && scopedOrgId && target.organizationId !== scopedOrgId)
    : Boolean(target.organizationId && target.organizationId !== scopedOrgId)
  if (orgScopeMismatch) {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }

  const lookupActorId = canUndoTenant ? (target.actorUserId ?? auth.sub) : auth.sub
  // Scope the latest-undoable re-lookup to the target row's own organization, not
  // the caller's currently-resolved org. The actor/tenant/org guards above already
  // authorized the caller for this row; reusing the caller's scope here breaks undo
  // for tenant-level rows (organization create/update/delete/reparent log with a
  // null organization_id) whenever the caller resolves to a concrete home org, so
  // the lookup never matches and returns "Undo token not available" (issue #2398).
  const lookupOrgId = target.organizationId ?? null
  let latest = null
  if (target.resourceKind || target.resourceId) {
    latest = await logs.latestUndoableForResource({
      actorUserId: lookupActorId,
      tenantId: auth.tenantId ?? null,
      organizationId: lookupOrgId,
      resourceKind: target.resourceKind ?? undefined,
      resourceId: target.resourceId ?? undefined,
    })
  }
  if (!latest) {
    latest = await logs.latestUndoableForActor(lookupActorId, {
      tenantId: auth.tenantId ?? null,
      organizationId: lookupOrgId,
    })
  }
  if (!latest || latest.id !== target.id) {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }

  try {
    const ctx = await createRuntimeContext(container, auth, req)
    await commandBus.undo(undoToken, ctx)
    return NextResponse.json({ ok: true, logId: target.id })
  } catch (err) {
    logger.error('Undo failed', { err })
    return NextResponse.json({ error: 'Undo failed' }, { status: 400 })
  }
}

async function createRuntimeContext(container: AwilixContainer, auth: AuthContext, request: Request): Promise<CommandRuntimeContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  return {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope.selectedId,
    organizationIds: scope.filterIds,
    request,
  }
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Undo a recent action',
  description: 'Executes the undo operation for the most recent undoable action belonging to the caller.',
  methods: {
    POST: {
      summary: 'Undo action by token',
      description:
        'Replays the undo handler registered for a command. The provided undo token must match the latest undoable log entry accessible to the caller.',
      requestBody: {
        contentType: 'application/json',
        schema: undoRequestSchema,
      },
      responses: [
        { status: 200, description: 'Undo applied successfully', schema: undoResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid or unavailable undo token', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Undo blocked by organization or tenant scope', schema: errorSchema },
      ],
    },
  },
}
