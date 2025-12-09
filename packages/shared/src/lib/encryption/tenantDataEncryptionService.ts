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
    console.debug('[tenant-encryption]', event, payload)
  } catch {
    // ignore
  }
}

export class TenantDataEncryptionService {
  private readonly kms: KmsService
  private readonly cache?: CacheStrategy
  private readonly memoryCache = new Map<string, EncryptionMapRecord>()
  private readonly dekCache = new Map<string, TenantDek>()

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
    const repo = this.em.getRepository(EncryptionMap)
    const record = await repo.findOne(
      { entityId: key.entityId, tenantId: key.tenantId ?? null, organizationId: key.organizationId ?? null, isActive: true, deletedAt: null },
    )
    if (!record) return null
    return {
      entityId: record.entityId,
      fields: Array.isArray(record.fieldsJson)
        ? (record.fieldsJson as EncryptedFieldRule[])
        : [],
    }
  }

  private async getMap(key: MapCacheKey): Promise<EncryptionMapRecord | null> {
    const tag = cacheKey(key)
    if (this.cache && typeof this.cache.get === 'function') {
      const cached = await this.cache.get(tag)
      if (cached) return cached as EncryptionMapRecord
    }
    const mem = this.memoryCache.get(tag)
    if (mem) return mem
    const loaded = await this.fetchMap(key)
    if (loaded) {
      this.memoryCache.set(tag, loaded)
      if (this.cache && typeof this.cache.set === 'function') {
        await this.cache.set(tag, loaded, { ttl: 300 })
      }
    }
    return loaded
  }

  async invalidateMap(entityId: string, tenantId: string | null, organizationId: string | null): Promise<void> {
    const tag = cacheKey({ entityId, tenantId, organizationId })
    this.memoryCache.delete(tag)
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
      const key = rule.field
      if (!Object.prototype.hasOwnProperty.call(clone, key)) continue
      const value = clone[key]
      if (value === null || value === undefined) continue
      const serialized = typeof value === 'string' ? value : JSON.stringify(value)
      const payload = encryptWithAesGcm(serialized, dek.key)
      clone[key] = payload.value
      if (rule.hashField) {
        clone[rule.hashField] = hashForLookup(serialized)
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
    for (const rule of fields) {
      const key = rule.field
      if (!Object.prototype.hasOwnProperty.call(clone, key)) continue
      const value = clone[key]
      if (typeof value !== 'string') continue
      const decrypted = decryptWithAesGcm(value, dek.key)
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
    if (!this.isEnabled()) {
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
