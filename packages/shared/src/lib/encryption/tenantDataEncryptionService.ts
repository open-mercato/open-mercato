import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { decryptWithAesGcm, encryptWithAesGcm, hashForLookup } from './aes'
import { createKmsService, type KmsService, type TenantDek } from './kms'
import { isTenantDataEncryptionEnabled, isEncryptionDebugEnabled } from './toggles'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'tenant-encryption' })

export type EncryptedFieldRule = {
  field: string
  hashField?: string | null
}

export type EncryptionMapRecord = {
  entityId: string
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

const MAP_MISS_TTL_MS = 5 * 60 * 1000
// Mirror the Vault KMS default DEK TTL so a rotated/revoked tenant key is picked
// up by long-lived processes without a restart (#2746). The service-level cache
// previously had no TTL and shadowed the KMS's own 15-minute expiry.
const DEK_CACHE_TTL_MS = 15 * 60 * 1000

function cacheKey(key: MapCacheKey): string {
  return [
    'encmap',
    key.entityId.toLowerCase(),
    key.tenantId ?? 'null',
    key.organizationId ?? 'null',
  ].join(':')
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

function normalizeEncryptedFieldNames(fields: readonly { field?: unknown }[] | null | undefined): string[] {
  if (!Array.isArray(fields)) return []
  return fields
    .map((rule) => rule.field)
    .filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
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

function getSqlConnection(em: EntityManager): SqlConnection | null {
  const source = em as { getConnection?: () => unknown }
  const conn = source.getConnection?.()
  if (!conn || typeof conn !== 'object') return null
  const candidate = conn as { execute?: unknown }
  if (typeof candidate.execute !== 'function') return null
  return candidate as SqlConnection
}

export class TenantDataEncryptionService {
  private static globalMemoryCache = new Map<string, EncryptionMapRecord>()
  private static globalInflightMaps = new Map<string, Promise<EncryptionMapRecord | null>>()
  private static globalDekCache = new Map<string, TenantDek>()
  private static globalInflightDeks = new Map<string, Promise<TenantDek | null>>()
  private static globalMissCache = new Map<string, number>()
  private readonly kms: KmsService
  private readonly cache?: CacheStrategy
  private readonly memoryCache = TenantDataEncryptionService.globalMemoryCache
  private readonly dekCache = TenantDataEncryptionService.globalDekCache
  private readonly inflightDeks = TenantDataEncryptionService.globalInflightDeks
  private readonly inflightMaps = TenantDataEncryptionService.globalInflightMaps
  private readonly missCache = TenantDataEncryptionService.globalMissCache

  constructor(
    private em: EntityManager,
    opts?: { cache?: CacheStrategy; kms?: KmsService }
  ) {
    this.cache = opts?.cache
    this.kms = opts?.kms ?? createKmsService()
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

  private async resolveDekForEncrypt(tenantId: string | null): Promise<TenantDek | null> {
    const existing = await this.getDek(tenantId)
    if (existing || !tenantId) return existing ?? null
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

  private async fetchMap(key: MapCacheKey): Promise<EncryptionMapRecord | null> {
    // Bypass ORM lifecycle hooks to avoid recursive decrypt loops by querying directly.
    const conn = getSqlConnection(this.em)
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
    const rows = await conn.execute(sql, [key.entityId, key.tenantId ?? null, key.organizationId ?? null])
    const row = Array.isArray(rows) && rows.length && rows[0] && typeof rows[0] === 'object'
      ? rows[0] as Record<string, unknown>
      : null
    if (!row) return null
    return {
      entityId: String(row.entity_id ?? row.entityId ?? key.entityId),
      fields: readEncryptedFieldsJson(row),
    }
  }

  private async getMap(key: MapCacheKey): Promise<EncryptionMapRecord | null> {
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

    const candidates: MapCacheKey[] = [
      key,
      { entityId: key.entityId, tenantId: key.tenantId ?? null, organizationId: null },
      { entityId: key.entityId, tenantId: null, organizationId: null },
    ]
    for (const candidate of candidates) {
      const tag = cacheKey(candidate)
      if (shouldSkipLookup(tag)) continue
      if (this.inflightMaps.has(tag)) {
        const pending = this.inflightMaps.get(tag)!
        const resolved = await pending
        if (resolved) return resolved
      }
      const mem = this.memoryCache.get(tag)
      if (mem) return mem
      if (this.cache && typeof this.cache.get === 'function') {
        const cached = await this.cache.get(tag)
        if (cached) return cached as EncryptionMapRecord
      }
      const pending = this.fetchMap(candidate)
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
      return loaded
    }
    return null
  }

  private async fetchAllOrganizationFieldNames(entityId: string, tenantId: string | null): Promise<string[]> {
    const conn = getSqlConnection(this.em)
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
    const rows = await conn.execute(sql, [entityId, tenantId])
    if (!Array.isArray(rows) || rows.length === 0) return []
    const names = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      for (const field of normalizeEncryptedFieldNames(readEncryptedFieldsJson(row as Record<string, unknown>))) {
        names.add(field)
      }
    }
    return Array.from(names)
  }

  async invalidateMap(entityId: string, tenantId: string | null, organizationId: string | null): Promise<void> {
    const tag = cacheKey({ entityId, tenantId, organizationId })
    this.memoryCache.delete(tag)
    this.inflightMaps.delete(tag)
    this.missCache.delete(tag)
    if (this.cache && typeof (this.cache as any).delete === 'function') {
      await (this.cache as any).delete(tag)
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

  async getEncryptedFieldNames(
    entityId: string,
    tenantId: string | null | undefined,
    organizationId?: string | null
  ): Promise<string[]> {
    if (!this.isEnabled()) return []
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null })
    const fields = new Set(normalizeEncryptedFieldNames(map?.fields))
    if (organizationId == null) {
      for (const field of await this.fetchAllOrganizationFieldNames(entityId, tenantId ?? null)) {
        fields.add(field)
      }
    }
    return Array.from(fields)
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

  async encryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null
  ): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      debug('⚪️ encrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const dek = await this.resolveDekForEncrypt(tenantId ?? null)
    if (!dek) {
      debug('⚠️ encrypt.skip.no-dek', { entityId, tenantId })
      return payload
    }
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null })
    if (!map || !map.fields?.length) {
      debug('⚪️ encrypt.skip.no-map', { entityId, tenantId })
      return payload
    }
    debug('🔒 encrypt_entity', { entityId, tenantId, organizationId, fields: map.fields.length })
    return this.encryptFields(payload, map.fields, dek)
  }

  async decryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null
  ): Promise<Record<string, unknown>> {
    if (!isTenantDataEncryptionEnabled()) {
      debug('⚪️ decrypt.skip.disabled', { entityId, tenantId })
      return payload
    }
    const dek = await this.getDek(tenantId ?? null)
    if (!dek) {
      debug('⚠️ decrypt.skip.no-dek', { entityId, tenantId })
      return payload
    }
    const map = await this.getMap({ entityId, tenantId: tenantId ?? null, organizationId: organizationId ?? null })
    if (!map || !map.fields?.length) {
      debug('⚪️ decrypt.skip.no-map', { entityId, tenantId })
      return payload
    }
    debug('🔓 decrypt_entity', { entityId, tenantId, organizationId, fields: map.fields.length })
    return this.decryptFields(payload, map.fields, dek)
  }
}
