import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { defaultExportFilename, serializeExport, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { extractChangeRows } from '@open-mercato/core/modules/audit_logs/lib/changeRows'
import {
  ACTION_LOG_FILTER_TYPES,
  deriveActionLogActionType,
  deriveActionLogSource,
} from '@open-mercato/core/modules/audit_logs/lib/projections'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { loadAuditLogDisplayMaps } from '../../display'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

const ACTION_TYPE_TOKENS = ACTION_LOG_FILTER_TYPES
const SORT_FIELDS = ['createdAt', 'user', 'action', 'field', 'source'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

const exportQuerySchema = z.object({
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
  undoableOnly: z
    .enum(['true', 'false'])
    .default('false')
    .describe('When `true`, only undoable actions are returned')
    .optional(),
  limit: z.string().describe('Maximum number of records to export (default 1000, capped at 1000)').optional(),
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

const responseSchema = z.object({
  file: z.literal('csv'),
})

const errorSchema = z.object({
  error: z.string(),
})

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

function parseLimit(param: string | null): number {
  if (!param) return 1000
  const value = Number(param)
  if (!Number.isFinite(value)) return 1000
  return Math.min(Math.max(Math.trunc(value), 1), 1000)
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return undefined
  return new Date(timestamp)
}

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((entry) => formatValue(entry)).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  const rbac = container.resolve('rbacService') as RbacService
  const actionLogs = container.resolve('actionLogService') as ActionLogService
  const em = container.resolve('em') as EntityManager

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
  const undoableOnly = parseBooleanToken(url.searchParams.get('undoableOnly')) === true
  const limit = parseLimit(url.searchParams.get('limit'))
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

  const entriesResult = await actionLogs.list({
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
    before,
    after,
  })
  const entries = entriesResult.items

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: entries.map((entry) => entry.actorUserId).filter((value): value is string => Boolean(value)),
    tenantIds: entries.map((entry) => entry.tenantId).filter((value): value is string => Boolean(value)),
    organizationIds: entries.map((entry) => entry.organizationId).filter((value): value is string => Boolean(value)),
  })

  const rows = entries.flatMap((entry) => {
    const actionType = deriveActionLogActionType(entry)
    const actionLabel = actionType === 'system'
      ? entry.actionLabel ?? 'System'
      : actionType.charAt(0).toUpperCase() + actionType.slice(1)
    const baseRow = {
      when: entry.createdAt?.toISOString?.() ?? '',
      user: entry.actorUserId ? displayMaps.users[entry.actorUserId] ?? entry.actorUserId : 'System',
      action: actionLabel,
      source: deriveActionLogSource(entry.contextJson, entry.actorUserId).toUpperCase(),
    }
    const changes = extractChangeRows(entry.changesJson, entry.snapshotBefore)

    if (changes.length === 0) {
      return [{
        ...baseRow,
        field: '',
        oldValue: '',
        newValue: '',
      }]
    }

    return changes.map((change) => {
      return {
        ...baseRow,
        field: change.field,
        oldValue: formatValue(change.from),
        newValue: formatValue(change.to),
      }
    })
  })

  const prepared: PreparedExport = {
    columns: [
      { field: 'when', header: 'When' },
      { field: 'user', header: 'User' },
      { field: 'action', header: 'Action' },
      { field: 'field', header: 'Field' },
      { field: 'oldValue', header: 'Old Value' },
      { field: 'newValue', header: 'New Value' },
      { field: 'source', header: 'Source' },
    ],
    rows,
  }

  const serialized = serializeExport(prepared, 'csv')
  const filename = defaultExportFilename('changelog-export', 'csv')

  return new Response(serialized.body, {
    headers: {
      'content-type': serialized.contentType,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Export action audit logs',
  description: 'Exports filtered action audit log entries for the current tenant as CSV.',
  methods: {
    GET: {
      summary: 'Export action logs as CSV',
      description:
        'Returns a CSV attachment containing filtered action audit log entries. Tenant administrators can widen the scope to other actors or organizations.',
      query: exportQuerySchema,
      responses: [
        { status: 200, description: 'CSV export generated successfully', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid filter values', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
      ],
    },
  },
}
