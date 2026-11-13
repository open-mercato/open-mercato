import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
  decryptWithAesGcm,
  encryptWithAesGcm,
  hashForLookup,
  isEncryptedPayloadShape,
} from './aes'
import { createKmsService, type KmsService, type TenantDek } from './kms'
import { isTenantDataEncryptionEnabled, isEncryptionDebugEnabled } from './toggles'
import { createLogger } from '../logger'
import {
  getEncryptionPolicyMemo,
  invalidateEncryptionPolicyMemos,
  type ResolvedEncryptionPolicy,
} from './policyMemo'
import type { EncryptionKeyScope, ModuleEncryptionMap } from '../../modules/encryption'

const logger = createLogger('shared').child({ component: 'tenant-encryption' })

export type EncryptedFieldRule = {
  field: string
  hashField?: string | null
}

export type EncryptionMapRecord = {
  entityId: string
  keyScope?: EncryptionKeyScope
  fields: EncryptedFieldRule[]
}

type MapCacheKey = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
}

type SqlConnection = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>
}

// Mirror the Vault KMS default DEK TTL so a rotated/revoked tenant key is picked
// up by long-lived processes without a restart (#2746). The service-level cache
// previously had no TTL and shadowed the KMS's own 15-minute expiry.
const DEK_CACHE_TTL_MS = 15 * 60 * 1000

function readScopeId(row: Record<string, unknown>, column: string, property: string): string | null {
  const value = row[column] ?? row[property]
  return value == null ? null : String(value).toLowerCase()
}

function sameScopeId(value: string | null, expected: string | null): boolean {
  return value === (expected == null ? null : expected.toLowerCase())
}

function cacheKey(key: MapCacheKey): string {
  return [
    'encmap',
    key.entityId.toLowerCase(),
    key.tenantId ?? 'null',
    key.organizationId ?? 'null',
  ].join(':')
}

/**
 * @deprecated Nothing reads this key: encryption policy is resolved from the canonical table and
 * `invalidateMap` no longer publishes a version token. Kept for import compatibility.
 */
export function encryptionMapPolicyVersionCacheKey(entityId: string): string {
  return ['encmap-policy-version', entityId.toLowerCase()].join(':')
}

function debug(event: string, payload: Record<string, unknown>) {
  if (!isEncryptionDebugEnabled()) return
  try {
    logger.debug(event, payload)
  } catch {
    // ignore
  }
}

const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()

const toCamelCase = (value: string): string =>
  value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

function findKey(obj: Record<string, unknown>, key: string): string | null {
  const candidates = [key, toSnakeCase(key), toCamelCase(key)]
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, candidate)) return candidate
  }
  return null
}

/**
 * Decode a decrypted entity-field payload back into its original value.
 *
 * The encrypt path stores raw strings unwrapped and JSON-stringifies non-string
 * values. Blindly running `JSON.parse` on every decrypted value would coerce
 * text columns whose contents happen to be valid JSON primitives — e.g. the
 * string `"123"` — back into numbers/booleans, which then breaks string-typed
 * consumers (see issue #1734). Only restructure the value when the decrypted
 * payload is unambiguously a JSON object or array; otherwise return the raw
 * decrypted string. Numeric/boolean entity columns are not in any current
 * encryption map, so this is backward-compatible.
 *
 * NOTE (issue #1810 follow-up): `decryptFields` no longer calls this helper for
 * entity-field decryption — typed string columns whose contents happen to look
 * like JSON (e.g. a display name `{"a":1}`) must remain raw strings to avoid
 * downstream React-render crashes. Callers that legitimately need the parse
 * (audit-log jsonb columns, custom-field rotation, encryption CLI) MUST invoke
 * `parseDecryptedFieldValue` themselves on the decrypted payload.
 */
export function parseDecryptedFieldValue(decrypted: string): unknown {
  if (decrypted.length === 0) return decrypted
  const first = decrypted[0]
  if (first !== '{' && first !== '[') return decrypted
  try {
    return JSON.parse(decrypted)
  } catch {
    return decrypted
  }
}

/**
 * A value is only treated as "already encrypted" when it actually decrypts
 * under the tenant DEK — i.e. the AES-GCM authentication tag verifies. A purely
 * structural `<iv>:<ct>:<tag>:v1` shape check is forgeable: attacker-controlled
 * field values (e.g. their own profile email/phone) could impersonate ciphertext
 * to skip encryption-at-rest and the lookup hash entirely (issue #2720). Binding
 * the check to a successful authenticated decrypt makes forgery infeasible, so a
 * fake payload simply gets encrypted like any other plaintext.
 */
function isEncryptedWithDek(value: unknown, dek: TenantDek): boolean {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  if (parts.length !== 4 || parts[3] !== 'v1') return false
  return decryptWithAesGcm(value, dek.key) !== null
}

/**
 * Guard the encrypt path against re-wrapping ciphertext this process cannot open.
 *
 * Called only after {@link isEncryptedWithDek} has already said "not sealed under the
 * current DEK". At that point a structurally well-formed envelope means one of two things:
 * genuine ciphertext under some other key, or a length-valid forgery — the shape check is
 * length-based, not content-based, so any length-correct string qualifies, not just a
 * byte-exact match against something real. Both must stop the write — the first because
 * nesting envelopes silently destroys recoverable data, the second because rejecting it is
 * strictly safer than persisting attacker-chosen bytes.
 *
 * The field name is safe to report (it comes from the encryption map, not user input); the
 * value never is, so it stays out of both the error message and the log.
 */
function assertNotSealedUnderAnotherKey(value: unknown, field: string): void {
  if (!isEncryptedPayloadShape(value)) return
  logger.error('Refusing to re-encrypt a value sealed under a different key', { field })
  throw new TenantDataEncryptionError(
    TenantDataEncryptionErrorCode.WRONG_KEY,
    `[internal] Field "${field}" already holds an encrypted payload that does not decrypt under the current tenant DEK. `
      + 'Encrypting it again would produce an unreadable nested envelope. '
      + 'Complete the key rotation for this tenant (set TENANT_DATA_ENCRYPTION_OLD_KEY, then run '
      + 'mercato entities rotate-encryption-key) '
      + 'or restore the DEK that sealed it before writing this record again.',
  )
}

function normalizeEncryptedFieldRules(
  fields: readonly { field?: unknown; hashField?: unknown }[] | null | undefined,
): EncryptedFieldRule[] {
  if (!Array.isArray(fields)) return []
  const rules: EncryptedFieldRule[] = []
  for (const rule of fields) {
    if (!rule || typeof rule !== 'object') continue
    const field = rule.field
    if (typeof field !== 'string' || field.trim().length === 0) continue
    rules.push({ field, hashField: typeof rule.hashField === 'string' ? rule.hashField : null })
  }
  return rules
}

function normalizeEncryptedFieldNames(fields: readonly { field?: unknown }[] | null | undefined): string[] {
  return normalizeEncryptedFieldRules(fields).map((rule) => rule.field)
}

/**
 * Union of field rules, first declaration wins on the field name. A later duplicate only
 * contributes its `hashField` when the winning rule declares none, so merging an organization-scoped
 * map into a tenant-wide one never silently retargets an existing lookup-hash column.
 */
function mergeEncryptedFieldRules(groups: readonly EncryptedFieldRule[][]): EncryptedFieldRule[] {
  const merged: EncryptedFieldRule[] = []
  const byField = new Map<string, EncryptedFieldRule>()
  for (const group of groups) {
    for (const rule of group) {
      const existing = byField.get(rule.field)
      if (!existing) {
        const copy: EncryptedFieldRule = { field: rule.field, hashField: rule.hashField ?? null }
        byField.set(rule.field, copy)
        merged.push(copy)
        continue
      }
      if (!existing.hashField && rule.hashField) existing.hashField = rule.hashField
    }
  }
  return merged
}

function readEncryptedFieldsJson(row: Record<string, unknown>): EncryptedFieldRule[] {
  const raw = row.fields_json ?? row.fieldsJson
  if (Array.isArray(raw)) return raw as EncryptedFieldRule[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed as EncryptedFieldRule[] : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * The KMS key id an encryption map's payloads are sealed under: a system-scoped map
 * uses a per-entity key that exists before any tenant does, everything else uses the
 * tenant's own key. Exported so callers that need to probe key availability without
 * encrypting (the encryption CLIs) derive the same id instead of re-spelling the
 * `system:` convention (#5950).
 */
export function resolveEncryptionKeyId(
  entityId: string,
  keyScope: EncryptionKeyScope | undefined,
  tenantId: string | null | undefined
): string | null {
  return keyScope === 'system' ? `system:${entityId}` : tenantId ?? null
}

/**
 * Runs a map lookup on an EntityManager rather than on `em.getConnection()`.
 *
 * `AbstractSqlConnection.execute` falls back to the pool whenever it is handed no
 * transaction context, so the connection-level call takes a SECOND pooled
 * connection while the caller already holds one for its open write transaction.
 * Policy resolution is not cached across units of work and runs for every
 * encrypt/decrypt decision that misses the per-unit-of-work memo, so under
 * concurrency every in-flight write waits on a connection that only another
 * waiting write could release — the pool deadlocks at `DB_POOL_MAX` and never
 * recovers. `SqlEntityManager.execute` forwards `getTransactionContext()`, so the
 * lookup reuses the caller's own connection, provided callers hand in the
 * EntityManager that owns the transaction (the flush subscriber passes
 * `args.em`). Reading the policy inside that transaction is also what an atomic,
 * transaction-aware map write needs.
 */
function getSqlExecutor(em: EntityManager): SqlConnection | null {
  const candidate = em as unknown as { execute?: unknown }
  if (typeof candidate.execute !== 'function') return null
  return candidate as unknown as SqlConnection
}

export class TenantDataEncryptionService {
  private static globalDekCache = new Map<string, TenantDek>()
  private static globalInflightDeks = new Map<string, Promise<TenantDek | null>>()
  private readonly kms: KmsService
  private readonly dekCache = TenantDataEncryptionService.globalDekCache
  private readonly inflightDeks = TenantDataEncryptionService.globalInflightDeks
  private readonly systemDefaultMaps: Map<string, ModuleEncryptionMap>

  constructor(
    private em: EntityManager,
    opts?: {
      /** Accepted for compatibility; encryption policy is never cached across units of work. */
      cache?: CacheStrategy
      kms?: KmsService
      defaultEncryptionMaps?: readonly ModuleEncryptionMap[]
    }
  ) {
    this.kms = opts?.kms ?? createKmsService()
    this.systemDefaultMaps = new Map(
      (opts?.defaultEncryptionMaps ?? [])
        .filter((map) => map.keyScope === 'system')
        .map((map) => [map.entityId, map]),
    )
  }

  isEnabled(): boolean {
    return isTenantDataEncryptionEnabled() && this.kms.isHealthy()
  }

  private isDekExpired(dek: TenantDek): boolean {
    return Date.now() - dek.fetchedAt > DEK_CACHE_TTL_MS
  }

  async getDek(tenantId: string | null | undefined): Promise<TenantDek | null> {
    if (!tenantId) return null
    const cached = this.dekCache.get(tenantId)
    if (cached && !this.isDekExpired(cached)) return cached
    if (cached) this.dekCache.delete(tenantId)
    const dek = await this.kms.getTenantDek(tenantId)
    if (!dek) {
      debug('🔎 dek.miss', { tenantId })
    } else {
      debug('✅ dek.hit', { tenantId })
    }
    if (dek) this.dekCache.set(tenantId, dek)
    return dek
  }

  /**
   * Resolves the DEK an encrypt call should seal under, provisioning one when the
   * tenant has none yet.
   *
   * Provisioning writes real key material to the KMS/Vault backend, so it is a
   * state change — not a cache fill. Callers whose intent is only to preview or
   * check ("would this row be encrypted?") pass `createIfMissing: false` to get a
   * `null` instead, leaving KMS untouched (issue #5950). The default stays `true`
   * so every existing write path keeps provisioning on first use.
   */
  private async resolveDekForEncrypt(
    tenantId: string | null,
    options?: { createIfMissing?: boolean }
  ): Promise<TenantDek | null> {
    const existing = await this.getDek(tenantId)
    if (existing || !tenantId) return existing ?? null
    if (options?.createIfMissing === false) return null
    if (typeof this.kms.createTenantDek !== 'function') return existing ?? null
    // Dedupe concurrent first-time creation within this process so two callers
    // can't each generate a distinct DEK and overwrite one another (#2746).
    const pending = this.inflightDeks.get(tenantId)
    if (pending) return pending
    const creation = (async () => {
      const created = await this.kms.createTenantDek(tenantId)
      if (created) this.dekCache.set(tenantId, created)
      return created ?? null
    })()
    this.inflightDeks.set(tenantId, creation)
    try {
      return await creation
    } finally {
      this.inflightDeks.delete(tenantId)
    }
  }

  async createDek(tenantId: string): Promise<TenantDek | null> {
    const dek = await this.kms.createTenantDek(tenantId)
    if (dek) this.dekCache.set(tenantId, dek)
    return dek
  }

  /**
   * Reads every row that can decide the policy for `key` in ONE statement: the exact scope, the
   * tenant-wide scope, and the global scope — plus, at the tenant-wide scope, every
   * organization-scoped map of the tenant for the all-organizations aggregate (#5949). Precedence
   * and duplicate merging happen in JS so the result is identical to resolving the fallback chain
   * one scope at a time.
   */
  private async loadPolicy(key: MapCacheKey, em?: EntityManager): Promise<ResolvedEncryptionPolicy> {
    // Bypass ORM lifecycle hooks to avoid recursive decrypt loops by querying directly.
    const conn = getSqlExecutor(em ?? this.em)
    if (!conn) {
      throw new Error('[internal] Encryption policy lookup requires an EntityManager that can execute SQL')
    }
    const includeAllOrganizations = key.organizationId == null
    const scopeClause = includeAllOrganizations
      ? 'tenant_id is not distinct from ?'
      : '(tenant_id is not distinct from ? and (organization_id = ? or organization_id is null))'
    const sql = `
      select entity_id, tenant_id, organization_id, fields_json
      from encryption_maps
      where entity_id = ?
        and is_active = true
        and deleted_at is null
        and (${scopeClause} or (tenant_id is null and organization_id is null))
      order by organization_id asc, created_at asc, id asc
    `
    const params = includeAllOrganizations
      ? [key.entityId, key.tenantId]
      : [key.entityId, key.tenantId, key.organizationId]
    const rows = await conn.execute(sql, params)
    const records = Array.isArray(rows)
      ? rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      : []

    const map = this.applySystemDefault(this.pickMostSpecificMap(key, records), key.entityId)
    const mapRules = normalizeEncryptedFieldRules(map?.fields)
    if (!includeAllOrganizations) return { map, fields: mapRules }
    const organizationRows = records.filter((record) => (
      sameScopeId(readScopeId(record, 'tenant_id', 'tenantId'), key.tenantId)
      && readScopeId(record, 'organization_id', 'organizationId') !== null
    ))
    const organizationRules = mergeEncryptedFieldRules(
      organizationRows.map((record) => normalizeEncryptedFieldRules(readEncryptedFieldsJson(record))),
    )
    return { map, fields: mergeEncryptedFieldRules([mapRules, organizationRules]) }
  }

  private pickMostSpecificMap(key: MapCacheKey, records: Record<string, unknown>[]): EncryptionMapRecord | null {
    const candidates: MapCacheKey[] = [
      key,
      { entityId: key.entityId, tenantId: key.tenantId, organizationId: null },
      { entityId: key.entityId, tenantId: null, organizationId: null },
    ]
    for (const candidate of candidates) {
      const matches = records.filter((record) => (
        sameScopeId(readScopeId(record, 'tenant_id', 'tenantId'), candidate.tenantId)
        && sameScopeId(readScopeId(record, 'organization_id', 'organizationId'), candidate.organizationId)
      ))
      if (!matches.length) {
        debug('🔍 encmap.miss', {
          entityId: candidate.entityId,
          tenantId: candidate.tenantId,
          organizationId: candidate.organizationId,
        })
        continue
      }
      if (matches.length > 1) {
        logger.warn('Duplicate live encryption maps detected; merging field rules fail-safe', {
          entityId: candidate.entityId,
          tenantId: candidate.tenantId,
          organizationId: candidate.organizationId,
          count: matches.length,
        })
      }
      return {
        entityId: String(matches[0].entity_id ?? matches[0].entityId ?? key.entityId),
        fields: mergeEncryptedFieldRules(matches.map((record) => normalizeEncryptedFieldRules(readEncryptedFieldsJson(record)))),
      }
    }
    return null
  }

  private applySystemDefault(record: EncryptionMapRecord | null, entityId: string): EncryptionMapRecord | null {
    const declared = this.systemDefaultMaps.get(entityId)
    if (!declared) return record
    const fields: EncryptedFieldRule[] = declared.fields.map((field) => ({
      field: field.field,
      hashField: field.hashField ?? null,
    }))
    const declaredFields = new Set(fields.map((field) => field.field))
    for (const field of record?.fields ?? []) {
      if (!declaredFields.has(field.field)) fields.push(field)
    }
    return {
      entityId,
      keyScope: 'system',
      fields,
    }
  }

  /**
   * Resolve policy from the canonical table. Nothing is retained across units of work: no
   * invalidation protocol can make process-local state authoritative after an independent worker
   * commits a map mutation.
   *
   * Within one unit of work — the caller's EntityManager, or its open transaction — repeated
   * decisions for the same scope share a single read, so loading N rows or running the before/after
   * hooks of one flush costs one query instead of one per row and hook. That memo dies with the
   * EntityManager/transaction, is dropped for the EntityManager that writes a map
   * (`forgetEncryptionPolicyMemo`) and after its flush, and for every EntityManager when this
   * process invalidates a map. Calls that do not hand in an EntityManager fall back to the
   * long-lived service EntityManager and are never memoized.
   */
  private resolvePolicy(key: MapCacheKey, em?: EntityManager): Promise<ResolvedEncryptionPolicy> {
    if (!em) return this.loadPolicy(key)
    const memo = getEncryptionPolicyMemo(em)
    const tag = cacheKey(key)
    const pending = memo.get(tag)
    if (pending) return pending
    const loading = this.loadPolicy(key, em)
    memo.set(tag, loading)
    loading.catch(() => {
      if (memo.get(tag) === loading) memo.delete(tag)
    })
    return loading
  }

  /**
   * Drops the policy reads memoized by every EntityManager of this process. Map writers call it
   * after their write commits; readers in other processes never depended on it, because policy is
   * not cached across units of work.
   */
  async invalidateMap(entityId: string, tenantId: string | null, organizationId: string | null): Promise<void> {
    debug('♻️ encmap.invalidate', { entityId, tenantId, organizationId })
    invalidateEncryptionPolicyMemos()
  }

  // Force a flush of a tenant's cached DEK across the service-level cache and the
  // underlying KMS cache so an operator can pick up a rotated/revoked key without
  // a process restart (#2746).
  invalidateDek(tenantId: string): void {
    this.dekCache.delete(tenantId)
    this.inflightDeks.delete(tenantId)
    this.kms.invalidateDek?.(tenantId)
  }

  /**
   * Lists the fields an encryption map marks as encrypted at rest.
   *
   * `isEnabled()` folds the environment toggle together with KMS health, so by default an
   * unhealthy KMS reports "nothing is encrypted" — which is safe for write paths but wrong for
   * readers that must decide whether a stored column holds ciphertext. `ignoreRuntimeHealth`
   * answers the on-disk question instead: it consults the map even when the KMS cannot currently
   * resolve a DEK, so callers can fail closed rather than treat ciphertext as plaintext (#4622).
   */
  async getEncryptedFieldNames(
    entityId: string,
    tenantId: string | null | undefined,
    organizationId?: string | null,
    options?: { ignoreRuntimeHealth?: boolean; em?: EntityManager }
  ): Promise<string[]> {
    if (options?.ignoreRuntimeHealth) {
      if (!isTenantDataEncryptionEnabled()) return []
    } else if (!this.isEnabled()) {
      return []
    }
    const { fields } = await this.resolvePolicy(
      { entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null },
      options?.em,
    )
    return fields.map((rule) => rule.field)
  }

  private encryptFields(
    obj: Record<string, unknown>,
    fields: EncryptedFieldRule[],
    dek: TenantDek
  ): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...obj }
    for (const rule of fields) {
      const key = findKey(clone, rule.field)
      if (!key) continue
      const value = clone[key]
      if (value === null || value === undefined) continue
      // Avoid double-encrypting payloads that genuinely decrypt under this DEK.
      // A forged ciphertext-shaped string fails this check and is encrypted as
      // plaintext, closing the encryption-at-rest bypass (issue #2720).
      if (isEncryptedWithDek(value, dek)) continue
      // Failing that check does not prove the value is plaintext. A well-formed
      // envelope sealed under a *different* key — the previous DEK mid-rotation, or
      // the derived key the KMS falls back to during a Vault outage — lands here too,
      // and encrypting it again would nest one envelope inside another: unreadable by
      // any normal decrypt, indistinguishable from correct ciphertext by inspection,
      // and it would overwrite the lookup hash with a hash of ciphertext (issue #5951).
      // Fail the write closed instead. Nothing is ever stored verbatim, so #2720 stays
      // shut: a forgery whose shape is not length-valid still gets encrypted as plaintext
      // above, and a length-valid one is rejected rather than persisted.
      assertNotSealedUnderAnotherKey(value, rule.field)
      const serialized = typeof value === 'string' ? value : JSON.stringify(value)
      const payload = encryptWithAesGcm(serialized, dek.key)
      clone[key] = payload.value
      if (rule.hashField) {
        const hashKey = findKey(clone, rule.hashField) ?? rule.hashField
        clone[hashKey] = hashForLookup(serialized)
      }
    }
    return clone
  }

  private decryptFields(
    obj: Record<string, unknown>,
    fields: EncryptedFieldRule[],
    dek: TenantDek
  ): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...obj }
    const maybeDecrypt = (payload: string): string | null => {
      const first = decryptWithAesGcm(payload, dek.key)
      if (first === null) return null
      // Handle accidental double-encryption: if the first pass still looks like a v1 payload, try once more.
      const parts = first.split(':')
      if (parts.length === 4 && parts[3] === 'v1') {
        const second = decryptWithAesGcm(first, dek.key)
        return second ?? first
      }
      return first
    }
    for (const rule of fields) {
      const key = findKey(clone, rule.field)
      if (!key) continue
      const value = clone[key]
      if (typeof value !== 'string') continue
      const decrypted = maybeDecrypt(value)
      if (decrypted === null) continue
      // Entity fields are typed columns (string/text). Never auto-parse to an object —
      // it triggers React-render crashes when a string value happens to be valid JSON
      // (issue #1810 follow-up). Custom field values use a separate helper that
      // preserves their typed-JSON contract.
      clone[key] = decrypted
    }
    return clone
  }

  /**
   * Encrypts the fields an entity's encryption map covers.
   *
   * `options.createMissingDek` (default `true`) controls whether a tenant without
   * a DEK gets one provisioned as a side effect. Preview/check callers — most
   * notably `mercato entities rotate-encryption-key --dry-run` — pass `false` so a
   * read-only invocation cannot write key material to KMS (issue #5950). With
   * `false` and no existing DEK the payload is returned unchanged, exactly as it
   * is when the KMS declines to issue a key.
   */
  async encryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
    options?: { createMissingDek?: boolean; em?: EntityManager }
  ): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      debug('⚪️ encrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const { map, fields } = await this.resolvePolicy(
      { entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null },
      options?.em,
    )
    if (!fields.length) {
      debug('⚪️ encrypt.skip.no-map', { entityId, tenantId })
      return payload
    }
    const keyId = resolveEncryptionKeyId(entityId, map?.keyScope, tenantId)
    const dek = await this.resolveDekForEncrypt(keyId, { createIfMissing: options?.createMissingDek !== false })
    if (!dek) {
      debug('⚠️ encrypt.skip.no-dek', { entityId, tenantId, keyScope: map?.keyScope ?? 'tenant' })
      return payload
    }
    debug('🔒 encrypt_entity', { entityId, tenantId, organizationId, fields: fields.length })
    return this.encryptFields(payload, fields, dek)
  }

  async decryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
    options?: { em?: EntityManager }
  ): Promise<Record<string, unknown>> {
    if (!isTenantDataEncryptionEnabled()) {
      debug('⚪️ decrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const { map, fields } = await this.resolvePolicy(
      { entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null },
      options?.em,
    )
    if (!fields.length) {
      debug('⚪️ decrypt.skip.no-map', { entityId, tenantId })
      return payload
    }
    const keyId = resolveEncryptionKeyId(entityId, map?.keyScope, tenantId)
    const dek = await this.getDek(keyId)
    if (!dek) {
      debug('⚠️ decrypt.skip.no-dek', { entityId, tenantId, keyScope: map?.keyScope ?? 'tenant' })
      return payload
    }
    debug('🔓 decrypt_entity', { entityId, tenantId, organizationId, fields: fields.length })
    return this.decryptFields(payload, fields, dek)
  }
}
