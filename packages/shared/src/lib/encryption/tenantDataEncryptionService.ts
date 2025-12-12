import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { decryptWithAesGcm, encryptWithAesGcm, hashForLookup } from './aes'
import { createKmsService, type KmsService, type TenantDek } from './kms'
import { isTenantDataEncryptionEnabled, isEncryptionDebugEnabled } from './toggles'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'

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
    // eslint-disable-next-line no-console
    console.debug(`${event} [tenant-encryption]`, payload)
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

function isEncryptedPayload(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 4 && parts[3] === 'v1'
}

export class TenantDataEncryptionService {
  private static globalMemoryCache = new Map<string, EncryptionMapRecord>()
  private static globalInflightMaps = new Map<string, Promise<EncryptionMapRecord | null>>()
  private static globalDekCache = new Map<string, TenantDek>()
  private readonly kms: KmsService
  private readonly cache?: CacheStrategy
  private readonly memoryCache = TenantDataEncryptionService.globalMemoryCache
  private readonly dekCache = TenantDataEncryptionService.globalDekCache
  private readonly inflightMaps = TenantDataEncryptionService.globalInflightMaps

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

  async getDek(tenantId: string | null | undefined): Promise<TenantDek | null> {
    if (!tenantId) return null
    const cached = this.dekCache.get(tenantId)
    if (cached) return cached
    const dek = await this.kms.getTenantDek(tenantId)
    if (!dek) {
      debug('🔎 dek.miss', { tenantId })
    } else {
      debug('✅ dek.hit', { tenantId })
    }
    if (dek) this.dekCache.set(tenantId, dek)
    return dek
  }

  async createDek(tenantId: string): Promise<TenantDek | null> {
    const dek = await this.kms.createTenantDek(tenantId)
    if (dek) this.dekCache.set(tenantId, dek)
    return dek
  }

  private async fetchMap(key: MapCacheKey): Promise<EncryptionMapRecord | null> {
    // Bypass ORM lifecycle hooks to avoid recursive decrypt loops by querying directly.
    const conn: any = (this.em as any)?.getConnection?.()
    if (!conn || typeof conn.execute !== 'function') return null
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
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    if (!row) return null
    return {
      entityId: row.entity_id || row.entityId || key.entityId,
      fields: Array.isArray(row.fields_json)
        ? (row.fields_json as EncryptedFieldRule[])
        : Array.isArray(row.fieldsJson)
          ? (row.fieldsJson as EncryptedFieldRule[])
          : [],
    }
  }

  private async getMap(key: MapCacheKey): Promise<EncryptionMapRecord | null> {
    const candidates: MapCacheKey[] = [
      key,
      { entityId: key.entityId, tenantId: key.tenantId ?? null, organizationId: null },
      { entityId: key.entityId, tenantId: null, organizationId: null },
    ]
    for (const candidate of candidates) {
      const tag = cacheKey(candidate)
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
      if (!loaded) continue
      this.memoryCache.set(tag, loaded)
      if (this.cache && typeof this.cache.set === 'function') {
        await this.cache.set(tag, loaded, { ttl: 300 })
      }
      return loaded
    }
    return null
  }

  async invalidateMap(entityId: string, tenantId: string | null, organizationId: string | null): Promise<void> {
    const tag = cacheKey({ entityId, tenantId, organizationId })
    this.memoryCache.delete(tag)
    this.inflightMaps.delete(tag)
    if (this.cache && typeof (this.cache as any).delete === 'function') {
      await (this.cache as any).delete(tag)
    }
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
       // Avoid double-encrypting already encrypted payloads
      if (isEncryptedPayload(value)) continue
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
      try {
        clone[key] = JSON.parse(decrypted)
      } catch {
        clone[key] = decrypted
      }
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
    const dek = await this.getDek(tenantId ?? null)
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
