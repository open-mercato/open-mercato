import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { CustomerKysely } from '../lib/kysely'
import { resolveKyselyClient } from '../lib/kysely'
import { fetchStuckThresholdDays } from '../lib/stuckDeals'

type DealRecord = Record<string, unknown> & {
  id: string
  status?: string | null
  expected_close_at?: string | null
  created_at?: string | null
}

type PipelineState = {
  openActivitiesCount: number
  daysInCurrentStage: number
  isStuck: boolean
  isOverdue: boolean
}

const ENRICHER_TIMEOUT_MS = 2000
const DAY_MS = 24 * 60 * 60 * 1000
// Mirror the canonical statuses defined in validators.ts (`interactionStatusValues`). The
// canonical spelling is `canceled` (US, single L), not `cancelled` (UK). Misspelling this
// here let canceled interactions slip into the open-activities count badge on the card.
// We accept `completed` defensively too, even though `done` is the canonical "completed"
// value in the validator, in case any legacy rows exist with the longer spelling.
const TERMINAL_INTERACTION_STATUSES = ['done', 'canceled', 'completed'] as const

function parseDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function diffDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

async function fetchOpenInteractionCounts(
  db: CustomerKysely,
  dealIds: Set<string>,
  organizationId: string,
  tenantId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (dealIds.size === 0) return map
  const rows = await db
    .selectFrom('customer_interactions')
    .select(['deal_id'])
    .select((eb) => eb.fn.countAll().as('count'))
    .where('deal_id', 'in', [...dealIds])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where('status', 'not in', [...TERMINAL_INTERACTION_STATUSES])
    .groupBy('deal_id')
    .execute()
  for (const row of rows) {
    if (row.deal_id == null) continue
    const count = typeof row.count === 'number' ? row.count : Number(row.count)
    if (Number.isFinite(count)) map.set(row.deal_id, count)
  }
  return map
}

async function fetchLatestStageTransitions(
  db: CustomerKysely,
  dealIds: Set<string>,
  organizationId: string,
  tenantId: string,
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>()
  if (dealIds.size === 0) return map
  const rows = await db
    .selectFrom('customer_deal_stage_transitions')
    .select(['deal_id'])
    .select((eb) => eb.fn.max('transitioned_at').as('last_transitioned_at'))
    .where('deal_id', 'in', [...dealIds])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .groupBy('deal_id')
    .execute()
  for (const row of rows) {
    const parsed = parseDate(row.last_transitioned_at)
    if (parsed) map.set(row.deal_id, parsed)
  }
  return map
}

export function buildPipelineState(
  record: DealRecord,
  openInteractionCounts: Map<string, number>,
  latestTransitions: Map<string, Date>,
  threshold: number,
  now: Date,
  today: Date,
): PipelineState {
  const openActivitiesCount = openInteractionCounts.get(record.id) ?? 0
  const transitionAt =
    latestTransitions.get(record.id) ?? parseDate(record.created_at) ?? now
  const daysInCurrentStage = Math.max(0, diffDays(transitionAt, now))
  const expectedClose = parseDate(record.expected_close_at)
  const status = typeof record.status === 'string' ? record.status : null
  const isOverdue = status === 'open' && !!expectedClose && expectedClose < today
  const isStuck = daysInCurrentStage > threshold
  return { openActivitiesCount, daysInCurrentStage, isStuck, isOverdue }
}

const dealPipelineEnricher: ResponseEnricher<DealRecord> = {
  id: 'customers.deal-pipeline-state',
  targetEntity: 'customers.deal',
  // No `features` gate: the deals list route already enforces `customers.deals.view`
  // at the route-metadata level (see api/deals/route.ts). Declaring `features` here
  // would silently disable the enricher in environments where `rbacService` resolves
  // to undefined or `getGrantedFeatures` throws — `hasRequiredFeatures` treats a
  // missing `userFeatures` as "no access", which made `_pipeline` disappear from
  // CI responses (TC-CRM-066) while keeping the local kanban working.
  priority: 10,
  timeout: ENRICHER_TIMEOUT_MS,
  critical: false,
  fallback: {
    _pipeline: {
      openActivitiesCount: 0,
      daysInCurrentStage: 0,
      isStuck: false,
      isOverdue: false,
    },
  },

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context: EnricherContext) {
    if (records.length === 0) return records

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // `buildPipelineState` is pure on top of (record + maps + threshold). The record alone
    // is enough to compute `isOverdue` (status + expected_close_at) and a conservative
    // `daysInCurrentStage` (created_at fallback). When Kysely isn't available on this
    // EntityManager — test stubs, unusual driver wrappers, or a transient DB issue —
    // we still ship the correct overdue flag and a zeroed activities count rather than
    // silently dropping `_pipeline`, which previously made the kanban think every deal
    // had no stuck/overdue state.
    const emptyCounts: Map<string, number> = new Map()
    const emptyTransitions: Map<string, Date> = new Map()
    const FALLBACK_THRESHOLD = 14

    const db = resolveKyselyClient(context.em)
    if (!db) {
      return records.map((record) => ({
        ...record,
        _pipeline: buildPipelineState(
          record,
          emptyCounts,
          emptyTransitions,
          FALLBACK_THRESHOLD,
          now,
          today,
        ),
      }))
    }

    const dealIds = new Set<string>()
    for (const record of records) {
      if (typeof record.id === 'string') dealIds.add(record.id)
    }
    if (dealIds.size === 0) {
      return records.map((record) => ({
        ...record,
        _pipeline: buildPipelineState(
          record,
          emptyCounts,
          emptyTransitions,
          FALLBACK_THRESHOLD,
          now,
          today,
        ),
      }))
    }

    const [openInteractionCounts, latestTransitions, threshold] = await Promise.all([
      fetchOpenInteractionCounts(db, dealIds, context.organizationId, context.tenantId),
      fetchLatestStageTransitions(db, dealIds, context.organizationId, context.tenantId),
      fetchStuckThresholdDays(db, context.organizationId, context.tenantId),
    ])

    return records.map((record) => ({
      ...record,
      _pipeline: buildPipelineState(
        record,
        openInteractionCounts,
        latestTransitions,
        threshold,
        now,
        today,
      ),
    }))
  },
}

export const enrichers: ResponseEnricher[] = [dealPipelineEnricher]
