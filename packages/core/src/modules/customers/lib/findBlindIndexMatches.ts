import { raw, type EntityManager } from '@mikro-orm/postgresql'
import { looksLikeEncryptedPayload, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { normalizeColumnName } from '@open-mercato/shared/lib/query/ciphertext-search-warning'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'

export const MATCH_CANDIDATE_LIMIT = 500

const logger = createLogger('customers').child({ component: 'blind-index-lookup' })
const LOOKUP_TRIM_CHARACTERS =
  '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
const WARNING_INTERVAL_MS = 60_000
const WARNING_CACHE_LIMIT = 5_000
const lastWarnings = new Map<string, number>()

type LookupScope = { tenantId: string; organizationId: string }
type LookupField = { entityId: string; column: string }

type Candidates<Row> = {
  byHash: (hashes: string[]) => Promise<Row[]>
  byPlaintext: (values: string[]) => Promise<Row[]>
  recent: () => Promise<Row[]>
  id: (row: Row) => string
  value: (row: Row) => string | null | undefined
  normalize: (value: string) => string | null
  variants?: (value: string) => string[]
}

const warningMessages = {
  undecryptable: 'CRM blind index candidates could not be decrypted',
  fallbackMatch: 'CRM encrypted lookup matched through the fallback. Run mercato customers lookup-hashes:backfill.',
  fallbackLimit: 'CRM encrypted lookup exhausted the fallback scan with unresolved inputs',
}

function warn(
  reason: keyof typeof warningMessages,
  field: LookupField,
  scope: LookupScope,
  count: number,
): void {
  const key = JSON.stringify([reason, field.entityId, field.column, scope.tenantId, scope.organizationId])
  const now = Date.now()
  const previous = lastWarnings.get(key)
  if (previous !== undefined && now - previous < WARNING_INTERVAL_MS) return
  lastWarnings.delete(key)
  if (lastWarnings.size >= WARNING_CACHE_LIMIT) {
    const oldest = lastWarnings.keys().next().value
    if (oldest !== undefined) lastWarnings.delete(oldest)
  }
  lastWarnings.set(key, now)
  logger.warn(warningMessages[reason], { ...scope, ...field, reason, count })
}

async function isEncryptedField(em: EntityManager, field: LookupField, scope: LookupScope): Promise<boolean> {
  try {
    const service = resolveTenantEncryptionService(em)
    const fields = await service?.getEncryptedFieldNames(
      field.entityId,
      scope.tenantId,
      scope.organizationId,
      { ignoreRuntimeHealth: true, em },
    )
    return fields?.some((name) => normalizeColumnName(name) === field.column) ?? false
  } catch (error) {
    reportTelemetryError(error, { module: 'customers', code: 'customers.lookup_policy_check_failed' })
    return false
  }
}

export function normalizedPlaintextFilter(column: 'primary_email' | 'domain', values: string[]) {
  const normalizedColumn = raw((alias) => `lower(btrim(${alias}."${column}", ?))`, [LOOKUP_TRIM_CHARACTERS])
  return { [normalizedColumn]: { $in: values } }
}

export async function findBlindIndexMatches<Row>(
  em: EntityManager,
  scope: LookupScope,
  field: LookupField,
  values: string[],
  candidates: Candidates<Row>,
): Promise<Array<{ id: string; value: string }>> {
  const unresolved = new Set(values)
  const matches = new Map<string, string>()
  const undecryptable = new Set<string>()
  const variants = (input: Iterable<string>) => Array.from(new Set(
    Array.from(input).flatMap((value) => candidates.variants?.(value) ?? [value]),
  ))

  function verify(rows: Row[]): void {
    for (const row of rows) {
      const value = candidates.value(row)
      if (value == null) continue
      if (looksLikeEncryptedPayload(value)) {
        undecryptable.add(candidates.id(row))
        continue
      }
      const normalized = candidates.normalize(value)
      if (normalized !== null && unresolved.delete(normalized)) {
        matches.set(normalized, candidates.id(row))
      }
    }
  }

  const hashes = Array.from(new Set(variants(unresolved).flatMap((value) => lookupHashCandidates(value))))
  verify(await candidates.byHash(hashes))
  if (unresolved.size > 0) verify(await candidates.byPlaintext(variants(unresolved)))

  if (unresolved.size > 0) {
    const beforeScan = unresolved.size
    const rows = await candidates.recent()
    verify(rows)
    const fallbackMatches = beforeScan - unresolved.size
    const exhausted = rows.length === MATCH_CANDIDATE_LIMIT && unresolved.size > 0
    if ((fallbackMatches > 0 || exhausted) && await isEncryptedField(em, field, scope)) {
      if (fallbackMatches > 0) warn('fallbackMatch', field, scope, fallbackMatches)
      if (exhausted) warn('fallbackLimit', field, scope, unresolved.size)
    }
  }
  if (undecryptable.size > 0) warn('undecryptable', field, scope, undecryptable.size)

  const seen = new Set<string>()
  const results: Array<{ id: string; value: string }> = []
  for (const value of values) {
    const id = matches.get(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    results.push({ id, value })
  }
  return results
}
