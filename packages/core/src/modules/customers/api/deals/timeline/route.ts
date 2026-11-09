import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'
import { SortDir, type QueryEngine, type Sort } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDictionaryEntry,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../../data/entities'
import { buildDealListFilters, dealListQuerySchema } from '../route'
import { CLOSED_DEAL_STATUS_LIST, expandDealStatusAliases } from '../../../lib/dealStatus'
import {
  DEAL_TIMELINE_BUCKETS,
  DEAL_TIMELINE_GROUP_BY,
  DEAL_TIMELINE_MAX_COLUMNS,
  DEAL_TIMELINE_MIN_COLUMNS,
  DEAL_TIMELINE_UNASSIGNED_LANE,
  DEAL_TIMELINE_WEEK_STARTS_ON,
  buildTimelineColumns,
  compareDateKeys,
  dateKeyToUtcDate,
  defaultColumnCount,
  defaultTimelineFrom,
  isValidDateKey,
  noStageLaneKey,
  parseNoStageLaneKey,
  toUtcDateKey,
  type DealTimelineColumn,
  type DealTimelineGroupBy,
} from '../../../lib/dealsTimeline'
import type {
  DealTimelineAssociation,
  DealTimelineCell,
  DealTimelineItem,
  DealTimelineLane,
  DealTimelineStageMeta,
} from '../../../lib/dealsTimelineTypes'
import { E } from '#generated/entities.ids.generated'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

export const TIMELINE_COLUMN_CAP = 300
export const TIMELINE_RESPONSE_CARD_CAP = 240
const QUERY_CONCURRENCY = 2
const PIPELINES_VIEW_FEATURE = 'customers.pipelines.view'

const logger = createLogger('customers').child({ component: 'deals-timeline' })

const booleanQueryParam = z.preprocess((value) => {
  const parsed = parseBooleanFromUnknown(value)
  return parsed === null ? value : parsed
}, z.boolean()).optional()

/**
 * The only deals-list filters the timeline forwards to `buildDealListFilters`. Close-date
 * params (`expectedCloseAtFrom`/`To`, `hasExpectedCloseAt`), `isOverdue`, `needsAttention` and the
 * advanced-filter tree are deliberately absent: the timeline window bounds close dates itself, and
 * forwarding them would reintroduce the contradictory combinations the deals list rejects.
 */
export const TIMELINE_FILTER_QUERY_FIELDS = {
  search: true,
  status: true,
  pipelineId: true,
  ownerUserId: true,
  personId: true,
  companyId: true,
  valueCurrency: true,
} as const

export type TimelineFilterQueryKey = keyof typeof TIMELINE_FILTER_QUERY_FIELDS

export function pickTimelineFilterQuery(query: Partial<Record<string, unknown>>): Partial<Record<TimelineFilterQueryKey, unknown>> {
  const picked: Partial<Record<TimelineFilterQueryKey, unknown>> = {}
  for (const key of Object.keys(TIMELINE_FILTER_QUERY_FIELDS) as TimelineFilterQueryKey[]) {
    if (query[key] !== undefined) picked[key] = query[key]
  }
  return picked
}

const querySchema = dealListQuerySchema
  .pick(TIMELINE_FILTER_QUERY_FIELDS)
  .extend({
    bucket: z.enum(DEAL_TIMELINE_BUCKETS).default('week'),
    from: z.string().refine(isValidDateKey, { message: 'Expected YYYY-MM-DD' }).optional(),
    columns: z.coerce.number().int().min(DEAL_TIMELINE_MIN_COLUMNS).max(DEAL_TIMELINE_MAX_COLUMNS).optional(),
    groupBy: z.enum(DEAL_TIMELINE_GROUP_BY).default('owner'),
    perCell: z.coerce.number().int().min(1).max(10).default(3),
    excludeClosed: booleanQueryParam,
    cellLane: z.string().min(1).optional(),
    cellColumn: z.coerce.number().int().min(0).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })

type TimelineQuery = z.infer<typeof querySchema>

const associationSchema = z.object({ id: z.string().uuid(), label: z.string() })

const itemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  valueAmount: z.number().nullable(),
  valueCurrency: z.string().nullable(),
  probability: z.number().nullable(),
  expectedCloseAt: z.string().nullable(),
  pipelineId: z.string().uuid().nullable(),
  pipelineStageId: z.string().uuid().nullable(),
  pipelineStage: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
  primaryCompany: associationSchema.nullable(),
  primaryPerson: associationSchema.nullable(),
})

const timelineResponseSchema = z.object({
  bucket: z.enum(DEAL_TIMELINE_BUCKETS),
  groupBy: z.enum(DEAL_TIMELINE_GROUP_BY),
  weekStartsOn: z.number(),
  from: z.string(),
  to: z.string(),
  columns: z.array(
    z.object({
      index: z.number(),
      from: z.string(),
      to: z.string(),
      isCurrent: z.boolean(),
      total: z.number(),
      truncated: z.boolean(),
      countCapped: z.boolean(),
    }),
  ),
  lanes: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(DEAL_TIMELINE_GROUP_BY),
      owner: z.object({ id: z.string().uuid() }).nullable(),
      stage: z
        .object({
          label: z.string(),
          pipelineId: z.string().uuid().nullable(),
          order: z.number().nullable().optional(),
          tone: z.string().nullable().optional(),
          pipelineName: z.string().nullable().optional(),
        })
        .nullable(),
      total: z.number(),
      partial: z.boolean(),
      cells: z.array(
        z.object({ column: z.number(), total: z.number(), partial: z.boolean(), items: z.array(itemSchema) }),
      ),
    }),
  ),
  overdueBefore: z.object({
    count: z.number(),
    latestExpectedCloseAt: z.string().nullable(),
    before: z.string(),
    countCapped: z.boolean(),
  }),
  undatedCount: z.number(),
  undatedCountCapped: z.boolean(),
  adjacent: z.object({ previous: z.string().nullable(), next: z.string().nullable() }),
  scopeHasDeals: z.boolean(),
  truncated: z.boolean(),
  cardsTruncated: z.boolean(),
  countsCapped: z.boolean(),
})

const cellResponseSchema = z.object({
  lane: z.string(),
  column: z.number(),
  items: z.array(itemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  countsCapped: z.boolean(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deals close-date timeline',
  methods: {
    GET: {
      summary: 'Deals bucketed by expected close date into lanes and period columns',
      description:
        'Returns the deals timeline grid: owner or pipeline-stage lanes against week, month or quarter columns (half-open UTC date ranges, ISO weeks starting Monday), with exact column totals, the top `perCell` deals per cell, and side counts (overdue before the window, undated deals, nearest deals outside the window). With `cellLane` + `cellColumn` it returns one cell paged instead. Filters match the deals list.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Timeline grid, or one paged cell in cell mode', schema: z.union([timelineResponseSchema, cellResponseSchema]) },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing required features', schema: errorSchema },
      ],
    },
  },
}

type Filters = Record<string, unknown>

type LightRow = {
  id: string
  laneKey: string
  pipelineId: string | null
  pipelineStage: string | null
}

type ColumnPass = {
  column: DealTimelineColumn
  total: number
  truncated: boolean
  countCapped: boolean
  rows: LightRow[]
}

type QueryScope = {
  tenantId: string
  organizationId: string | undefined
  organizationIds: string[] | undefined
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return toStringOrNull(value)
}

function readRefId(ref: unknown): string | null {
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object') {
    const id = (ref as Record<string, unknown>).id
    return typeof id === 'string' ? id : null
  }
  return null
}

function readRefLabel(ref: unknown): string {
  if (ref && typeof ref === 'object') {
    const label = (ref as Record<string, unknown>).displayName
    return typeof label === 'string' ? label : ''
  }
  return ''
}

function readArrayParam(searchParams: URLSearchParams, key: string): string[] | undefined {
  const values = readQueryParamList(searchParams, key)
  return values.length ? values : undefined
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

export function mergeFieldCondition(filters: Filters, field: string, condition: Record<string, unknown>): Filters {
  const existing = filters[field]
  if (existing === undefined) return { ...filters, [field]: condition }
  if (isOperatorObject(existing)) {
    const collides = Object.keys(condition).some((operator) => operator in existing)
    if (!collides) return { ...filters, [field]: { ...existing, ...condition } }
  }
  const existingAnd = Array.isArray(filters.$and) ? (filters.$and as unknown[]) : []
  return { ...filters, $and: [...existingAnd, { [field]: condition }] }
}

function closedStatusSet(): string[] {
  return expandDealStatusAliases([...CLOSED_DEAL_STATUS_LIST])
}

function laneKeyFor(groupBy: DealTimelineGroupBy, row: Record<string, unknown>): string {
  if (groupBy === 'owner') return toStringOrNull(row.owner_user_id) ?? DEAL_TIMELINE_UNASSIGNED_LANE
  return toStringOrNull(row.pipeline_stage_id) ?? noStageLaneKey(toStringOrNull(row.pipeline_id))
}

function laneFilterFor(groupBy: DealTimelineGroupBy, laneKey: string): Filters | null {
  const uuid = z.string().uuid()
  if (groupBy === 'owner') {
    if (laneKey === DEAL_TIMELINE_UNASSIGNED_LANE) return { owner_user_id: { $eq: null } }
    return uuid.safeParse(laneKey).success ? { owner_user_id: { $eq: laneKey } } : null
  }
  const noStage = parseNoStageLaneKey(laneKey)
  if (noStage) {
    if (noStage.pipelineId && !uuid.safeParse(noStage.pipelineId).success) return null
    return { pipeline_stage_id: { $eq: null }, pipeline_id: { $eq: noStage.pipelineId } }
  }
  return uuid.safeParse(laneKey).success ? { pipeline_stage_id: { $eq: laneKey } } : null
}

function windowFilter(from: string, to: string): Record<string, unknown> {
  return { $gte: dateKeyToUtcDate(from), $lt: dateKeyToUtcDate(to) }
}

const DATE_THEN_ID_ASC: Sort[] = [
  { field: 'expected_close_at', dir: SortDir.Asc },
  { field: 'id', dir: SortDir.Asc },
]

async function runQuery(
  queryEngine: QueryEngine,
  scope: QueryScope,
  filters: Filters,
  options: { fields: string[]; sort?: Sort[]; page: number; pageSize: number },
) {
  const res = await queryEngine.query(E.customers.customer_deal, {
    fields: options.fields,
    sort: options.sort,
    page: { page: options.page, pageSize: options.pageSize },
    filters,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    organizationIds: scope.organizationIds,
  })
  const rows = (Array.isArray(res.items) ? res.items : []).filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object',
  )
  return {
    rows,
    total: typeof res.total === 'number' ? res.total : rows.length,
    countCapped: !!res.meta?.listCountCapWarning,
  }
}

async function runLightPass(
  queryEngine: QueryEngine,
  scope: QueryScope,
  baseFilters: Filters,
  column: DealTimelineColumn,
  groupBy: DealTimelineGroupBy,
): Promise<ColumnPass> {
  const filters = mergeFieldCondition(baseFilters, 'expected_close_at', windowFilter(column.from, column.to))
  const res = await runQuery(queryEngine, scope, filters, {
    fields: ['id', 'owner_user_id', 'pipeline_id', 'pipeline_stage_id', 'pipeline_stage', 'expected_close_at'],
    sort: DATE_THEN_ID_ASC,
    page: 1,
    pageSize: TIMELINE_COLUMN_CAP,
  })
  const rows: LightRow[] = []
  for (const row of res.rows) {
    const id = toStringOrNull(row.id)
    if (!id || rows.length >= TIMELINE_COLUMN_CAP) continue
    rows.push({
      id,
      laneKey: laneKeyFor(groupBy, row),
      pipelineId: toStringOrNull(row.pipeline_id),
      pipelineStage: toStringOrNull(row.pipeline_stage),
    })
  }
  const total = Math.max(res.total, rows.length)
  return { column, total, truncated: total > rows.length, countCapped: res.countCapped, rows }
}

async function runInBatches<Input, Output>(
  inputs: Input[],
  batchSize: number,
  run: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = []
  for (let index = 0; index < inputs.length; index += batchSize) {
    results.push(...(await Promise.all(inputs.slice(index, index + batchSize).map(run))))
  }
  return results
}

async function loadItems(
  em: EntityManager,
  ids: string[],
  scope: QueryScope,
  decryptionScope: { tenantId: string; organizationId: string | undefined },
): Promise<Map<string, DealTimelineItem>> {
  const byId = new Map<string, DealTimelineItem>()
  if (!ids.length) return byId
  const orgFilter = scope.organizationIds ? { organizationId: { $in: scope.organizationIds } } : {}
  const dealScope = { id: { $in: ids }, tenantId: scope.tenantId, ...orgFilter }
  const [deals, companyLinks, personLinks] = await Promise.all([
    findWithDecryption(
      em,
      CustomerDeal,
      { id: { $in: ids }, tenantId: scope.tenantId, deletedAt: null, ...orgFilter },
      {},
      decryptionScope,
    ),
    findWithDecryption(
      em,
      CustomerDealCompanyLink,
      { deal: dealScope },
      { populate: ['company'], orderBy: { createdAt: 'asc', id: 'asc' } },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      CustomerDealPersonLink,
      { deal: dealScope },
      { populate: ['person'], orderBy: { createdAt: 'asc', id: 'asc' } },
      decryptionScope,
    ),
  ])
  const companies = new Map<string, DealTimelineAssociation>()
  for (const link of companyLinks) {
    const dealId = readRefId(link.deal)
    const entityId = readRefId(link.company)
    if (!dealId || !entityId || companies.has(dealId)) continue
    companies.set(dealId, { id: entityId, label: readRefLabel(link.company) })
  }
  const people = new Map<string, DealTimelineAssociation>()
  for (const link of personLinks) {
    const dealId = readRefId(link.deal)
    const entityId = readRefId(link.person)
    if (!dealId || !entityId || people.has(dealId)) continue
    people.set(dealId, { id: entityId, label: readRefLabel(link.person) })
  }
  for (const deal of deals) {
    byId.set(deal.id, {
      id: deal.id,
      title: toStringOrNull(deal.title),
      status: toStringOrNull(deal.status),
      valueAmount: toFiniteNumberOrNull(deal.valueAmount),
      valueCurrency: toStringOrNull(deal.valueCurrency),
      probability: toFiniteNumberOrNull(deal.probability),
      expectedCloseAt: toUtcDateKey(deal.expectedCloseAt ?? null),
      pipelineId: toStringOrNull(deal.pipelineId),
      pipelineStageId: toStringOrNull(deal.pipelineStageId),
      pipelineStage: toStringOrNull(deal.pipelineStage),
      ownerUserId: toStringOrNull(deal.ownerUserId),
      updatedAt: toIsoStringOrNull(deal.updatedAt),
      primaryCompany: companies.get(deal.id) ?? null,
      primaryPerson: people.get(deal.id) ?? null,
    })
  }
  return byId
}

type StageLaneDefinition = { key: string; stage: DealTimelineStageMeta }

async function loadStageLaneDefinitions(
  em: EntityManager,
  scope: QueryScope,
  pipelineIds: string[],
  decryptionScope: { tenantId: string; organizationId: string | undefined },
): Promise<StageLaneDefinition[]> {
  const orgFilter = scope.organizationIds ? { organizationId: { $in: scope.organizationIds } } : {}
  const pipelineWhere = {
    tenantId: scope.tenantId,
    ...orgFilter,
    ...(pipelineIds.length ? { id: { $in: pipelineIds } } : {}),
  }
  const pipelines = await findWithDecryption(em, CustomerPipeline, pipelineWhere, {}, decryptionScope)
  if (!pipelines.length) return []
  const orderedPipelines = [...pipelines].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
    const byName = left.name.localeCompare(right.name)
    return byName !== 0 ? byName : left.id.localeCompare(right.id)
  })
  const stages = await findWithDecryption(
    em,
    CustomerPipelineStage,
    { tenantId: scope.tenantId, ...orgFilter, pipelineId: { $in: orderedPipelines.map((pipeline) => pipeline.id) } },
    {},
    decryptionScope,
  )
  const normalizedLabels = Array.from(new Set(stages.map((stage) => stage.label.trim().toLowerCase())))
  const dictionaryEntries = normalizedLabels.length
    ? await findWithDecryption(
        em,
        CustomerDictionaryEntry,
        { tenantId: scope.tenantId, ...orgFilter, kind: 'pipeline_stage', normalizedValue: { $in: normalizedLabels } },
        {},
        decryptionScope,
      )
    : []
  const toneByLabel = new Map<string, string | null>()
  for (const entry of dictionaryEntries) {
    if (!toneByLabel.has(entry.normalizedValue)) toneByLabel.set(entry.normalizedValue, entry.color ?? null)
  }
  const definitions: StageLaneDefinition[] = []
  for (const pipeline of orderedPipelines) {
    const pipelineStages = stages
      .filter((stage) => stage.pipelineId === pipeline.id)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    for (const stage of pipelineStages) {
      definitions.push({
        key: stage.id,
        stage: {
          label: stage.label,
          pipelineId: pipeline.id,
          order: stage.order,
          tone: toneByLabel.get(stage.label.trim().toLowerCase()) ?? null,
          pipelineName: pipeline.name,
        },
      })
    }
  }
  return definitions
}

async function userHasPipelinesView(
  container: AwilixContainer,
  userId: string | undefined,
  scope: { tenantId: string; organizationId: string | null },
): Promise<boolean> {
  if (!userId) return false
  try {
    const rbac = container.resolve<RbacService>('rbacService')
    return await rbac.userHasAllFeatures(userId, [PIPELINES_VIEW_FEATURE], scope)
  } catch (error) {
    logger.warn('Pipelines view check failed; stage lanes fall back to the restricted layout', { err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'customers',
      code: 'customers.timeline_rbac_check_failed',
    })
    return false
  }
}

function overdueBoundFor(windowFrom: string, todayKey: string): string {
  return compareDateKeys(windowFrom, todayKey) < 0 ? windowFrom : todayKey
}

function emptyGrid(query: TimelineQuery, columns: DealTimelineColumn[]) {
  const todayKey = toUtcDateKey(new Date()) as string
  return {
    bucket: query.bucket,
    groupBy: query.groupBy,
    weekStartsOn: DEAL_TIMELINE_WEEK_STARTS_ON,
    from: columns[0].from,
    to: columns[columns.length - 1].to,
    columns: columns.map((column) => ({ ...column, total: 0, truncated: false, countCapped: false })),
    lanes: [],
    overdueBefore: {
      count: 0,
      latestExpectedCloseAt: null,
      before: overdueBoundFor(columns[0].from, todayKey),
      countCapped: false,
    },
    undatedCount: 0,
    undatedCountCapped: false,
    adjacent: { previous: null, next: null },
    scopeHasDeals: false,
    truncated: false,
    cardsTruncated: false,
    countsCapped: false,
  }
}

function normalizeIdList(values: string[] | undefined): string[] {
  const uuid = z.string().uuid()
  return Array.from(new Set((values ?? []).filter((value) => uuid.safeParse(value).success)))
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { translate } = await resolveTranslations()
  const badRequest = (key: string, fallback: string) =>
    NextResponse.json({ error: translate(key, fallback) }, { status: 400 })

  const params = new URL(req.url).searchParams
  if (params.has('cellColumn') && (params.get('cellColumn') ?? '').trim() === '') {
    return badRequest('customers.errors.timeline_invalid_query', 'Invalid query parameters')
  }
  const parsed = querySchema.safeParse({
    search: params.get('search') ?? undefined,
    status: readArrayParam(params, 'status'),
    pipelineId: readArrayParam(params, 'pipelineId'),
    ownerUserId: readArrayParam(params, 'ownerUserId'),
    personId: readArrayParam(params, 'personId'),
    companyId: readArrayParam(params, 'companyId'),
    valueCurrency: readArrayParam(params, 'valueCurrency'),
    bucket: params.get('bucket') ?? undefined,
    from: params.get('from') ?? undefined,
    columns: params.get('columns') ?? undefined,
    groupBy: params.get('groupBy') ?? undefined,
    perCell: params.get('perCell') ?? undefined,
    excludeClosed: params.get('excludeClosed') ?? undefined,
    cellLane: params.get('cellLane') ?? undefined,
    cellColumn: params.get('cellColumn') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return badRequest('customers.errors.timeline_invalid_query', 'Invalid query parameters')
  }
  const query = parsed.data
  const cellMode = query.cellLane !== undefined || query.cellColumn !== undefined
  if (cellMode && (query.cellLane === undefined || query.cellColumn === undefined)) {
    return badRequest('customers.errors.timeline_cell_pairing', 'cellLane and cellColumn must be given together')
  }

  const todayKey = toUtcDateKey(new Date()) as string
  const columnCount = query.columns ?? defaultColumnCount(query.bucket)
  const columns = buildTimelineColumns(query.bucket, query.from ?? defaultTimelineFrom(query.bucket, todayKey), columnCount, todayKey)
  if (cellMode && (query.cellColumn as number) >= columns.length) {
    return badRequest('customers.errors.timeline_cell_column_out_of_window', 'cellColumn is outside the window')
  }
  const cellLaneFilter = cellMode ? laneFilterFor(query.groupBy, query.cellLane as string) : null
  if (cellMode && !cellLaneFilter) {
    return badRequest('customers.errors.timeline_invalid_cell_lane', 'Invalid cellLane')
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const queryEngine = container.resolve<QueryEngine>('queryEngine')

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const effectiveTenantId = scope.tenantId ?? auth.tenantId
  if (!effectiveTenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { organizationIds } = resolveOrganizationScopeFilter(scope, auth)
  const orgScopeIds = organizationIds === undefined
    ? null
    : Array.from(new Set(organizationIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (orgScopeIds?.length === 0) {
    if (cellMode) {
      return NextResponse.json({
        lane: query.cellLane, column: query.cellColumn, items: [], total: 0,
        page: query.page, pageSize: query.pageSize, totalPages: 0, countsCapped: false,
      })
    }
    return NextResponse.json(emptyGrid(query, columns))
  }
  const fallbackOrgId = orgScopeIds && orgScopeIds.length > 0 ? orgScopeIds[0] : undefined
  const queryScope: QueryScope = {
    tenantId: effectiveTenantId,
    organizationId: fallbackOrgId,
    organizationIds: orgScopeIds ?? undefined,
  }
  const decryptionScope = { tenantId: effectiveTenantId, organizationId: fallbackOrgId }

  const ctx: CrudCtx = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: fallbackOrgId ?? null,
    organizationIds: orgScopeIds,
    request: req,
  }

  const builderQuery = dealListQuerySchema.parse(pickTimelineFilterQuery(query))
  const builderFilters = await buildDealListFilters(builderQuery, ctx)
  const statusGiven = Array.isArray(query.status) ? query.status.length > 0 : typeof query.status === 'string' && query.status.trim().length > 0
  const excludeClosed = statusGiven ? false : query.excludeClosed ?? true
  const closedStatuses = closedStatusSet()
  const baseFilters = excludeClosed
    ? mergeFieldCondition(builderFilters, 'status', { $nin: closedStatuses })
    : builderFilters

  if (cellMode) {
    const column = columns[query.cellColumn as number]
    let filters = mergeFieldCondition(baseFilters, 'expected_close_at', windowFilter(column.from, column.to))
    for (const [field, condition] of Object.entries(cellLaneFilter as Filters)) {
      filters = mergeFieldCondition(filters, field, condition as Record<string, unknown>)
    }
    const res = await runQuery(queryEngine, queryScope, filters, {
      fields: ['id', 'expected_close_at'],
      sort: DATE_THEN_ID_ASC,
      page: query.page,
      pageSize: query.pageSize,
    })
    const ids = res.rows.map((row) => toStringOrNull(row.id)).filter((id): id is string => id !== null)
    const byId = await loadItems(em, ids, queryScope, decryptionScope)
    return NextResponse.json({
      lane: query.cellLane,
      column: column.index,
      items: ids.map((id) => byId.get(id)).filter((item): item is DealTimelineItem => !!item),
      total: res.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(res.total / query.pageSize),
      countsCapped: res.countCapped,
    })
  }

  const windowFrom = columns[0].from
  const windowTo = columns[columns.length - 1].to
  const overdueBound = overdueBoundFor(windowFrom, todayKey)
  const openFilters = mergeFieldCondition(baseFilters, 'status', { $nin: closedStatuses })

  const columnPasses = await runInBatches(columns, QUERY_CONCURRENCY, (column) =>
    runLightPass(queryEngine, queryScope, baseFilters, column, query.groupBy),
  )
  const sideQueries: Array<() => ReturnType<typeof runQuery>> = [
    () =>
      runQuery(queryEngine, queryScope, mergeFieldCondition(openFilters, 'expected_close_at', { $lt: dateKeyToUtcDate(overdueBound) }), {
        fields: ['id', 'expected_close_at'],
        sort: [{ field: 'expected_close_at', dir: SortDir.Desc }, { field: 'id', dir: SortDir.Asc }],
        page: 1,
        pageSize: 1,
      }),
    () =>
      runQuery(queryEngine, queryScope, mergeFieldCondition(baseFilters, 'expected_close_at', { $eq: null }), {
        fields: ['id'],
        page: 1,
        pageSize: 1,
      }),
    () =>
      runQuery(queryEngine, queryScope, mergeFieldCondition(baseFilters, 'expected_close_at', { $lt: dateKeyToUtcDate(windowFrom) }), {
        fields: ['id', 'expected_close_at'],
        sort: [{ field: 'expected_close_at', dir: SortDir.Desc }, { field: 'id', dir: SortDir.Asc }],
        page: 1,
        pageSize: 1,
      }),
    () =>
      runQuery(queryEngine, queryScope, mergeFieldCondition(baseFilters, 'expected_close_at', { $gte: dateKeyToUtcDate(windowTo) }), {
        fields: ['id', 'expected_close_at'],
        sort: DATE_THEN_ID_ASC,
        page: 1,
        pageSize: 1,
      }),
    () => runQuery(queryEngine, queryScope, {}, { fields: ['id'], page: 1, pageSize: 1 }),
  ]
  const [overdueRes, undatedRes, previousRes, nextRes, scopeRes] = await runInBatches(
    sideQueries,
    QUERY_CONCURRENCY,
    (runSideQuery) => runSideQuery(),
  )
  const countsCapped =
    columnPasses.some((pass) => pass.countCapped) || overdueRes.countCapped || undatedRes.countCapped

  const cellIds = new Map<string, Map<number, string[]>>()
  const laneStageInfo = new Map<string, { pipelineId: string | null; label: string }>()
  for (const pass of columnPasses) {
    for (const row of pass.rows) {
      const laneCells = cellIds.get(row.laneKey) ?? new Map<number, string[]>()
      const ids = laneCells.get(pass.column.index) ?? []
      ids.push(row.id)
      laneCells.set(pass.column.index, ids)
      cellIds.set(row.laneKey, laneCells)
      if (query.groupBy === 'stage' && !laneStageInfo.has(row.laneKey)) {
        laneStageInfo.set(row.laneKey, { pipelineId: row.pipelineId, label: row.pipelineStage ?? '' })
      }
    }
  }

  type LaneDefinition = { key: string; owner: { id: string } | null; stage: DealTimelineStageMeta | null }
  const laneDefinitions: LaneDefinition[] = []
  if (query.groupBy === 'owner') {
    const keys = new Set<string>(cellIds.keys())
    normalizeIdList(query.ownerUserId === undefined ? undefined : ([] as string[]).concat(query.ownerUserId))
      .forEach((ownerId) => keys.add(ownerId))
    const ordered = Array.from(keys)
      .filter((key) => key !== DEAL_TIMELINE_UNASSIGNED_LANE)
      .sort((left, right) => left.localeCompare(right))
    if (keys.has(DEAL_TIMELINE_UNASSIGNED_LANE)) ordered.push(DEAL_TIMELINE_UNASSIGNED_LANE)
    for (const key of ordered) {
      laneDefinitions.push({ key, owner: key === DEAL_TIMELINE_UNASSIGNED_LANE ? null : { id: key }, stage: null })
    }
  } else {
    const canViewPipelines = await userHasPipelinesView(container, auth.sub, {
      tenantId: effectiveTenantId,
      organizationId: fallbackOrgId ?? auth.orgId ?? null,
    })
    const seen = new Set<string>()
    if (canViewPipelines) {
      const selectedPipelineIds = normalizeIdList(query.pipelineId === undefined ? undefined : ([] as string[]).concat(query.pipelineId))
      const definitions = await loadStageLaneDefinitions(em, queryScope, selectedPipelineIds, decryptionScope)
      const pipelineNames = new Map<string, string | null>()
      definitions.forEach((definition) => pipelineNames.set(definition.stage.pipelineId ?? '', definition.stage.pipelineName ?? null))
      const pipelineOrder = Array.from(pipelineNames.keys())
      for (const pipelineId of pipelineOrder) {
        for (const definition of definitions.filter((entry) => (entry.stage.pipelineId ?? '') === pipelineId)) {
          laneDefinitions.push({ key: definition.key, owner: null, stage: definition.stage })
          seen.add(definition.key)
        }
        const noStageKey = noStageLaneKey(pipelineId || null)
        if (cellIds.has(noStageKey)) {
          laneDefinitions.push({
            key: noStageKey,
            owner: null,
            stage: { label: '', pipelineId: pipelineId || null, order: null, tone: null, pipelineName: pipelineNames.get(pipelineId) ?? null },
          })
          seen.add(noStageKey)
        }
      }
    }
    const remaining = Array.from(cellIds.keys())
      .filter((key) => !seen.has(key))
      .map((key) => {
        const info = laneStageInfo.get(key) ?? { pipelineId: null, label: '' }
        const isNoStage = parseNoStageLaneKey(key) !== null
        return { key, pipelineId: info.pipelineId, label: isNoStage ? '' : info.label, isNoStage }
      })
      .sort((left, right) => {
        const byPipeline = (left.pipelineId ?? '').localeCompare(right.pipelineId ?? '')
        if (byPipeline !== 0) return byPipeline
        if (left.isNoStage !== right.isNoStage) return left.isNoStage ? 1 : -1
        const byLabel = left.label.localeCompare(right.label)
        return byLabel !== 0 ? byLabel : left.key.localeCompare(right.key)
      })
    for (const entry of remaining) {
      laneDefinitions.push({ key: entry.key, owner: null, stage: { label: entry.label, pipelineId: entry.pipelineId } })
    }
  }

  const truncatedColumns = new Set(columnPasses.filter((pass) => pass.truncated).map((pass) => pass.column.index))
  const anyTruncated = truncatedColumns.size > 0
  const selectedIds: string[] = []
  const selectedByCell = new Map<string, string[]>()
  let cardsTruncated = false
  for (let depth = 0; depth < query.perCell; depth += 1) {
    for (const lane of laneDefinitions) {
      const laneCells = cellIds.get(lane.key)
      for (const column of columns) {
        const id = laneCells?.get(column.index)?.[depth]
        if (!id) continue
        if (selectedIds.length >= TIMELINE_RESPONSE_CARD_CAP) {
          cardsTruncated = true
          continue
        }
        const cellKey = `${lane.key}|${column.index}`
        selectedByCell.set(cellKey, [...(selectedByCell.get(cellKey) ?? []), id])
        selectedIds.push(id)
      }
    }
  }
  const itemsById = await loadItems(em, selectedIds, queryScope, decryptionScope)

  const lanes: DealTimelineLane[] = laneDefinitions.map((lane) => {
    const laneCells = cellIds.get(lane.key)
    const cells: DealTimelineCell[] = columns.map((column) => {
      const ids = laneCells?.get(column.index) ?? []
      const items = (selectedByCell.get(`${lane.key}|${column.index}`) ?? [])
        .map((id) => itemsById.get(id))
        .filter((item): item is DealTimelineItem => !!item)
      return { column: column.index, total: ids.length, partial: truncatedColumns.has(column.index), items }
    })
    return {
      key: lane.key,
      kind: query.groupBy,
      owner: lane.owner,
      stage: lane.stage,
      total: cells.reduce((sum, cell) => sum + cell.total, 0),
      partial: anyTruncated,
      cells,
    }
  })

  return NextResponse.json({
    bucket: query.bucket,
    groupBy: query.groupBy,
    weekStartsOn: DEAL_TIMELINE_WEEK_STARTS_ON,
    from: windowFrom,
    to: windowTo,
    columns: columnPasses.map((pass) => ({
      ...pass.column,
      total: pass.total,
      truncated: pass.truncated,
      countCapped: pass.countCapped,
    })),
    lanes,
    overdueBefore: {
      count: overdueRes.total,
      before: overdueBound,
      latestExpectedCloseAt: toUtcDateKey(toIsoStringOrNull(overdueRes.rows[0]?.expected_close_at) ?? null),
      countCapped: overdueRes.countCapped,
    },
    undatedCount: undatedRes.total,
    undatedCountCapped: undatedRes.countCapped,
    adjacent: {
      previous: toUtcDateKey(toIsoStringOrNull(previousRes.rows[0]?.expected_close_at) ?? null),
      next: toUtcDateKey(toIsoStringOrNull(nextRes.rows[0]?.expected_close_at) ?? null),
    },
    scopeHasDeals: scopeRes.total > 0,
    truncated: anyTruncated,
    cardsTruncated,
    countsCapped,
  })
}
