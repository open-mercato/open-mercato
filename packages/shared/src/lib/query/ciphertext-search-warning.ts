import { createLogger } from '../logger'
import type { EntityId } from '../../modules/entities'

const logger = createLogger('shared').child({ component: 'query' })

/**
 * Minimal slice of `TenantDataEncryptionService` needed to decide whether a
 * text filter targets an encrypted column.
 */
export type CiphertextWarningEncryptionService = {
  getEncryptedFieldNames?: (
    entityId: EntityId,
    tenantId?: string | null,
    organizationId?: string | null,
  ) => Promise<readonly string[]>
  isEnabled?: () => boolean
} | null | undefined

export type CiphertextLikeFallbackReason = 'no-indexable-tokens' | 'no-search-tokens' | 'search-disabled'

// One warning per entity/tenant/field per process — the fallback repeats on
// every request, and an operator only needs to learn about it once.
const WARN_CACHE_CAP = 5000
const warned = new Set<string>()

const warnKey = (entity: string, tenantId: string | null, field: string): string =>
  `${entity}|${tenantId ?? 'null'}|${field}`

export const normalizeColumnName = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** Test seam: the warn-once cache is process-global by design. */
export function resetCiphertextLikeWarnCache(): void {
  warned.clear()
}

/**
 * Warn when a `like`/`ilike` filter is about to run against a column that an
 * encryption map covers while the token index is unavailable.
 *
 * Without this the query degrades silently: the predicate compares a plaintext
 * pattern against ciphertext, matches nothing, and the endpoint returns an
 * empty page that is indistinguishable from a genuine no-result. Issue #2990.
 *
 * Never throws and never blocks the query — a failure here is logged at debug
 * level and the caller proceeds unchanged.
 */
export async function warnOnCiphertextLikeFallback(params: {
  entity: string
  fields: readonly string[]
  tenantId: string | null
  reason: CiphertextLikeFallbackReason
  service: CiphertextWarningEncryptionService
}): Promise<void> {
  const { entity, tenantId, reason, service } = params
  if (!service || service.isEnabled?.() === false) return
  if (typeof service.getEncryptedFieldNames !== 'function') return

  const candidates = params.fields
    .filter((field) => typeof field === 'string' && !field.startsWith('cf:'))
    .map((field) => normalizeColumnName(field))
    .filter((field, index, all) => field.length > 0 && all.indexOf(field) === index)
    .filter((field) => !warned.has(warnKey(entity, tenantId, field)))
  if (!candidates.length) return

  try {
    // `organizationId: null` resolves the global map plus every per-organization
    // override, so a field encrypted for any organization is reported.
    const encrypted = new Set(
      (await service.getEncryptedFieldNames(entity, tenantId, null)).map((field) =>
        normalizeColumnName(String(field)),
      ),
    )
    for (const field of candidates) {
      if (!encrypted.has(field)) continue
      if (warned.size >= WARN_CACHE_CAP) warned.clear()
      warned.add(warnKey(entity, tenantId, field))
      logger.warn('Text search filter cannot match an encrypted column', {
        entity,
        field,
        reason,
        hint: reason === 'search-disabled'
          ? 'OM_SEARCH_ENABLED is off, so the filter runs as ILIKE against ciphertext and matches nothing.'
          : reason === 'no-indexable-tokens'
            ? 'The filter value produced no search tokens, so it runs as ILIKE against ciphertext and matches nothing. Use at least OM_SEARCH_MIN_LEN indexable characters, or filter on the deterministic hash column.'
            : 'No search_tokens exist for this entity and scope, so the filter runs as ILIKE against ciphertext and matches nothing. Index the entity through query_index and reindex, or filter on the deterministic hash column.',
      })
    }
  } catch (err) {
    logger.debug('Ciphertext search warning check failed', {
      entity,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
