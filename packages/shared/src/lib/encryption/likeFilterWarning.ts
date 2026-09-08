import type { EntityManager, EntityName } from '@mikro-orm/postgresql'
import { warnOnCiphertextLikeFallback } from '../query/ciphertext-search-warning'
import { resolveTenantEncryptionService } from './customFieldValues'
import { resolveEntityIdFromMetadata } from './entityIds'
import type { TenantDataEncryptionService } from './tenantDataEncryptionService'

const LIKE_OPERATORS = new Set(['$like', '$ilike', '$re', '$fulltext'])
const LOGICAL_OPERATORS = new Set(['$and', '$or', '$not', '$every', '$some', '$none'])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

// An operator object holds only `$`-prefixed keys. Anything else is a nested
// relation filter, whose property names belong to another entity's encryption
// map — attributing them to the root entity would produce false warnings.
const isOperatorObject = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((key) => key.startsWith('$'))
}

function walkFilter(node: unknown, field: string | null, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walkFilter(item, field, out)
    return
  }
  if (!isPlainObject(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (LIKE_OPERATORS.has(key)) {
      if (field) out.add(field)
      continue
    }
    if (LOGICAL_OPERATORS.has(key)) {
      walkFilter(value, field, out)
      continue
    }
    if (key.startsWith('$')) continue
    if (isOperatorObject(value)) walkFilter(value, key, out)
  }
}

/**
 * Lists the root-entity properties a filter targets with a string-matching
 * operator (`$like`, `$ilike`, `$re`, `$fulltext`), including inside
 * `$and`/`$or`/`$not` branches.
 */
export function collectLikeFilterFields(where: unknown): string[] {
  const found = new Set<string>()
  walkFilter(where, null, found)
  return Array.from(found)
}

// The map lookup behind the warning issues an uncached read against
// `encryption_maps`, and this path runs on every matching query rather than in a
// rare fallback branch — so the check stays out of production entirely.
const isWarningEnabled = (): boolean => process.env.NODE_ENV !== 'production'

function resolveEntityId(em: EntityManager, entityName: EntityName<any>): string | null {
  const metadata = (em as any)?.getMetadata?.()
  if (!metadata || typeof metadata.find !== 'function') return null
  const name = typeof entityName === 'string' ? entityName : (entityName as any)?.name
  if (!name) return null
  return resolveEntityIdFromMetadata(metadata.find(name) ?? undefined)
}

/**
 * Warn, outside production, when a `where` clause matches an encrypted-at-rest
 * column with a string operator.
 *
 * Decryption happens on load, not on filter, so the predicate compares a
 * plaintext pattern against ciphertext: it matches nothing and does not raise,
 * which is indistinguishable from a genuine empty result. The query engines
 * already warn about their own `ILIKE` fallback; this covers the raw-ORM path
 * that never reaches them. Issue #5051, related to #2990.
 *
 * Never throws and never blocks the query.
 */
export async function warnOnEncryptedLikeFilter(params: {
  em: EntityManager
  entityName: EntityName<any>
  where: unknown
  tenantId?: string | null
  encryptionService?: TenantDataEncryptionService | null
}): Promise<void> {
  if (!isWarningEnabled()) return
  const fields = collectLikeFilterFields(params.where)
  if (!fields.length) return
  try {
    const entity = resolveEntityId(params.em, params.entityName)
    if (!entity) return
    const service = params.encryptionService ?? resolveTenantEncryptionService(params.em)
    await warnOnCiphertextLikeFallback({
      entity,
      fields,
      tenantId: params.tenantId ?? null,
      reason: 'raw-orm-filter',
      service,
    })
  } catch {
    // A diagnostic must never break the query it is diagnosing.
  }
}
