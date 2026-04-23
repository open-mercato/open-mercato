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
import { ACTION_LOG_FILTER_TYPES } from '@open-mercato/core/modules/audit_logs/lib/projections'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

const ACTION_TYPE_TOKENS = ACTION_LOG_FILTER_TYPES
const SORT_FIELDS = ['createdAt', 'user', 'action', 'field', 'source'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

const auditActionQuerySchema = z.object({
  organizationId: z.string().uuid().describe('Limit results to a specific organization').optional(),
  actorUserId: z
    .string()
    .describe('Filter logs created by specific actor IDs (tenant administrators only). Accepts a single UUID or a comma-separated UUID list.')
    .optional(),
  resourceKind: z.string().describe('Filter by resource kind (e.g., "order", "product")').optional(),
  resourceId: z.string().describe('Filter by resource ID (UUID of the specific record)').optional(),
  actionType: z
    .string()
    .describe('Filter by action type (`create`, `edit`, `delete`, `assign`). Accepts a single value or a comma-separated list.')
    .optional(),
  fieldName: z
    .string()
    .describe('Filter to entries where the given field changed. Accepts a single field name or a comma-separated list.')
    .optional(),
  includeRelated: z
    .enum(['true', 'false'])
    .default('false')
    .describe('When `true`, also returns changes to child entities linked via parentResourceKind/parentResourceId')
    .optional(),
  includeTotal: z
    .enum(['true', 'false'])
    .default('false')
    .describe('When `true`, the response includes the filtered total count.')
    .optional(),
  undoableOnly: z
    .enum(['true', 'false'])
    .default('false')
    .describe('When `true`, only undoable actions are returned')
    .optional(),
  limit: z.string().describe('Maximum number of records to return (default 50, max 1000)').optional(),
  offset: z.string().describe('Zero-based record offset for pagination (legacy — prefer page/pageSize)').optional(),
  page: z.string().describe('Page number (default 1)').optional(),
  pageSize: z.string().describe('Page size (default 50, max 200)').optional(),
  sortField: z
    .enum(SORT_FIELDS)
    .describe('Sort field: `createdAt`, `user`, `action`, `field`, or `source`.')
    .optional(),
  sortDir: z
    .enum(SORT_DIRECTIONS)
    .describe('Sort direction: `asc` or `desc`.')
    .optional(),
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
  parentResourceKind: z.string().nullable().optional(),
  parentResourceId: z.string().nullable().optional(),
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
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
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
  return Math.min(Math.max(Math.trunc(value), 1), 1000)
}

function parseOffset(param: string | null): number {
  if (!param) return 0
  const value = Number(param)
  if (!Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function splitCsv(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseActionTypes(param: string | null) {
  return splitCsv(param).filter((value): value is (typeof ACTION_TYPE_TOKENS)[number] =>
    ACTION_TYPE_TOKENS.includes(value as (typeof ACTION_TYPE_TOKENS)[number]),
  )
}

function parseNumber(param: string | null, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  if (!param) return fallback
  const value = Number(param)
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  if (Number.isNaN(normalized)) return fallback
  return Math.min(Math.max(normalized, min), max)
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
  const actionTypes = parseActionTypes(url.searchParams.get('actionType'))
  const fieldNames = splitCsv(url.searchParams.get('fieldName'))
  const includeRelated = parseBooleanToken(url.searchParams.get('includeRelated')) === true
  const includeTotal = parseBooleanToken(url.searchParams.get('includeTotal')) === true
  const undoableOnly = parseBooleanToken(url.searchParams.get('undoableOnly')) === true
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))
  const page = parseNumber(url.searchParams.get('page'), { min: 1, max: 1000000, fallback: 1 })
  const pageSize = parseNumber(url.searchParams.get('pageSize'), { min: 1, max: 200, fallback: 50 })
  const sortField = SORT_FIELDS.find((value) => value === url.searchParams.get('sortField')) ?? 'createdAt'
  const sortDir = SORT_DIRECTIONS.find((value) => value === url.searchParams.get('sortDir')) ?? 'desc'
  const before = parseDate(url.searchParams.get('before'))
  const after = parseDate(url.searchParams.get('after'))

  let organizationId = defaultOrganizationId
  if (queryOrgId) {
    if (scope.allowedIds === null || scope.allowedIds.includes(queryOrgId)) {
      organizationId = queryOrgId
    }
  }

  let actorUserId: string | undefined = canViewTenant ? undefined : auth.sub
  let actorUserIds: string[] | undefined
  if (canViewTenant && actorQuery) {
    const parsedActorUserIds = splitCsv(actorQuery)
    if (parsedActorUserIds.length === 1) {
      actorUserId = parsedActorUserIds[0]
    } else if (parsedActorUserIds.length > 1) {
      actorUserId = undefined
      actorUserIds = parsedActorUserIds
    }
  }

  const listQuery = {
    tenantId: auth.tenantId ?? undefined,
    organizationId: organizationId ?? undefined,
    actorUserId,
    actorUserIds,
    resourceKind,
    resourceId,
    actionTypes,
    fieldNames,
    includeRelated,
    undoableOnly,
    sortField,
    sortDir,
    limit,
    offset,
    page,
    pageSize,
    before,
    after,
  }

  // includeTotal flag is retained for backward compatibility but page-based pagination
  // always returns total/totalPages from the list query's findAndCount.
  void includeTotal
  const list = await actionLogs.list(listQuery)

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: list.items.map((entry: any) => entry.actorUserId).filter((value: any): value is string => !!value),
    tenantIds: list.items.map((entry: any) => entry.tenantId).filter((value: any): value is string => !!value),
    organizationIds: list.items.map((entry: any) => entry.organizationId).filter((value: any): value is string => !!value),
  })

  const items = list.items.map((entry: any) => ({
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
    parentResourceKind: entry.parentResourceKind,
    parentResourceId: entry.parentResourceId,
    undoToken: entry.undoToken,
    createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
    snapshotBefore: entry.snapshotBefore,
    snapshotAfter: entry.snapshotAfter,
    changes: entry.changesJson,
    context: entry.contextJson,
  }))

  return NextResponse.json({
    items,
    canViewTenant,
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages,
  })
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
