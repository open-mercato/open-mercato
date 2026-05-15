import type { Kysely } from 'kysely'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'

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

const DEFAULT_STUCK_THRESHOLD_DAYS = 14
const ENRICHER_TIMEOUT_MS = 2000
const DAY_MS = 24 * 60 * 60 * 1000
// Mirror the canonical statuses defined in validators.ts (`interactionStatusValues`). The
// canonical spelling is `canceled` (US, single L), not `cancelled` (UK). Misspelling this
// here let canceled interactions slip into the open-activities count badge on the card.
// We accept `completed` defensively too, even though `done` is the canonical "completed"
// value in the validator, in case any legacy rows exist with the longer spelling.
const TERMINAL_INTERACTION_STATUSES = ['done', 'canceled', 'completed'] as const

function getDb(em: unknown): Kysely<any> | null {
  const getter = (em as any)?.getKysely
  return typeof getter === 'function' ? getter.call(em) : null
}

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
  db: Kysely<any>,
  dealIds: Set<string>,
  organizationId: string,
  tenantId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (dealIds.size === 0) return map
  const rows = (await (db as any)
    .selectFrom('customer_interactions')
    .select(['deal_id'])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('deal_id', 'in', [...dealIds])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where('status', 'not in', TERMINAL_INTERACTION_STATUSES)
    .groupBy('deal_id')
    .execute()) as Array<{ deal_id: string; count: string | number }>
  for (const row of rows) {
    const count = typeof row.count === 'number' ? row.count : Number(row.count)
    if (Number.isFinite(count)) map.set(row.deal_id, count)
  }
  return map
}

async function fetchLatestStageTransitions(
  db: Kysely<any>,
  dealIds: Set<string>,
  organizationId: string,
  tenantId: string,
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>()
  if (dealIds.size === 0) return map
  const rows = (await (db as any)
    .selectFrom('customer_deal_stage_transitions')
    .select(['deal_id'])
    .select((eb: any) => eb.fn.max('transitioned_at').as('last_transitioned_at'))
    .where('deal_id', 'in', [...dealIds])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .groupBy('deal_id')
    .execute()) as Array<{ deal_id: string; last_transitioned_at: string | Date | null }>
  for (const row of rows) {
    const parsed = parseDate(row.last_transitioned_at)
    if (parsed) map.set(row.deal_id, parsed)
  }
  return map
}

async function fetchStuckThreshold(
  db: Kysely<any>,
  organizationId: string,
  tenantId: string,
): Promise<number> {
  const row = (await (db as any)
    .selectFrom('customer_settings')
    .select(['stuck_threshold_days'])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst()) as { stuck_threshold_days: number | string | null } | undefined
  const raw = row?.stuck_threshold_days
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null
  if (value !== null && Number.isFinite(value) && value > 0) return value
  return DEFAULT_STUCK_THRESHOLD_DAYS
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
  features: [],
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
    const db = getDb(context.em)
    if (!db) return records

    const dealIds = new Set<string>()
    for (const record of records) {
      if (typeof record.id === 'string') dealIds.add(record.id)
    }
    if (dealIds.size === 0) return records

    const [openInteractionCounts, latestTransitions, threshold] = await Promise.all([
      fetchOpenInteractionCounts(db, dealIds, context.organizationId, context.tenantId),
      fetchLatestStageTransitions(db, dealIds, context.organizationId, context.tenantId),
      fetchStuckThreshold(db, context.organizationId, context.tenantId),
    ])

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

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
