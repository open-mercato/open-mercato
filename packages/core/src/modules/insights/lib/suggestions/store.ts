import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import type { ProjectionScope, XrayDatabase } from '../projection/types'
import type { XraySuggestionNotDraftableReason, XraySuggestionStatus } from './constants'
import type { MinedSuggestion } from './mine'

export type SuggestionDb = Kysely<XrayDatabase> | Transaction<XrayDatabase>

const ISO_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'

/**
 * The next version of a row: the database clock truncated to milliseconds (the optimistic lock
 * compares millisecond timestamps, see `updated_at` CAS in the update command), and always later
 * than the current version.
 */
const NEXT_VERSION = sql`greatest(date_trunc('milliseconds', clock_timestamp()), insights_automation_suggestions.updated_at + interval '1 millisecond')`

const NOW_MS = sql`date_trunc('milliseconds', clock_timestamp())`

/** A mined suggestion with its draftability, ready to be stored. */
export type SuggestionUpsert = MinedSuggestion & {
  triggerEventId: string | null
  draftable: boolean
  notDraftableReason: XraySuggestionNotDraftableReason | null
  commandId: string | null
}

export type StoredSuggestion = {
  id: string
  tenantId: string
  organizationId: string
  processKey: string
  signatureHash: string
  triggerActivityKey: string
  trigger: Record<string, unknown>
  condition: Record<string, unknown> | null
  followups: Array<Record<string, unknown>>
  windowSeconds: number
  support: number
  triggerCount: number
  confidence: number
  lift: number
  distinctActorCount: number
  status: XraySuggestionStatus
  draftable: boolean
  notDraftableReason: string | null
  draftedArtifactId: string | null
  computedAt: string
  createdAt: string
  updatedAt: string
}

type SuggestionRow = {
  id: string
  tenant_id: string
  organization_id: string
  process_key: string
  signature_hash: string
  trigger_activity_key: string
  trigger_json: Record<string, unknown>
  condition_json: Record<string, unknown> | null
  followups_json: Array<Record<string, unknown>>
  window_seconds: number | string
  support: number | string
  trigger_count: number | string
  confidence: number | string
  lift: number | string
  distinct_actor_count: number | string
  status: string
  draftable: boolean
  not_draftable_reason: string | null
  drafted_artifact_id: string | null
  computed_at: string
  created_at: string
  updated_at: string
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readStatus(value: string): XraySuggestionStatus {
  return value === 'dismissed' || value === 'drafted' || value === 'superseded' ? value : 'open'
}

function mapRow(row: SuggestionRow): StoredSuggestion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    processKey: row.process_key,
    signatureHash: row.signature_hash,
    triggerActivityKey: row.trigger_activity_key,
    trigger: row.trigger_json,
    condition: row.condition_json,
    followups: Array.isArray(row.followups_json) ? row.followups_json : [],
    windowSeconds: toNumber(row.window_seconds),
    support: toNumber(row.support),
    triggerCount: toNumber(row.trigger_count),
    confidence: toNumber(row.confidence),
    lift: toNumber(row.lift),
    distinctActorCount: toNumber(row.distinct_actor_count),
    status: readStatus(row.status),
    draftable: row.draftable === true,
    notDraftableReason: row.not_draftable_reason,
    draftedArtifactId: row.drafted_artifact_id,
    computedAt: row.computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_COLUMNS = sql`
  suggestions.id::text as id, suggestions.tenant_id::text as tenant_id, suggestions.organization_id::text as organization_id,
  suggestions.process_key, suggestions.signature_hash, suggestions.trigger_activity_key, suggestions.trigger_json,
  suggestions.condition_json, suggestions.followups_json, suggestions.window_seconds, suggestions.support,
  suggestions.trigger_count, suggestions.confidence, suggestions.lift, suggestions.distinct_actor_count, suggestions.status,
  suggestions.draftable, suggestions.not_draftable_reason, suggestions.drafted_artifact_id::text as drafted_artifact_id,
  to_char(suggestions.computed_at at time zone 'UTC', ${ISO_FORMAT}) as computed_at,
  to_char(suggestions.created_at at time zone 'UTC', ${ISO_FORMAT}) as created_at,
  to_char(suggestions.updated_at at time zone 'UTC', ${ISO_FORMAT}) as updated_at
`

function triggerJson(suggestion: SuggestionUpsert): Record<string, unknown> {
  return {
    activityKey: suggestion.trigger.activityKey,
    activityKind: suggestion.trigger.activityKind,
    field: suggestion.trigger.field,
    value: suggestion.trigger.value,
    eventId: suggestion.triggerEventId,
  }
}

function followupsJson(suggestion: SuggestionUpsert): Array<Record<string, unknown>> {
  return suggestion.followups.map((followup) => ({
    field: followup.field,
    value: followup.value,
    activityKind: followup.activityKind,
    commandId: suggestion.commandId,
  }))
}

/**
 * Upserts the suggestions of one pass by `(tenant, organization, signature)`. A new rule is
 * stored `open`. A known rule gets the new statistics and draftability; its status is kept,
 * except that a `superseded` rule found again reopens as `open` (dismissed and drafted rules keep
 * their status, so a dismissal is never undone by mining). The version (`updated_at`) moves only
 * when a stored, user-visible value changes, so repeating a pass over the same data is a no-op
 * apart from `computed_at`. Returns the number of rows written.
 */
export async function upsertSuggestions(db: SuggestionDb, scope: ProjectionScope, suggestions: readonly SuggestionUpsert[]): Promise<number> {
  let written = 0
  for (const suggestion of suggestions) {
    const result = await sql<{ id: string }>`
      insert into insights_automation_suggestions (
        tenant_id, organization_id, process_key, signature_hash, trigger_activity_key, trigger_json, condition_json,
        followups_json, window_seconds, support, trigger_count, confidence, lift, distinct_actor_count, status,
        draftable, not_draftable_reason, drafted_artifact_id, computed_at, created_at, updated_at, deleted_at
      ) values (
        ${scope.tenantId}, ${scope.organizationId}, ${suggestion.processKey}, ${suggestion.signatureHash},
        ${suggestion.trigger.activityKey}, ${JSON.stringify(triggerJson(suggestion))}::jsonb,
        ${suggestion.condition ? JSON.stringify(suggestion.condition) : null}::jsonb,
        ${JSON.stringify(followupsJson(suggestion))}::jsonb, ${suggestion.windowSeconds}, ${suggestion.support},
        ${suggestion.triggerCount}, ${suggestion.confidence}, ${suggestion.lift}, ${suggestion.distinctActorCount}, 'open',
        ${suggestion.draftable}, ${suggestion.notDraftableReason}, null, ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, null
      )
      on conflict (tenant_id, organization_id, signature_hash) do update set
        trigger_json = excluded.trigger_json,
        condition_json = excluded.condition_json,
        followups_json = excluded.followups_json,
        window_seconds = excluded.window_seconds,
        support = excluded.support,
        trigger_count = excluded.trigger_count,
        confidence = excluded.confidence,
        lift = excluded.lift,
        distinct_actor_count = excluded.distinct_actor_count,
        draftable = excluded.draftable,
        not_draftable_reason = excluded.not_draftable_reason,
        status = case when insights_automation_suggestions.status = 'superseded' then 'open' else insights_automation_suggestions.status end,
        computed_at = excluded.computed_at,
        updated_at = case
          when insights_automation_suggestions.status = 'superseded'
            or (
              insights_automation_suggestions.trigger_json, insights_automation_suggestions.condition_json,
              insights_automation_suggestions.followups_json, insights_automation_suggestions.window_seconds,
              insights_automation_suggestions.support, insights_automation_suggestions.trigger_count,
              insights_automation_suggestions.confidence, insights_automation_suggestions.lift,
              insights_automation_suggestions.distinct_actor_count, insights_automation_suggestions.draftable,
              insights_automation_suggestions.not_draftable_reason
            ) is distinct from (
              excluded.trigger_json, excluded.condition_json, excluded.followups_json, excluded.window_seconds,
              excluded.support, excluded.trigger_count, excluded.confidence, excluded.lift,
              excluded.distinct_actor_count, excluded.draftable, excluded.not_draftable_reason
            )
          then ${NEXT_VERSION}
          else insights_automation_suggestions.updated_at
        end
      returning id
    `.execute(db)
    written += result.rows.length
  }
  return written
}

function processKeyPredicate(processKeys: readonly string[] | null): RawBuilder<unknown> {
  return processKeys === null ? sql`` : sql`and insights_automation_suggestions.process_key = any(${[...processKeys]}::text[])`
}

/**
 * Marks the organization's `open` suggestions of the given processes (all when `null`) that this
 * pass no longer found as `superseded`. Dismissed and drafted rows are never touched; a concurrent
 * user change wins (the row is re-checked under its lock). Returns the rows changed.
 */
export async function supersedeMissingSuggestions(
  db: SuggestionDb,
  scope: ProjectionScope,
  processKeys: readonly string[],
  foundSignatures: readonly string[],
): Promise<number> {
  if (processKeys.length === 0) return 0
  const result = await sql<{ id: string }>`
    update insights_automation_suggestions
    set status = 'superseded', updated_at = ${NEXT_VERSION}
    where insights_automation_suggestions.tenant_id = ${scope.tenantId}
      and insights_automation_suggestions.organization_id = ${scope.organizationId}
      ${processKeyPredicate(processKeys)}
      and insights_automation_suggestions.status = 'open'
      and insights_automation_suggestions.deleted_at is null
      and not (insights_automation_suggestions.signature_hash = any(${[...foundSignatures]}::text[]))
    returning id
  `.execute(db)
  return result.rows.length
}

/**
 * Marks every `open` suggestion of the organization's given processes (all when `null`) as
 * `superseded`: their projected rows were cleared (contract change or rebuild), so the evidence
 * is gone until the next mining pass over the rebuilt projection. Dismissed and drafted rows keep
 * their status. Returns the rows changed.
 */
export async function supersedeProcessSuggestions(db: SuggestionDb, scope: ProjectionScope, processKeys: readonly string[] | null): Promise<number> {
  if (processKeys !== null && processKeys.length === 0) return 0
  const result = await sql<{ id: string }>`
    update insights_automation_suggestions
    set status = 'superseded', updated_at = ${NEXT_VERSION}
    where insights_automation_suggestions.tenant_id = ${scope.tenantId}
      and insights_automation_suggestions.organization_id = ${scope.organizationId}
      ${processKeyPredicate(processKeys)}
      and insights_automation_suggestions.status = 'open'
      and insights_automation_suggestions.deleted_at is null
    returning id
  `.execute(db)
  return result.rows.length
}

/** One visible slice of the tenant: a process and the organizations (`null` = every organization of the tenant) the caller may see it in. */
export type SuggestionVisibility = {
  processKey: string
  organizationIds: readonly string[] | null
}

export type SuggestionListQuery = {
  tenantId: string
  visibility: readonly SuggestionVisibility[]
  status?: XraySuggestionStatus
  page: number
  pageSize: number
}

function visibilityPredicate(visibility: readonly SuggestionVisibility[]): RawBuilder<unknown> {
  const clauses = visibility.map((entry) => (entry.organizationIds === null
    ? sql`(suggestions.process_key = ${entry.processKey})`
    : sql`(suggestions.process_key = ${entry.processKey} and suggestions.organization_id = any(${[...entry.organizationIds]}::uuid[]))`))
  return sql`(${sql.join(clauses, sql` or `)})`
}

const ENABLED_ORGANIZATION = sql`not exists (
  select 1 from insights_process_settings disabled_settings
  where disabled_settings.tenant_id = suggestions.tenant_id
    and disabled_settings.organization_id = suggestions.organization_id
    and disabled_settings.enabled = false
    and disabled_settings.deleted_at is null
)`

/**
 * A page of the tenant's suggestions the caller may see (its visible processes, each limited to
 * the organizations where the caller holds the process's features), optionally of one status;
 * organizations whose settings disable X-Ray are never listed. Best first (confidence, support,
 * id), offset-paginated.
 */
export async function listSuggestions(db: SuggestionDb, query: SuggestionListQuery): Promise<{ items: StoredSuggestion[]; total: number }> {
  const visibility = query.visibility.filter((entry) => entry.organizationIds === null || entry.organizationIds.length > 0)
  if (visibility.length === 0) return { items: [], total: 0 }
  const filters = sql`
    suggestions.tenant_id = ${query.tenantId}
    and suggestions.deleted_at is null
    and ${visibilityPredicate(visibility)}
    and ${ENABLED_ORGANIZATION}
    ${query.status ? sql`and suggestions.status = ${query.status}` : sql``}
  `
  const counted = await sql<{ total: string | number }>`
    select count(*) as total from insights_automation_suggestions suggestions where ${filters}
  `.execute(db)
  const page = await sql<SuggestionRow>`
    select ${SELECT_COLUMNS}
    from insights_automation_suggestions suggestions
    where ${filters}
    order by suggestions.confidence desc, suggestions.support desc, suggestions.id asc
    limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
  `.execute(db)
  return { items: page.rows.map(mapRow), total: toNumber(counted.rows[0]?.total ?? 0) }
}

/** One suggestion of the tenant by id (not soft-deleted), or `null`. Visibility is the caller's check. */
export async function findSuggestion(db: SuggestionDb, tenantId: string, id: string): Promise<StoredSuggestion | null> {
  const result = await sql<SuggestionRow>`
    select ${SELECT_COLUMNS}
    from insights_automation_suggestions suggestions
    where suggestions.tenant_id = ${tenantId} and suggestions.id = ${id} and suggestions.deleted_at is null
      and ${ENABLED_ORGANIZATION}
  `.execute(db)
  const row = result.rows[0]
  return row ? mapRow(row) : null
}
