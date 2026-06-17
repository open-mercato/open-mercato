import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ModuleConfig } from '../data/entities'
import { moduleConfigKeySchema } from '../data/validators'

const CACHE_VERSION = 'v2'
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

const readCache = async (cache: CacheStrategy | null, key: string): Promise<CachePayload | null> => {
  if (!cache) return null
  try {
    const cached = await cache.get(key)
    if (cached && typeof cached === 'object' && 'found' in cached) {
      return cached as CachePayload
    }
  } catch {}
  return null
}

const writeCache = async (cache: CacheStrategy | null, key: string, payload: CachePayload, moduleId: string) => {
  if (!cache) return
  try {
    await cache.set(key, payload, { ttl: CACHE_TTL_MS, tags: [moduleTag(moduleId)] })
  } catch {}
}

const deleteCacheKey = async (cache: CacheStrategy | null, key: string) => {
  if (!cache) return
  try {
    await cache.delete(key)
  } catch {}
}

const deleteCacheByModule = async (cache: CacheStrategy | null, moduleId: string) => {
  if (!cache) return
  try {
    await cache.deleteByTags([moduleTag(moduleId)])
  } catch {}
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
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: ConfigScope },
  ): Promise<T | null>
  setValue(moduleId: string, name: string, value: unknown, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
  restoreDefaults(defaults: ModuleConfigDefault[], options?: { force?: boolean }): Promise<void>
  invalidate(moduleId: string, name?: string, scope?: ConfigScope): Promise<void>
}

export function createModuleConfigService(container: AppContainer): ModuleConfigService {
  const getRecord = async (rawModuleId: string, rawName: string, scope?: ConfigScope): Promise<ModuleConfigRecord | null> => {
    const { moduleId, name } = normalizeKey(rawModuleId, rawName)
    const tenantId = scope?.tenantId ?? null
    const cache = resolveCache(container)
    const key = cacheKey(moduleId, name, tenantId)
    const cached = await readCache(cache, key)
    if (cached) {
      if (!cached.found) return null
      if (cached.record) return cached.record
    }

    const em = resolveEm(container)
    if (!em) return null
    const repo = em.getRepository(ModuleConfig)

    if (tenantId) {
      const scoped = await repo.findOne({ moduleId, name, tenantId })
      if (scoped) {
        const record = toRecord(scoped, 'tenant')
        await writeCache(cache, key, { found: true, record }, moduleId)
        return record
      }
      const global = await repo.findOne({ moduleId, name, tenantId: null })
      if (!global) {
        await writeCache(cache, key, { found: false }, moduleId)
        return null
      }
      const record = toRecord(global, 'instance')
      await writeCache(cache, key, { found: true, record }, moduleId)
      return record
    }

    const global = await repo.findOne({ moduleId, name, tenantId: null })
    if (!global) {
      await writeCache(cache, key, { found: false }, moduleId)
      return null
    }
    const record = toRecord(global, 'instance')
    await writeCache(cache, key, { found: true, record }, moduleId)
    return record
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
    if (tenantId) {
      await writeCache(cache, cacheKey(moduleId, name, tenantId), { found: true, record }, moduleId)
    } else {
      await deleteCacheByModule(cache, moduleId)
    }
    return record
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
      await writeCache(cache, cacheKey(entity.moduleId, entity.name, null), { found: true, record }, entity.moduleId)
    }
  }

  const invalidate = async (rawModuleId: string, rawName?: string, scope?: ConfigScope) => {
    const cache = resolveCache(container)
    if (!cache) return
    if (rawName) {
      const { moduleId, name } = normalizeKey(rawModuleId, rawName)
      await deleteCacheKey(cache, cacheKey(moduleId, name, scope?.tenantId ?? null))
      return
    }
    const moduleId = moduleConfigKeySchema.shape.moduleId.parse(rawModuleId)
    await deleteCacheByModule(cache, moduleId)
  }

  return {
    getRecord,
    getValue,
    setValue,
    restoreDefaults,
    invalidate,
  }
}
