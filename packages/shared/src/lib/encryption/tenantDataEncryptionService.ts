import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { decryptWithAesGcm, encryptWithAesGcm, hashForLookup } from './aes'
import { createKmsService, type KmsService, type TenantDek } from './kms'
import { isTenantDataEncryptionEnabled, isEncryptionDebugEnabled } from './toggles'
import { createLogger } from '../logger'
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
  execute(sql: string, params?: readonly unknown[], method?: string, ctx?: unknown): Promise<unknown>
}

/**
 * Per-call scope that lets an encryption-map lookup join the caller's
 * transaction instead of taking a second pool connection (issue #6301).
 *
 * Only the transaction context is read off `em` — the lookup never injects a
 * default context, so one request's transaction cannot leak into another
 * request's decryption.
 */
export type EncryptionMapScope = {
  em?: { getTransactionContext?: () => unknown } | null
}

const MAP_MISS_TTL_MS = 5 * 60 * 1000
// Mirror the Vault KMS default DEK TTL so a rotated/revoked tenant key is picked
// up by long-lived processes without a restart (#2746). The service-level cache
// previously had no TTL and shadowed the KMS's own 15-minute expiry.
const DEK_CACHE_TTL_MS = 15 * 60 * 1000
// Matches the `{ ttl: 300 }` passed to the `CacheStrategy` layer for the all-organizations
// aggregate, so a process that only ever hits its own memory entry (no shared cache configured,
// or already warm) still picks up a runtime map edit within the same bound (#6066).
const AGGREGATE_CACHE_TTL_MS = 300 * 1000

function cacheKey(key: MapCacheKey): string {
  return [
    'encmap',
    key.entityId.toLowerCase(),
    key.tenantId ?? 'null',
    key.organizationId ?? 'null',
  ].join(':')
}

// Tag for the aggregate of every organization-scoped map of an entity/tenant. The prefix differs
// from `cacheKey`'s in its first segment rather than by an extra one, so no entity id can spell a
// tag that collides with an aggregate (`encmap:all-orgs:x:y` would be reachable both ways).
function allOrganizationsCacheKey(entityId: string, tenantId: string | null): string {
  return ['encmap-all-orgs', entityId.toLowerCase(), tenantId ?? 'null'].join(':')
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

function getSqlConnection(em: { getConnection?: () => unknown } | null | undefined): SqlConnection | null {
  const conn = em?.getConnection?.()
  if (!conn || typeof conn !== 'object') return null
  const candidate = conn as { execute?: unknown }
  if (typeof candidate.execute !== 'function') return null
  return candidate as SqlConnection
}

/**
 * Resolves the connection and transaction context an encryption-map lookup
 * should run with. Inside a transaction (`ctx !== undefined`) the lookup must
 * run on the caller's connection — with no pool of its own to wait on, a
 * saturated pool can no longer deadlock the request (issue #6301). Outside a
 * transaction the service connection is used exactly as before.
 */
function resolveMapLookupTarget(scope: EncryptionMapScope | undefined, fallback: EntityManager): {
  em: { getConnection?: () => unknown; getTransactionContext?: () => unknown }
  ctx: unknown
  scoped: boolean
} {
  const ctx = scope?.em?.getTransactionContext?.()
  if (ctx === undefined || !scope?.em) return { em: fallback, ctx: undefined, scoped: false }
  return { em: scope.em, ctx, scoped: true }
}

export class TenantDataEncryptionService {
  private static globalMemoryCache = new Map<string, EncryptionMapRecord>()
  private static globalAggregateMemoryCache = new Map<string, { at: number; record: EncryptionMapRecord }>()
  private static globalInflightMaps = new Map<string, Promise<EncryptionMapRecord | null>>()
  private static globalDekCache = new Map<string, TenantDek>()
  private static globalInflightDeks = new Map<string, Promise<TenantDek | null>>()
  private static globalMissCache = new Map<string, number>()
  private readonly kms: KmsService
  private readonly cache?: CacheStrategy
  private readonly memoryCache = TenantDataEncryptionService.globalMemoryCache
  private readonly aggregateMemoryCache = TenantDataEncryptionService.globalAggregateMemoryCache
  private readonly dekCache = TenantDataEncryptionService.globalDekCache
  private readonly inflightDeks = TenantDataEncryptionService.globalInflightDeks
  private readonly inflightMaps = TenantDataEncryptionService.globalInflightMaps
  private readonly missCache = TenantDataEncryptionService.globalMissCache
  private readonly systemDefaultMaps: Map<string, ModuleEncryptionMap>

  constructor(
    private em: EntityManager,
    opts?: {
      cache?: CacheStrategy
      kms?: KmsService
      defaultEncryptionMaps?: readonly ModuleEncryptionMap[]
    }
  ) {
    this.cache = opts?.cache
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
    // Mirrors the encryption-map inflight dedupe (`globalInflightMaps`).
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

  private async fetchMap(key: MapCacheKey, scope?: EncryptionMapScope): Promise<EncryptionMapRecord | null> {
    // Bypass ORM lifecycle hooks to avoid recursive decrypt loops by querying directly.
    const target = resolveMapLookupTarget(scope, this.em)
    const conn = getSqlConnection(target.em)
    if (!conn) return null
    const sql = `
      select entity_id, fields_json
      from encryption_maps
      where entity_id = ?
        and tenant_id is not distinct from ?
        and organization_id is not distinct from ?
        and is_active = true
        and deleted_at is null
      limit 1
    `
    const params = [key.entityId, key.tenantId ?? null, key.organizationId ?? null]
    const rows = target.scoped
      ? await conn.execute(sql, params, 'all', target.ctx)
      : await conn.execute(sql, params)
    const row = Array.isArray(rows) && rows.length && rows[0] && typeof rows[0] === 'object'
      ? rows[0] as Record<string, unknown>
      : null
    if (!row) return null
    return {
      entityId: String(row.entity_id ?? row.entityId ?? key.entityId),
      fields: readEncryptedFieldsJson(row),
    }
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

  private async getMap(key: MapCacheKey, scope?: EncryptionMapScope): Promise<EncryptionMapRecord | null> {
    const candidates: MapCacheKey[] = [
      key,
      { entityId: key.entityId, tenantId: key.tenantId ?? null, organizationId: null },
      { entityId: key.entityId, tenantId: null, organizationId: null },
    ]
    // Inside a transaction the lookup joins the caller's connection and skips
    // every shared cache (issue #6301): a snapshot read must neither join a
    // pending read started outside the transaction (pool deadlock) nor publish
    // its snapshot — or a miss — into the process-wide caches (stale reads,
    // skipped encryption of newly protected fields).
    if (resolveMapLookupTarget(scope, this.em).scoped) {
      for (const candidate of candidates) {
        const loaded = await this.fetchMap(candidate, scope)
        if (loaded) return this.applySystemDefault(loaded, key.entityId)
      }
      return this.applySystemDefault(null, key.entityId)
    }
    const shouldSkipLookup = (tag: string) => {
      const expiresAt = this.missCache.get(tag)
      if (!expiresAt) return false
      if (expiresAt > Date.now()) return true
      this.missCache.delete(tag)
      return false
    }
    const recordMiss = (tag: string) => {
      this.missCache.set(tag, Date.now() + MAP_MISS_TTL_MS)
    }

    for (const candidate of candidates) {
      const tag = cacheKey(candidate)
      if (shouldSkipLookup(tag)) continue
      if (this.inflightMaps.has(tag)) {
        const pending = this.inflightMaps.get(tag)!
        const resolved = await pending
        if (resolved) return this.applySystemDefault(resolved, key.entityId)
      }
      const mem = this.memoryCache.get(tag)
      if (mem) return this.applySystemDefault(mem, key.entityId)
      if (this.cache && typeof this.cache.get === 'function') {
        const cached = await this.cache.get(tag)
        if (cached) return this.applySystemDefault(cached as EncryptionMapRecord, key.entityId)
      }
      const pending = this.fetchMap(candidate, scope)
      this.inflightMaps.set(tag, pending)
      const loaded = await pending
      this.inflightMaps.delete(tag)
      if (!loaded) {
        recordMiss(tag)
        debug('🔍 encmap.miss', {
          entityId: candidate.entityId,
          tenantId: candidate.tenantId,
          organizationId: candidate.organizationId,
        })
        continue
      }
      this.missCache.delete(tag)
      this.memoryCache.set(tag, loaded)
      if (this.cache && typeof this.cache.set === 'function') {
        await this.cache.set(tag, loaded, { ttl: 300 })
      }
      return this.applySystemDefault(loaded, key.entityId)
    }
    return this.applySystemDefault(null, key.entityId)
  }

  private async fetchAllOrganizationFieldRules(
    entityId: string,
    tenantId: string | null,
    scope?: EncryptionMapScope,
  ): Promise<EncryptedFieldRule[]> {
    const target = resolveMapLookupTarget(scope, this.em)
    const conn = getSqlConnection(target.em)
    if (!conn) return []
    const sql = `
      select fields_json
      from encryption_maps
      where entity_id = ?
        and tenant_id is not distinct from ?
        and organization_id is not null
        and is_active = true
        and deleted_at is null
    `
    const params = [entityId, tenantId]
    const rows = target.scoped
      ? await conn.execute(sql, params, 'all', target.ctx)
      : await conn.execute(sql, params)
    if (!Array.isArray(rows) || rows.length === 0) return []
    const groups: EncryptedFieldRule[][] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      groups.push(normalizeEncryptedFieldRules(readEncryptedFieldsJson(row as Record<string, unknown>)))
    }
    return mergeEncryptedFieldRules(groups)
  }

  /**
   * Cached aggregate of every organization-scoped map for an entity/tenant. `encryptEntityPayload`
   * and `decryptEntityPayload` consult it on every row at the tenant-wide scope, so the uncached
   * read this used to be would add a round-trip per flush and per load (#5949).
   */
  private async getAllOrganizationFieldRules(
    entityId: string,
    tenantId: string | null,
    scope?: EncryptionMapScope,
  ): Promise<EncryptedFieldRule[]> {
    // Same no-shared-cache rule as `getMap`: a snapshot read inside a
    // transaction must neither join a pending aggregate read started outside
    // it nor publish its snapshot into the process-wide caches (issue #6301).
    if (resolveMapLookupTarget(scope, this.em).scoped) {
      return this.fetchAllOrganizationFieldRules(entityId, tenantId, scope)
    }
    const tag = allOrganizationsCacheKey(entityId, tenantId)
    const missExpiresAt = this.missCache.get(tag)
    if (missExpiresAt) {
      if (missExpiresAt > Date.now()) return []
      this.missCache.delete(tag)
    }
    const mem = this.aggregateMemoryCache.get(tag)
    if (mem) {
      if (mem.at + AGGREGATE_CACHE_TTL_MS > Date.now()) return mem.record.fields
      this.aggregateMemoryCache.delete(tag)
    }
    if (this.cache && typeof this.cache.get === 'function') {
      const cached = await this.cache.get(tag)
      if (cached) {
        const record = cached as EncryptionMapRecord
        this.aggregateMemoryCache.set(tag, { at: Date.now(), record })
        return record.fields
      }
    }
    const inflight = this.inflightMaps.get(tag)
    if (inflight) return (await inflight)?.fields ?? []
    const pending = (async (): Promise<EncryptionMapRecord | null> => {
      const fields = await this.fetchAllOrganizationFieldRules(entityId, tenantId, scope)
      return fields.length ? { entityId, fields } : null
    })()
    this.inflightMaps.set(tag, pending)
    let loaded: EncryptionMapRecord | null
    try {
      loaded = await pending
    } finally {
      this.inflightMaps.delete(tag)
    }
    if (!loaded) {
      this.missCache.set(tag, Date.now() + MAP_MISS_TTL_MS)
      return []
    }
    this.missCache.delete(tag)
    this.aggregateMemoryCache.set(tag, { at: Date.now(), record: loaded })
    if (this.cache && typeof this.cache.set === 'function') {
      await this.cache.set(tag, loaded, { ttl: 300 })
    }
    return loaded.fields
  }

  /**
   * The field rules that are actually encrypted at rest for a scope.
   *
   * At the tenant-wide scope (`organizationId == null`) `getMap` resolves only the base map, but
   * rows of the same entity may carry fields declared solely by an organization-scoped map. Reading
   * or writing such a row with the base map alone stores those fields as plaintext and hands
   * callers back undecrypted ciphertext, so every scope-aware path unions the organization maps in
   * (#5949) — the same set `getEncryptedFieldNames` has reported since #2282.
   */
  private async resolveFieldRulesForScope(
    entityId: string,
    tenantId: string | null,
    organizationId: string | null,
    map: EncryptionMapRecord | null,
    scope?: EncryptionMapScope,
  ): Promise<EncryptedFieldRule[]> {
    const mapRules = normalizeEncryptedFieldRules(map?.fields)
    if (organizationId != null) return mapRules
    return mergeEncryptedFieldRules([mapRules, await this.getAllOrganizationFieldRules(entityId, tenantId, scope)])
  }

  async invalidateMap(entityId: string, tenantId: string | null, organizationId: string | null): Promise<void> {
    const tags = [cacheKey({ entityId, tenantId, organizationId }), allOrganizationsCacheKey(entityId, tenantId)]
    for (const tag of tags) {
      this.memoryCache.delete(tag)
      this.aggregateMemoryCache.delete(tag)
      this.inflightMaps.delete(tag)
      this.missCache.delete(tag)
      if (this.cache && typeof (this.cache as any).delete === 'function') {
        await (this.cache as any).delete(tag)
      }
    }
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
    options?: { ignoreRuntimeHealth?: boolean; em?: EncryptionMapScope['em'] }
  ): Promise<string[]> {
    if (options?.ignoreRuntimeHealth) {
      if (!isTenantDataEncryptionEnabled()) return []
    } else if (!this.isEnabled()) {
      return []
    }
    const scope = options?.em ? { em: options.em } : undefined
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null }, scope)
    const fields = await this.resolveFieldRulesForScope(
      entityId,
      tenantId ?? null,
      organizationId ?? null,
      map,
      scope,
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
    options?: { createMissingDek?: boolean; em?: EncryptionMapScope['em'] }
  ): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      debug('⚪️ encrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const scope = options?.em ? { em: options.em } : undefined
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null }, scope)
    const fields = await this.resolveFieldRulesForScope(
      entityId,
      tenantId ?? null,
      organizationId ?? null,
      map,
      scope,
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
    options?: { em?: EncryptionMapScope['em'] }
  ): Promise<Record<string, unknown>> {
    if (!isTenantDataEncryptionEnabled()) {
      debug('⚪️ decrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const scope = options?.em ? { em: options.em } : undefined
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null }, scope)
    const fields = await this.resolveFieldRulesForScope(
      entityId,
      tenantId ?? null,
      organizationId ?? null,
      map,
      scope,
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
