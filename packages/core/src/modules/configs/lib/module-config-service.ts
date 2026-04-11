import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ModuleConfig } from '../data/entities'
import { moduleConfigKeySchema } from '../data/validators'

const CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 60_000

type CachePayload = {
  found: boolean
  record?: ModuleConfigRecord | null
}

const cacheKey = (moduleId: string, name: string, organizationId?: string | null) =>
  organizationId
    ? `module-config:${CACHE_VERSION}:${moduleId}:${name}:org:${organizationId}`
    : `module-config:${CACHE_VERSION}:${moduleId}:${name}`
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

const toRecord = (entity: ModuleConfig): ModuleConfigRecord => ({
  moduleId: entity.moduleId,
  name: entity.name,
  value: entity.valueJson ?? null,
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

export type ModuleConfigRecord = {
  moduleId: string
  name: string
  value: unknown
  createdAt: string
  updatedAt: string
}

export type ModuleConfigDefault = {
  moduleId: string
  name: string
  value: unknown
}

export type ModuleConfigContext = {
  organizationId?: string | null
}

export type ModuleConfigService = {
  getRecord(moduleId: string, name: string, context?: ModuleConfigContext): Promise<ModuleConfigRecord | null>
  getValue<T = unknown>(moduleId: string, name: string, options?: { defaultValue?: T | null; context?: ModuleConfigContext }): Promise<T | null>
  setValue(moduleId: string, name: string, value: unknown, context?: ModuleConfigContext): Promise<ModuleConfigRecord | null>
  restoreDefaults(defaults: ModuleConfigDefault[], options?: { force?: boolean; context?: ModuleConfigContext }): Promise<void>
  invalidate(moduleId: string, name?: string, context?: ModuleConfigContext): Promise<void>
}

export function createModuleConfigService(container: AppContainer): ModuleConfigService {
  const getRecord = async (rawModuleId: string, rawName: string, context?: ModuleConfigContext): Promise<ModuleConfigRecord | null> => {
    const { moduleId, name } = normalizeKey(rawModuleId, rawName)
    const organizationId = context?.organizationId ?? null
    const cache = resolveCache(container)
    const key = cacheKey(moduleId, name, organizationId)
    const cached = await readCache(cache, key)
    if (cached) {
      if (!cached.found) return null
      if (cached.record) return cached.record
    }

    const em = resolveEm(container)
    if (!em) return null
    const repo = em.getRepository(ModuleConfig)
    const filter = organizationId ? { moduleId, name, organizationId } : { moduleId, name, organizationId: null }
    const entity = await repo.findOne(filter)
    if (!entity) {
      await writeCache(cache, key, { found: false }, moduleId)
      return null
    }
    const record = toRecord(entity)
    await writeCache(cache, key, { found: true, record }, moduleId)
    return record
  }

  const getValue = async <T>(rawModuleId: string, rawName: string, options?: { defaultValue?: T | null; context?: ModuleConfigContext }): Promise<T | null> => {
    const record = await getRecord(rawModuleId, rawName, options?.context)
    if (!record) return options?.defaultValue ?? null
    const value = record.value as T | null | undefined
    if (value === undefined || value === null) return options?.defaultValue ?? null
    return value
  }

  const setValue = async (rawModuleId: string, rawName: string, value: unknown, context?: ModuleConfigContext): Promise<ModuleConfigRecord | null> => {
    const em = resolveEm(container)
    if (!em) return null
    const { moduleId, name } = normalizeKey(rawModuleId, rawName)
    const organizationId = context?.organizationId ?? null
    const repo = em.getRepository(ModuleConfig)
    const now = new Date()
    const filter = organizationId ? { moduleId, name, organizationId } : { moduleId, name, organizationId: null }
    let entity = await repo.findOne(filter)
    if (!entity) {
      entity = repo.create({
        moduleId,
        name,
        organizationId,
        valueJson: value ?? null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(entity)
    } else {
      entity.valueJson = value ?? null
      entity.updatedAt = now
    }
    await em.flush()
    const record = toRecord(entity)
    await writeCache(resolveCache(container), cacheKey(moduleId, name, organizationId), { found: true, record }, moduleId)
    return record
  }

  const restoreDefaults = async (defaults: ModuleConfigDefault[], options?: { force?: boolean; context?: ModuleConfigContext }) => {
    if (!Array.isArray(defaults) || defaults.length === 0) return
    const em = resolveEm(container)
    if (!em) return
    const repo = em.getRepository(ModuleConfig)
    const cache = resolveCache(container)
    const organizationId = options?.context?.organizationId ?? null
    let dirty = false
    const touched: ModuleConfig[] = []
    for (const entry of defaults) {
      let entity: ModuleConfig | null = null
      try {
        const { moduleId, name } = normalizeKey(entry.moduleId, entry.name)
        const filter = organizationId ? { moduleId, name, organizationId } : { moduleId, name, organizationId: null }
        entity = await repo.findOne(filter)
        if (!entity) {
          entity = repo.create({
            moduleId,
            name,
            organizationId,
            valueJson: entry.value ?? null,
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
      const record = toRecord(entity)
      await writeCache(cache, cacheKey(entity.moduleId, entity.name, entity.organizationId), { found: true, record }, entity.moduleId)
    }
  }

  const invalidate = async (rawModuleId: string, rawName?: string, context?: ModuleConfigContext) => {
    const cache = resolveCache(container)
    if (!cache) return
    const organizationId = context?.organizationId ?? null
    if (rawName) {
      const { moduleId, name } = normalizeKey(rawModuleId, rawName)
      await deleteCacheKey(cache, cacheKey(moduleId, name, organizationId))
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

