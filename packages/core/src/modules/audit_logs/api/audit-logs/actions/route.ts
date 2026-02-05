import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadAuditLogDisplayMaps } from '../display'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

const auditActionQuerySchema = z.object({
  organizationId: z.string().uuid().describe('Limit results to a specific organization').optional(),
  actorUserId: z.string().uuid().describe('Filter logs created by a specific actor (tenant administrators only)').optional(),
  resourceKind: z.string().describe('Filter by resource kind (e.g., "order", "product")').optional(),
  resourceId: z.string().describe('Filter by resource ID (UUID of the specific record)').optional(),
  undoableOnly: z
    .enum(['true', 'false'])
    .default('false')
    .describe('When `true`, only undoable actions are returned')
    .optional(),
  limit: z.string().describe('Maximum number of records to return (default 50)').optional(),
  before: z.string().describe('Return actions created before this ISO-8601 timestamp').optional(),
  after: z.string().describe('Return actions created after this ISO-8601 timestamp').optional(),
})

const auditActionItemSchema = z.object({
  id: z.string(),
  commandId: z.string(),
  actionLabel: z.string().nullable(),
  executionState: z.enum(['done', 'undone', 'failed', 'redone']),
  actorUserId: z.string().uuid().nullable(),
  actorUserName: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  resourceKind: z.string().nullable(),
  resourceId: z.string().nullable(),
  undoToken: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  snapshotBefore: z.unknown().nullable(),
  snapshotAfter: z.unknown().nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  context: z.record(z.string(), z.unknown()).nullable(),
})

const auditActionResponseSchema = z.object({
  items: z.array(auditActionItemSchema),
  canViewTenant: z.boolean(),
})

const errorSchema = z.object({
  error: z.string(),
})

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts)
}

function parseLimit(param: string | null): number {
  if (!param) return 50
  const value = Number(param)
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.trunc(value), 1), 200)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })

  const rbac = (container.resolve('rbacService') as RbacService)
  const actionLogs = (container.resolve('actionLogService') as ActionLogService)
  const em = (container.resolve('em') as EntityManager)

  const canViewTenant = await rbac.userHasAllFeatures(
    auth.sub,
    ['audit_logs.view_tenant'],
    { tenantId: auth.tenantId ?? null, organizationId: defaultOrganizationId ?? null },
  )

  const url = new URL(req.url)
  const queryOrgId = url.searchParams.get('organizationId')
  const actorQuery = url.searchParams.get('actorUserId')
  const resourceKind = url.searchParams.get('resourceKind') ?? undefined
  const resourceId = url.searchParams.get('resourceId') ?? undefined
  const undoableOnly = parseBooleanToken(url.searchParams.get('undoableOnly')) === true
  const limit = parseLimit(url.searchParams.get('limit'))
  const before = parseDate(url.searchParams.get('before'))
  const after = parseDate(url.searchParams.get('after'))

  let organizationId = defaultOrganizationId
  if (queryOrgId) {
    if (scope.allowedIds === null || scope.allowedIds.includes(queryOrgId)) {
      organizationId = queryOrgId
    }
  }

  let actorUserId: string | undefined = canViewTenant ? undefined : auth.sub
  if (canViewTenant && actorQuery) {
    actorUserId = actorQuery
  }

  const list = await actionLogs.list({
    tenantId: auth.tenantId ?? undefined,
    organizationId: organizationId ?? undefined,
    actorUserId,
    resourceKind,
    resourceId,
    undoableOnly,
    limit,
    before,
    after,
  })

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: list.map((entry) => entry.actorUserId).filter((value): value is string => !!value),
    tenantIds: list.map((entry) => entry.tenantId).filter((value): value is string => !!value),
    organizationIds: list.map((entry) => entry.organizationId).filter((value): value is string => !!value),
  })

  const items = list.map((entry) => ({
    id: entry.id,
    commandId: entry.commandId,
    actionLabel: entry.actionLabel,
    executionState: entry.executionState,
    actorUserId: entry.actorUserId,
    actorUserName: entry.actorUserId ? displayMaps.users[entry.actorUserId] ?? null : null,
    tenantId: entry.tenantId,
    tenantName: entry.tenantId ? displayMaps.tenants[entry.tenantId] ?? null : null,
    organizationId: entry.organizationId,
    organizationName: entry.organizationId ? displayMaps.organizations[entry.organizationId] ?? null : null,
    resourceKind: entry.resourceKind,
    resourceId: entry.resourceId,
    undoToken: entry.undoToken,
    createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
    snapshotBefore: entry.snapshotBefore,
    snapshotAfter: entry.snapshotAfter,
    changes: entry.changesJson,
    context: entry.contextJson,
  }))

  return NextResponse.json({ items, canViewTenant })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List action audit logs',
  description: 'Retrieve recent state-changing actions with undo/redo metadata for the current tenant.',
  methods: {
    GET: {
      summary: 'Fetch action logs',
      description:
        'Returns recent action audit log entries. Tenant administrators can widen the scope to other actors or organizations, and callers can optionally restrict results to undoable actions.',
      query: auditActionQuerySchema,
      responses: [
        { status: 200, description: 'Action logs retrieved successfully', schema: auditActionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid filter values', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
      ],
    },
  },
}
