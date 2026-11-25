import { sql, type RawBuilder } from 'kysely'
import { tokenizeText } from '../search/tokenize'
import type { SearchConfig } from '../search/config'
import { fieldNameCandidates } from './encrypted-sort'
import type { NormalizedFilter } from './join-utils'

const NEGATED_TEXT_CONTEXT = Symbol('negatedTextContext')
const CIPHERTEXT_ENVELOPE_PATTERN = '^[A-Za-z0-9+/=]{16}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]{24}:v1$'

type NegatedTextContext = {
  entity: string
  field: string
  recordIdColumn: string
  organizationIdColumn: string | null
  tenantId: string | null
  organizationScope?: { ids: string[]; includeNull: boolean } | null
  searchEnabled: boolean
  searchConfig: SearchConfig
  encryptedFields: readonly string[] | null
  mixedValues?: boolean
}

type PreparedNegatedText = {
  [NEGATED_TEXT_CONTEXT]: true
  pattern: string
  context: NegatedTextContext
}

function isPlaintext(context: NegatedTextContext): boolean {
  const candidates = fieldNameCandidates(context.field)
  return context.encryptedFields !== null
    && !context.encryptedFields.some((field) => fieldNameCandidates(field).some((candidate) => candidates.includes(candidate)))
}

export async function prepareNotIlikeFilters(
  filters: NormalizedFilter[],
  resolveContext: (field: string) => Promise<NegatedTextContext>,
): Promise<void> {
  for (const filter of filters) {
    if (filter.op !== 'not_ilike') continue
    if (typeof filter.value !== 'string') throw new TypeError('[internal] QueryEngine: text negation requires a string pattern')
    const resolvedContext = await resolveContext(filter.field)
    const context = { ...resolvedContext, mixedValues: resolvedContext.mixedValues || filter.field.startsWith('cf:') }
    if (!context.mixedValues && !isPlaintext(context) && (
      !context.searchEnabled || !tokenizeText(filter.value, context.searchConfig).hashes.length
    )) {
      throw new TypeError('[internal] QueryEngine: encrypted text negation requires an indexable search term and search tokens')
    }
    filter.value = { [NEGATED_TEXT_CONTEXT]: true, pattern: filter.value, context } satisfies PreparedNegatedText
  }
}

function isPrepared(value: unknown): value is PreparedNegatedText {
  return !!value && typeof value === 'object'
    && (value as Record<symbol, unknown>)[NEGATED_TEXT_CONTEXT] === true
}

function buildTokenExclusion(expression: RawBuilder<unknown>, pattern: string, context: NegatedTextContext): RawBuilder<boolean> {
  if (!context.searchEnabled) return sql<boolean>`false`
  const { hashes } = tokenizeText(pattern, context.searchConfig)
  if (!hashes.length) return sql<boolean>`false`
  const scope = sql<boolean>`entity_type = ${context.entity}
    and entity_id = ${sql.ref(context.recordIdColumn)}::text
    and field = ${context.field}
    and tenant_id is not distinct from ${context.tenantId}
    and organization_id is not distinct from ${context.organizationIdColumn ? sql.ref(context.organizationIdColumn) : sql`null`}`
  const organizationScope = context.organizationScope
  const organization = !organizationScope
    ? sql<boolean>`true`
    : organizationScope.ids.length
      ? organizationScope.includeNull
        ? sql<boolean>`(organization_id in (${sql.join(organizationScope.ids)}) or organization_id is null)`
        : sql<boolean>`organization_id in (${sql.join(organizationScope.ids)})`
      : organizationScope.includeNull ? sql<boolean>`organization_id is null` : sql<boolean>`false`
  return sql<boolean>`${expression} is not null
    and exists (select 1 from search_tokens where ${scope} and ${organization})
    and not exists (
      select 1 from search_tokens where ${scope} and ${organization}
        and token_hash in (${sql.join(hashes)})
      group by entity_id, field
      having count(distinct token_hash) >= ${hashes.length}
    )`
}

export function buildNotIlikePredicate(column: string | RawBuilder<unknown>, value: unknown): RawBuilder<boolean> {
  const expression = typeof column === 'string' ? sql.ref(column) : column
  if (!isPrepared(value)) {
    if (typeof value !== 'string') throw new TypeError('[internal] QueryEngine: text negation requires a prepared pattern')
    return sql<boolean>`case when ${expression} ~ ${CIPHERTEXT_ENVELOPE_PATTERN} then false else ${expression} not ilike ${value} end`
  }
  const { context, pattern } = value
  if (context.mixedValues) {
    return sql<boolean>`case when ${expression} ~ ${CIPHERTEXT_ENVELOPE_PATTERN}
      then ${buildTokenExclusion(expression, pattern, context)}
      else ${expression} not ilike ${pattern} end`
  }
  if (isPlaintext(context)) {
    return sql<boolean>`case when ${expression} ~ ${CIPHERTEXT_ENVELOPE_PATTERN} then false else ${expression} not ilike ${pattern} end`
  }
  return buildTokenExclusion(expression, pattern, context)
}

export function buildNotIlikeJsonPredicate(expression: RawBuilder<unknown>, value: unknown): RawBuilder<boolean> {
  const values = sql`case when jsonb_typeof(${expression}) = 'array' then ${expression} else jsonb_build_array(${expression}) end`
  const element = sql.ref('negated_value.value')
  const text = sql`${element} #>> '{}'`
  return sql<boolean>`exists (
      select 1 from jsonb_array_elements(${values}) as negated_value(value)
      where jsonb_typeof(${element}) in ('string', 'number', 'boolean')
    ) and not exists (
      select 1 from jsonb_array_elements(${values}) as negated_value(value)
      where jsonb_typeof(${element}) not in ('string', 'number', 'boolean', 'null')
        or not (${buildNotIlikePredicate(text, value)})
    )`
}

export function bindNotIlikeValueSource(
  value: unknown,
  source: Pick<NegatedTextContext, 'entity' | 'field' | 'recordIdColumn' | 'organizationIdColumn'>,
): unknown {
  return isPrepared(value) ? { ...value, context: { ...value.context, ...source } } satisfies PreparedNegatedText : value
}
