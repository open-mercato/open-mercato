import { raw, type EntityManager } from '@mikro-orm/postgresql'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ModuleConfig } from '../data/entities'
import { moduleConfigKeySchema } from '../data/validators'

const CACHE_VERSION = 'v3'
const CACHE_TTL_MS = 60_000

type CachePayload = {
  found: boolean
  record?: ModuleConfigRecord | null
}

const scopeKeyPart = (tenantId?: string | null) => (tenantId ?? 'global')

const cacheKey = (moduleId: string, name: string, tenantId?: string | null) =>
  `module-config:${CACHE_VERSION}:${moduleId}:${name}:${scopeKeyPart(tenantId)}`
const moduleTag = (moduleId: string) => `module-config:module:${moduleId}`

const resolveEm = (container: AppContainer): EntityManager | null => {
  try {
    return (container.resolve('em') as EntityManager)
  } catch {
    return null
  }
}

const resolveCache = (container: AppContainer): CacheStrategy | null => {
  try {
    return (container.resolve('cache') as CacheStrategy)
  } catch {
    return null
  }
}

const toRecord = (entity: ModuleConfig, source: ModuleConfigSource): ModuleConfigRecord => ({
  moduleId: entity.moduleId,
  name: entity.name,
  value: entity.valueJson ?? null,
  tenantId: entity.tenantId ?? null,
  organizationId: entity.organizationId ?? null,
  source,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
})

const readCache = async (
  cache: CacheStrategy | null,
  key: string,
  tenantId: string | null,
): Promise<CachePayload | null> => {
  if (!cache) return null
  try {
    const cached = await runWithCacheTenant(tenantId, () => cache.get(key))
    if (cached && typeof cached === 'object' && 'found' in cached) {
      return cached as CachePayload
    }
  } catch {}
  return null
}

const writeCache = async (
  cache: CacheStrategy | null,
  key: string,
  payload: CachePayload,
  moduleId: string,
  tenantId: string | null,
) => {
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () =>
      cache.set(key, payload, { ttl: CACHE_TTL_MS, tags: [moduleTag(moduleId)] }),
    )
  } catch {}
}

const deleteCacheKey = async (cache: CacheStrategy | null, key: string, tenantId: string | null) => {
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () => cache.delete(key))
  } catch {}
}

const deleteCacheByModule = async (cache: CacheStrategy | null, moduleId: string, tenantIds: Array<string | null>) => {
  if (!cache) return
  const scopes = Array.from(new Set(tenantIds))
  for (const tenantId of scopes) {
    try {
      await runWithCacheTenant(tenantId, () => cache.deleteByTags([moduleTag(moduleId)]))
    } catch {}
  }
}

const normalizeKey = (moduleId: string, name: string) => moduleConfigKeySchema.parse({ moduleId, name })

export type ModuleConfigSource = 'tenant' | 'instance'

export type ConfigScope = {
  tenantId?: string | null
  organizationId?: string | null
}

export type ModuleConfigRecord = {
  moduleId: string
  name: string
  value: unknown
  tenantId: string | null
  organizationId: string | null
  source: ModuleConfigSource
  createdAt: string
  updatedAt: string
}

export type ModuleConfigDefault = {
  moduleId: string
  name: string
  value: unknown
}

export type ModuleConfigService = {
  getRecord(moduleId: string, name: string, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
  /**
   * Batched `getRecord`, one call per name instead of one call to `getRecord`
   * per name: a cold-cache caller reading N names pays at most two SELECTs
   * (tenant scope, then the global fallback) instead of up to 2N. Optional so
   * a `ModuleConfigService` that only implements the original contract (a
   * test double, or an older override) keeps working through the `getRecord`
   * fallback its caller already has.
   */
  getRecords?(
    moduleId: string,
    names: readonly string[],
    scope?: ConfigScope,
  ): Promise<Record<string, ModuleConfigRecord | null>>
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: ConfigScope },
  ): Promise<T | null>
  setValue(moduleId: string, name: string, value: unknown, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
  setTenantValues?(moduleId: string, values: Readonly<Record<string, unknown>>, tenantId: string): Promise<void>
  restoreDefaults(defaults: ModuleConfigDefault[], options?: { force?: boolean }): Promise<void>
  invalidate(moduleId: string, name?: string, scope?: ConfigScope): Promise<void>
}

export function createModuleConfigService(container: AppContainer): ModuleConfigService {
  const loadRow = async (
    cache: CacheStrategy | null,
    moduleId: string,
    name: string,
    tenantId: string | null,
  ): Promise<ModuleConfigRecord | null> => {
    const key = cacheKey(moduleId, name, tenantId)
    const cached = await readCache(cache, key, tenantId)
    if (cached) {
      if (!cached.found) return null
      if (cached.record) return cached.record
    }
    const em = resolveEm(container)
    if (!em) return null
    const entity = await em.getRepository(ModuleConfig).findOne({ moduleId, name, tenantId }, { refresh: true })
    if (!entity) {
      await writeCache(cache, key, { found: false }, moduleId, tenantId)
      return null
    }
    const record = toRecord(entity, tenantId ? 'tenant' : 'instance')
    await writeCache(cache, key, { found: true, record }, moduleId, tenantId)
    return record
  }

  const getRecord = async (rawModuleId: string, rawName: string, scope?: ConfigScope): Promise<ModuleConfigRecord | null> => {
    const { moduleId, name } = normalizeKey(rawModuleId, rawName)
    const tenantId = scope?.tenantId ?? null
    const cache = resolveCache(container)
    if (tenantId) {
      const scoped = await loadRow(cache, moduleId, name, tenantId)
      if (scoped) return scoped
    }
    return loadRow(cache, moduleId, name, null)
  }

  const loadRows = async (
    cache: CacheStrategy | null,
    moduleId: string,
    names: string[],
    tenantId: string | null,
  ): Promise<Map<string, ModuleConfigRecord | null>> => {
    const resolved = new Map<string, ModuleConfigRecord | null>()
    const missing: string[] = []
    for (const name of names) {
      const key = cacheKey(moduleId, name, tenantId)
      const cached = await readCache(cache, key, tenantId)
      if (cached) resolved.set(name, cached.found ? cached.record ?? null : null)
      else missing.push(name)
    }
    if (missing.length === 0) return resolved

    const em = resolveEm(container)
    if (!em) {
      for (const name of missing) resolved.set(name, null)
      return resolved
    }
    const rows = await em.getRepository(ModuleConfig).find({ moduleId, name: { $in: missing }, tenantId })
    const byName = new Map(rows.map((row) => [row.name, row]))
    for (const name of missing) {
      const key = cacheKey(moduleId, name, tenantId)
      const entity = byName.get(name)
      if (!entity) {
        await writeCache(cache, key, { found: false }, moduleId, tenantId)
        resolved.set(name, null)
      } else {
        const record = toRecord(entity, tenantId ? 'tenant' : 'instance')
        await writeCache(cache, key, { found: true, record }, moduleId, tenantId)
        resolved.set(name, record)
      }
    }
    return resolved
  }

  const getRecords = async (
    rawModuleId: string,
    rawNames: readonly string[],
    scope?: ConfigScope,
  ): Promise<Record<string, ModuleConfigRecord | null>> => {
    if (rawNames.length === 0) return {}
    const normalized = rawNames.map((rawName) => ({ rawName, ...normalizeKey(rawModuleId, rawName) }))
    const moduleId = normalized[0].moduleId
    const names = normalized.map((entry) => entry.name)
    const tenantId = scope?.tenantId ?? null
    const cache = resolveCache(container)

    const byName: Record<string, ModuleConfigRecord | null> = {}
    let pending = names
    if (tenantId) {
      const tenantRows = await loadRows(cache, moduleId, names, tenantId)
      pending = []
      for (const name of names) {
        const row = tenantRows.get(name)
        if (row) byName[name] = row
        else pending.push(name)
      }
    }
    if (pending.length > 0) {
      const instanceRows = await loadRows(cache, moduleId, pending, null)
      for (const name of pending) byName[name] = instanceRows.get(name) ?? null
    }

    const output: Record<string, ModuleConfigRecord | null> = {}
    for (const entry of normalized) output[entry.rawName] = byName[entry.name] ?? null
    return output
  }

  const getValue = async <T>(
    rawModuleId: string,
    rawName: string,
    options?: { defaultValue?: T | null; scope?: ConfigScope },
  ): Promise<T | null> => {
    const record = await getRecord(rawModuleId, rawName, options?.scope)
    if (!record) return options?.defaultValue ?? null
    const value = record.value as T | null | undefined
    if (value === undefined || value === null) return options?.defaultValue ?? null
    return value
  }

  const setValue = async (
    rawModuleId: string,
    rawName: string,
    value: unknown,
    scope?: ConfigScope,
  ): Promise<ModuleConfigRecord | null> => {
    const em = resolveEm(container)
    if (!em) return null
    const { moduleId, name } = normalizeKey(rawModuleId, rawName)
    const tenantId = scope?.tenantId ?? null
    const organizationId = scope?.organizationId ?? null
    const repo = em.getRepository(ModuleConfig)
    const now = new Date()
    let entity = await repo.findOne({ moduleId, name, tenantId })
    if (!entity) {
      entity = repo.create({
        moduleId,
        name,
        valueJson: value ?? null,
        tenantId,
        organizationId,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(entity)
    } else {
      entity.valueJson = value ?? null
      entity.organizationId = organizationId
      entity.updatedAt = now
    }
    await em.flush()
    const record = toRecord(entity, tenantId ? 'tenant' : 'instance')
    const cache = resolveCache(container)
    await writeCache(cache, cacheKey(moduleId, name, tenantId), { found: true, record }, moduleId, tenantId)
    return record
  }

  /**
   * Detached from the request's own transaction/connection (`useContext: false`,
   * `disableContextResolution: true`): the batch upsert commits on its own connection
   * instead of sharing one with whatever else the request's `em` is mid-transaction on,
   * so it cannot deadlock against that connection and is not rolled back with it.
   */
  const setTenantValues = async (
    rawModuleId: string,
    values: Readonly<Record<string, unknown>>,
    tenantId: string,
  ): Promise<void> => {
    const em = resolveEm(container)
    if (!em) throw new Error('[internal] Module config persistence is unavailable')
    const now = new Date()
    const entries = Object.entries(values)
      .map(([rawName, value]) => {
        const { moduleId, name } = normalizeKey(rawModuleId, rawName)
        return { moduleId, name, tenantId, organizationId: null, valueJson: value ?? null, createdAt: now, updatedAt: now }
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    if (entries.length === 0) return

    await em.fork({ useContext: false, disableContextResolution: true })
      .createQueryBuilder(ModuleConfig)
      .insert(entries)
      .onConflict(raw('("module_id", "name", "tenant_id") where "tenant_id" is not null'))
      .merge(['valueJson', 'organizationId', 'updatedAt'])
      .execute('run')

    const cache = resolveCache(container)
    await Promise.all(entries.map(({ moduleId, name }) => deleteCacheKey(cache, cacheKey(moduleId, name, tenantId), tenantId)))
  }

  const restoreDefaults = async (defaults: ModuleConfigDefault[], options?: { force?: boolean }) => {
    if (!Array.isArray(defaults) || defaults.length === 0) return
    const em = resolveEm(container)
    if (!em) return
    const repo = em.getRepository(ModuleConfig)
    const cache = resolveCache(container)
    let dirty = false
    const touched: ModuleConfig[] = []
    for (const entry of defaults) {
      let entity: ModuleConfig | null = null
      try {
        const { moduleId, name } = normalizeKey(entry.moduleId, entry.name)
        entity = await repo.findOne({ moduleId, name, tenantId: null })
        if (!entity) {
          entity = repo.create({
            moduleId,
            name,
            valueJson: entry.value ?? null,
            tenantId: null,
            organizationId: null,
          })
          em.persist(entity)
          dirty = true
          touched.push(entity)
        } else if (options?.force) {
          entity.valueJson = entry.value ?? null
          entity.updatedAt = new Date()
          dirty = true
          touched.push(entity)
        }
      } catch {}
    }
    if (!dirty) return
    await em.flush()
    for (const entity of touched) {
      const record = toRecord(entity, 'instance')
      await writeCache(cache, cacheKey(entity.moduleId, entity.name, null), { found: true, record }, entity.moduleId, null)
    }
  }

  const invalidate = async (rawModuleId: string, rawName?: string, scope?: ConfigScope) => {
    const cache = resolveCache(container)
    if (!cache) return
    const tenantId = scope?.tenantId ?? null
    if (rawName) {
      const { moduleId, name } = normalizeKey(rawModuleId, rawName)
      if (tenantId) await deleteCacheKey(cache, cacheKey(moduleId, name, tenantId), tenantId)
      await deleteCacheKey(cache, cacheKey(moduleId, name, null), null)
      return
    }
    const moduleId = moduleConfigKeySchema.shape.moduleId.parse(rawModuleId)
    await deleteCacheByModule(cache, moduleId, [tenantId, getCurrentCacheTenant(), null])
  }

  return {
    getRecord,
    getRecords,
    getValue,
    setValue,
    setTenantValues,
    restoreDefaults,
    invalidate,
  }
}
