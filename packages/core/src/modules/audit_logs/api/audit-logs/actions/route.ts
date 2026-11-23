import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/shared/lib/auth/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadAuditLogDisplayMaps } from '../display'
import { requireResolvedTenantScope } from '../readScope'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { crudFormSectionSinkSnapshotProtocol } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { isRecord } from '@open-mercato/shared/lib/utils'
import { ACTION_LOG_FILTER_TYPES } from '@open-mercato/core/modules/audit_logs/lib/projections'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCanonicalAuthSubject } from '@open-mercato/core/modules/audit_logs/lib/actorSubject'
import { redactActionLogEntries } from '@open-mercato/core/modules/audit_logs/lib/actionLogRedaction'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import { getEnrichersForEntity } from '@open-mercato/shared/lib/crud/enricher-registry'

const AUDIT_ACTION_LOG_ENRICHER_ENTITY = 'audit_logs.action_log'

function publicActionLogContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isRecord(context?.extensions)) return context
  const extensions = { ...context.extensions }
  let removedSnapshot = false
  for (const [ownerId, owner] of Object.entries(extensions)) {
    if (!isRecord(owner)) continue
    const entries = Object.entries(owner)
    const publicEntries = entries.filter(([, entry]) =>
      !isRecord(entry) || entry.protocol !== crudFormSectionSinkSnapshotProtocol)
    if (publicEntries.length === entries.length) continue
    removedSnapshot = true
    if (publicEntries.length) extensions[ownerId] = Object.fromEntries(publicEntries)
    else delete extensions[ownerId]
  }
  if (!removedSnapshot) return context
  const { extensions: _privateExtensions, ...otherContext } = context
  return Object.keys(extensions).length ? { ...otherContext, extensions } : otherContext
}

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
  ids: z
    .string()
    .describe('Restrict results to these action log IDs (comma-separated UUIDs, at most 100). Actor and organization scoping still apply.')
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
  limit: z
    .string()
    .describe('Maximum number of records to return (default 50, max 1000). Ignored when `pageSize` is sent.')
    .optional(),
  offset: z
    .string()
    .describe('Zero-based record offset for pagination (legacy — prefer page/pageSize). Takes precedence over `page` when both are sent.')
    .optional(),
  page: z.string().describe('Page number (default 1). Ignored when `offset` is sent.').optional(),
  pageSize: z.string().describe('Page size (default 50, max 200). Takes precedence over `limit` when both are sent.').optional(),
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

function parseOptionalInteger(param: string | null, { min, max }: { min: number; max: number }): number | undefined {
  if (param === null || param.trim() === '') return undefined
  const value = Number(param)
  if (!Number.isFinite(value)) return undefined
  return Math.min(Math.max(Math.trunc(value), min), max)
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

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const canonicalAuthSubject = resolveCanonicalAuthSubject(auth)
  if (!canonicalAuthSubject) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantScopeGuard = requireResolvedTenantScope(auth)
  if (tenantScopeGuard) return tenantScopeGuard

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  try {
    resolveSingleOrganizationIdOrDeny(scope, auth)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

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
  const ids = parseIdsParam(url.searchParams.get('ids'), 100)
  const resourceKind = url.searchParams.get('resourceKind') ?? undefined
  const resourceId = url.searchParams.get('resourceId') ?? undefined
  const actionTypes = parseActionTypes(url.searchParams.get('actionType'))
  const fieldNames = splitCsv(url.searchParams.get('fieldName'))
  const includeRelated = parseBooleanToken(url.searchParams.get('includeRelated')) === true
  const includeTotal = parseBooleanToken(url.searchParams.get('includeTotal')) === true
  const undoableOnly = parseBooleanToken(url.searchParams.get('undoableOnly')) === true
  const limit = parseOptionalInteger(url.searchParams.get('limit'), { min: 1, max: 1000 })
  const offset = parseOptionalInteger(url.searchParams.get('offset'), { min: 0, max: Number.MAX_SAFE_INTEGER })
  const page = parseOptionalInteger(url.searchParams.get('page'), { min: 1, max: 1000000 })
  const pageSize = parseOptionalInteger(url.searchParams.get('pageSize'), { min: 1, max: 200 })
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

  const actorSubject = canViewTenant ? undefined : canonicalAuthSubject.subject
  let actorUserId: string | undefined
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
    actorSubject,
    actorUserId,
    actorUserIds,
    ids: ids.length > 0 ? ids : undefined,
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
  let list: Awaited<ReturnType<ActionLogService['list']>>
  try {
    list = await actionLogs.list(listQuery)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    throw err
  }

  const { translate } = await resolveTranslations()

  // Redaction is a generic extension point an optional module (e.g. `customers`)
  // registers into (#8887, #8978) — this route never statically imports or names
  // that module (see `packages/core/AGENTS.md` § Cross-Module Coupling and
  // `audit_logs/lib/actionLogRedaction.ts`).
  const redactedItems = await redactActionLogEntries(
    container,
    em,
    { tenantId: auth.tenantId ?? '', organizationId: organizationId ?? null },
    auth.sub,
    list.items,
  )

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: redactedItems.map((entry) => entry.actorUserId).filter((value): value is string => !!value),
    tenantIds: redactedItems.map((entry) => entry.tenantId).filter((value): value is string => !!value),
    organizationIds: redactedItems.map((entry) => entry.organizationId).filter((value): value is string => !!value),
  }, { translate })

  const items = redactedItems.map((entry) => ({
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
    context: publicActionLogContext(entry.contextJson),
  }))

  const enrichedItems = await enrichActionItems(items, {
    rbac,
    em,
    container,
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: organizationId ?? null,
  })

  return NextResponse.json({
    items: enrichedItems,
    canViewTenant,
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages,
  })
}

/**
 * Runs only the enrichers registered for `audit_logs.action_log` itself; wildcard
 * enrichers are excluded so the audit list does not inherit unrelated per-entity work.
 */
async function enrichActionItems<T extends Record<string, unknown>>(
  items: T[],
  ctx: {
    rbac: RbacService
    em: EntityManager
    container: unknown
    userId: string
    tenantId: string | null
    organizationId: string | null
  },
): Promise<T[]> {
  if (items.length === 0) return items
  const entries = getEnrichersForEntity(AUDIT_ACTION_LOG_ENRICHER_ENTITY).filter(
    (entry) => entry.enricher.targetEntity === AUDIT_ACTION_LOG_ENRICHER_ENTITY,
  )
  if (entries.length === 0) return items
  let grantedFeatures: string[] | undefined
  try {
    grantedFeatures = await ctx.rbac.getGrantedFeatures(ctx.userId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch {
    grantedFeatures = undefined
  }
  const enriched = await applyResponseEnrichers(items, AUDIT_ACTION_LOG_ENRICHER_ENTITY, {
    tenantId: ctx.tenantId ?? '',
    organizationId: ctx.organizationId ?? '',
    userId: ctx.userId,
    em: ctx.em,
    container: ctx.container,
    userFeatures: grantedFeatures,
  }, entries)
  return enriched.items
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List action audit logs',
  description: 'Retrieve recent state-changing actions with undo/redo metadata for the current tenant.',
  methods: {
    GET: {
      summary: 'Fetch action logs',
      description:
        'Returns recent action audit log entries. Tenant administrators can widen the scope to other actors or organizations, and callers can optionally restrict results to undoable actions. Items may carry `_`-prefixed fields added by response enrichers that explicitly target `audit_logs.action_log` (wildcard enrichers do not run here).',
      query: auditActionQuerySchema,
      responses: [
        { status: 200, description: 'Action logs retrieved successfully', schema: auditActionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid filter values', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Caller has no resolved tenant scope and is not a superadmin, or its organization scope is explicitly empty', schema: errorSchema },
      ],
    },
  },
}
