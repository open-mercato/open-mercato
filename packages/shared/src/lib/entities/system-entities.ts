const RESERVED_SYSTEM_ENTITY_TYPES = new Set<string>([
  'entities:custom_entity',
  'entities:custom_entity_storage',
  'entities:custom_field_def',
  'entities:custom_field_value',
  'query_index:entity_index_row',
  'query_index:entity_index_coverage',
  'query_index:search_token',
])

export function isSystemEntitySelectable(entityId: string): boolean {
  if (!entityId) return false
  return !RESERVED_SYSTEM_ENTITY_TYPES.has(entityId)
}

export function flattenSystemEntityIds(
  allEntities: Record<string, Record<string, string>>,
  options?: { predicate?: (entityType: string) => boolean },
): string[] {
  if (!allEntities) return []
  const predicate = options?.predicate || isSystemEntitySelectable
  const seen = new Set<string>()
  for (const bucket of Object.values(allEntities)) {
    for (const id of Object.values(bucket ?? {})) {
      if (typeof id !== 'string' || id.length === 0) continue
      if (!predicate(id)) continue
      seen.add(id)
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

export function filterSelectableSystemEntityIds(entityIds: Iterable<string>): string[] {
  const selected: string[] = []
  for (const id of entityIds) {
    if (isSystemEntitySelectable(id)) selected.push(id)
  }
  return selected
}

export function isReservedSystemEntityType(entityId: string): boolean {
  return RESERVED_SYSTEM_ENTITY_TYPES.has(entityId)
}

/**
 * Entity types that must never reach `entity_indexes` or `search_tokens`.
 *
 * Distinct from {@link RESERVED_SYSTEM_ENTITY_TYPES} above, which answers a
 * different question — "may a custom field be attached to this, and should it be
 * offered in an entity picker?" — and is consulted only where entity types are
 * *enumerated*: `flattenSystemEntityIds()`, and the custom-field-definition API.
 * Enumeration is not a chokepoint. `mercato query_index reindex --entity <id>`,
 * `mercato query_index rebuild --entity <id>` and a `query_index.upsert_one`
 * event all name their entity type directly and never pass through it, which is
 * why `reindexEntity()` carried a second, one-entry copy of the idea as a bare
 * `entityType === 'query_index:search_token'` literal. This list is that idea
 * expressed once, enforced where the writes happen.
 *
 * The members are entity types whose whole purpose is to hold a bearer
 * credential or the verifier for one. They carry nothing a person would search
 * for, no screen renders them, and nothing reads them through the query engine —
 * so the index row is pure exposure with no counterpart in value:
 *
 *  - `buildIndexDocument()` copies the base row into `doc` verbatim. Field-level
 *    blocklisting (`isSearchFieldBlocklisted`, #4624) governs the `search_text`
 *    aggregate and the token rows; it does not govern the stored document. The
 *    credential therefore lands in `entity_indexes.doc` regardless, unless the
 *    entity happens to declare payload encryption.
 *  - The fields that are *not* blocklisted get tokenised and become searchable:
 *    `customer_accounts:customer_user_session` contributes `ip_address` and
 *    `user_agent`, `security:sudo_session` contributes `target_identifier`.
 *  - Several of these tables have no `tenant_id` column at all, so the rows are
 *    filed under whichever tenant last ran a reindex.
 *
 * A row already written by an earlier release is cleaned up rather than merely
 * frozen: `buildIndexDoc()` returns null for these types, and `upsertIndexRow()`
 * already deletes the projection row and its tokens on a null document, so the
 * next event touching the record removes it. A full
 * `mercato query_index reindex` purges each entity type before refusing it.
 *
 * Deliberately NOT here: entity types that hold a secret column *and* back a
 * management list with display-worthy fields — `api_keys:api_key`,
 * `integrations:integration_credentials`, `sso:sso_config`,
 * `inbox_ops:inbox_settings`, `webhooks:webhook_entity`,
 * `checkout:checkout_link_template`, `payment_gateways:gateway_transaction`.
 * Removing those from the index would break their own list screens, so the
 * field-level blocklist is what protects them. Also excluded, on the same test
 * applied to closer calls: `security:user_mfa_method` and `sso:scim_token`
 * (a `label`/`name` a user picks from), `onboarding:onboarding_request`
 * (an admin queue keyed on the applicant's email), `devices:user_device`,
 * `record_locks:record_lock`, `attachments:attachment_quota_reservation` and
 * `payment_gateways:gateway_session_initialization` (operational records whose
 * token is a coordination claim rather than the row's reason to exist).
 */
const CREDENTIAL_BEARING_ENTITY_TYPES: readonly string[] = [
  // @open-mercato/core
  'auth:session',
  'auth:password_reset',
  'customer_accounts:customer_user_session',
  'customer_accounts:customer_user_password_reset',
  'customer_accounts:customer_user_email_verification',
  'customer_accounts:customer_user_invitation',
  'communication_channels:channel_thread_token',
  'messages:message_access_token',
  // Indexing the token table into itself is a feedback loop. `reindexEntity()`
  // refused this one by name; the refusal now lives here with the rest.
  'query_index:search_token',
  // @open-mercato/enterprise — `security`
  'security:sudo_session',
  'security:mfa_challenge',
  'security:mfa_recovery_code',
]

const nonIndexableEntityTypes = new Set<string>(CREDENTIAL_BEARING_ENTITY_TYPES)

function normalizeEntityType(entityType: string): string {
  return String(entityType || '').trim()
}

/**
 * Declare that an entity type must never be written to the query index.
 *
 * For credential tables owned by an application or by a package this one cannot
 * name. Additive only: it can widen the refusal, never narrow it.
 *
 * Read the asymmetry with `registerTenantGlobalEntityTypes()` before treating
 * the two as the same pattern. There, an entity type nobody declares fails
 * *closed*, so registration is the whole mechanism and forgetting it costs a
 * search result. Here, an entity type nobody declares fails *open*, and
 * forgetting it costs a credential in a searchable table — so the built-in list
 * above is the mechanism, and this is an escape hatch for code that cannot be on
 * it. For the same reason the call must happen at module load, before any index
 * write: a registration that lands after the first `query_index.upsert_one` has
 * already lost.
 */
export function registerNonIndexableEntityTypes(...entityTypes: string[]): void {
  for (const entityType of entityTypes) {
    const normalized = normalizeEntityType(entityType)
    if (normalized) nonIndexableEntityTypes.add(normalized)
  }
}

/** False when the entity type must never reach `entity_indexes` or `search_tokens`. */
export function isIndexableEntityType(entityType: string): boolean {
  return !nonIndexableEntityTypes.has(normalizeEntityType(entityType))
}

/** The current refusal list, for diagnostics and tests. */
export function listNonIndexableEntityTypes(): string[] {
  return Array.from(nonIndexableEntityTypes)
}

/** Test-only: drop every registration and restore the built-in entries. */
export function resetNonIndexableEntityTypes(): void {
  nonIndexableEntityTypes.clear()
  for (const entityType of CREDENTIAL_BEARING_ENTITY_TYPES) nonIndexableEntityTypes.add(entityType)
}
