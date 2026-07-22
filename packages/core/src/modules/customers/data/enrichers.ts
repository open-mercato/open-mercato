import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { CustomerKysely } from '../lib/kysely'
import { resolveKyselyClient } from '../lib/kysely'
import { fetchStuckThresholdDays } from '../lib/stuckDeals'
import { TERMINAL_INTERACTION_STATUS_LIST } from '../lib/interactionStatus'

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

/** Coerce an unknown value to a non-empty string array, or null when absent/empty. */
function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length > 0 ? strings : null
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
    .where('status', 'not in', [...TERMINAL_INTERACTION_STATUS_LIST])
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

type PersonRecord = Record<string, unknown> & { id: string }

/**
 * Adds `_privateEmailCount` to each Person — the number of that person's PRIVATE
 * email interactions authored by OTHER users (private emails the current viewer
 * cannot see). Backs the documented "count of teammates' private emails" badge
 * (see `apps/docs/docs/user-guide/customers-email.mdx`): a viewer learns an
 * exchange exists without seeing its content. The count-badge UI is a pending
 * follow-up; the field is populated here so the consumer can be wired without a
 * second pass. Owner/tenant scoped and fail-safe to 0 — never leaks content.
 */
export const privateEmailCountEnricher: ResponseEnricher<
  PersonRecord,
  { _privateEmailCount?: number }
> = {
  id: 'customers.private-email-count',
  targetEntity: 'customers.person',
  features: ['customers.people.view'],
  priority: 30,
  timeout: 1500,
  fallback: { _privateEmailCount: 0 },
  critical: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context: EnricherContext) {
    if (records.length === 0) return records

    const db = resolveKyselyClient(context.em)
    if (!db) {
      return records.map((record) => ({ ...record, _privateEmailCount: 0 }))
    }

    const userId = context.userId
    // Fail-safe to 0 when there is no real authoring user to exclude. An API-key
    // principal (`auth.sub = "api_key:<id>"`) is not a person, so the
    // `author_user_id != userId` exclusion below would match nothing and count
    // every private email — short-circuit it here.
    if (!userId || userId.startsWith('api_key:')) {
      return records.map((record) => ({ ...record, _privateEmailCount: 0 }))
    }

    const personIds = records
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (personIds.length === 0) {
      return records.map((record) => ({ ...record, _privateEmailCount: 0 }))
    }

    const rows = await (db as CustomerKysely)
      .selectFrom('customer_interactions')
      .select(['entity_id'])
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('interaction_type', '=', 'email')
      .where('visibility', '=', 'private')
      .where('deleted_at', 'is', null)
      .where('entity_id', 'in', personIds)
      .where('author_user_id', '!=', userId)
      .groupBy('entity_id')
      .execute()

    const countMap = new Map<string, number>()
    for (const row of rows) {
      const personId = typeof row.entity_id === 'string' ? row.entity_id : null
      if (!personId) continue
      const count = typeof row.count === 'number' ? row.count : Number(row.count)
      if (Number.isFinite(count)) countMap.set(personId, count)
    }

    return records.map((record) => ({
      ...record,
      _privateEmailCount: countMap.get(record.id) ?? 0,
    }))
  },
}

type InteractionRecord = Record<string, unknown> & {
  id: string
  interactionType?: string | null
  externalMessageId?: string | null
}

type EmailIntegrationFields = {
  externalMessageId?: string | null
  rfcMessageId?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  subject?: string | null
  inReplyTo?: string | null
  references?: string[] | null
  /** Current visibility of the interaction row, for the private/shared toggle. */
  currentVisibility?: 'private' | 'shared' | null
  /** True when the interaction's author is the requesting user — gates the toggle. */
  isAuthor?: boolean
}

/**
 * Enriches email-type customer interactions with MessageChannelLink metadata
 * so the ActivityCard widget can render Reply/Forward/visibility-toggle actions.
 *
 * For each interaction row where `interactionType === 'email'` and
 * `externalMessageId` is set (the MessageChannelLink UUID), the enricher fetches
 * the corresponding `MessageChannelLink` row and populates
 * `_integrations.email.*` from its `channel_metadata` column.
 *
 * Non-email rows and rows without an externalMessageId pass through unchanged.
 * Fail-safe: if the Kysely client is unavailable or the lookup fails, the records
 * are returned unmodified so the activity timeline still renders (without email
 * card actions).
 */
export const interactionEmailCardEnricher: ResponseEnricher<
  InteractionRecord,
  { _integrations?: { email?: EmailIntegrationFields } }
> = {
  id: 'customers.interaction-email-card',
  // Must match the entity ID passed to applyResponseEnrichers in the interactions
  // GET route (api/interactions/route.ts line 539): 'customers.interaction'.
  targetEntity: 'customers.interaction',
  features: ['customers.interactions.view'],
  priority: 25,
  timeout: 1500,
  fallback: {},
  critical: false,

  async enrichOne(record, ctx) {
    const results = await this.enrichMany!([record], ctx)
    return results[0]
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records

    // Fast path: skip the DB round-trip when no email rows with a link are present.
    const emailRecords = records.filter(
      (r) =>
        r.interactionType === 'email' &&
        typeof r.externalMessageId === 'string' &&
        r.externalMessageId.length > 0,
    )
    if (emailRecords.length === 0) return records

    const linkIds = Array.from(
      new Set(emailRecords.map((r) => r.externalMessageId as string)),
    )

    // message_channel_links is owned by communication_channels; its read-only
    // shape is declared in CustomerKyselyDb so this stays type-safe without
    // cross-module coupling. Mirrors privateEmailCountEnricher.
    const kysely = resolveKyselyClient(ctx.em)
    if (!kysely) {
      // Fail-safe: Kysely unavailable (test stubs, unusual driver wrappers).
      return records
    }

    let linkRows: Array<{ id: string; channel_metadata: unknown }>
    try {
      linkRows = await kysely
        .selectFrom('message_channel_links')
        .select(['id', 'channel_metadata'])
        .where('tenant_id', '=', ctx.tenantId)
        // Defense-in-depth org scope. `id IN linkIds` already binds the lookup
        // to this org's interactions, and `message_channel_links.organization_id`
        // is nullable, so we tolerate NULL to avoid dropping legitimate links.
        .where((eb) =>
          eb.or([
            eb('organization_id', '=', ctx.organizationId),
            eb('organization_id', 'is', null),
          ]),
        )
        .where('id', 'in', linkIds)
        .execute()
    } catch {
      // Fail-safe: unexpected DB error (missing table in test env, schema drift).
      return records
    }

    const byLinkId = new Map<string, EmailIntegrationFields>()
    for (const row of linkRows) {
      const meta = (row.channel_metadata ?? {}) as Record<string, unknown>
      const fields: EmailIntegrationFields = {
        externalMessageId: row.id,
        rfcMessageId: typeof meta.messageId === 'string' ? meta.messageId : null,
        fromAddress: typeof meta.from === 'string' ? meta.from : null,
        toAddresses: stringArrayOrNull(meta.to),
        ccAddresses: stringArrayOrNull(meta.cc),
        // bcc is intentionally NOT surfaced: BCC recipients are blind by design,
        // so exposing them to every teammate who can view a shared email would
        // leak the blind-copy list. Keep it out of the enriched response.
        subject: typeof meta.subject === 'string' ? meta.subject : null,
        inReplyTo: typeof meta.inReplyTo === 'string' ? meta.inReplyTo : null,
        references: stringArrayOrNull(meta.references),
      }
      byLinkId.set(row.id, fields)
    }

    const currentUserId = ctx.userId

    return records.map((r) => {
      if (
        r.interactionType !== 'email' ||
        typeof r.externalMessageId !== 'string' ||
        r.externalMessageId.length === 0
      ) {
        return r
      }
      const fields = byLinkId.get(r.externalMessageId)
      if (!fields) return r
      const visibility =
        r.visibility === 'private' || r.visibility === 'shared' ? r.visibility : null
      const authorUserId = typeof r.authorUserId === 'string' ? r.authorUserId : null
      const isAuthor = Boolean(currentUserId && authorUserId && authorUserId === currentUserId)
      // Fail-closed (defense-in-depth): never surface another user's PRIVATE
      // email metadata (subject/from/to/references), even if a consumer forgot
      // to apply the visibility filter upstream. v1 is strict owner-only (no
      // admin bypass — `customers.email.view_private` is inert until v2), so a
      // private row is enriched only for its author. The normal read paths
      // already drop these rows; this keeps the globally-registered enricher
      // safe-by-construction for any future consumer that opts into it.
      if (visibility === 'private' && !isAuthor) {
        return r
      }
      const existingIntegrations = (r._integrations ?? {}) as Record<string, unknown>
      return {
        ...r,
        _integrations: {
          ...existingIntegrations,
          email: {
            ...fields,
            currentVisibility: visibility,
            isAuthor,
          },
        },
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [dealPipelineEnricher, privateEmailCountEnricher, interactionEmailCardEnricher]
