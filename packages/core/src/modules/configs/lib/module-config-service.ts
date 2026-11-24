import type { EntityManager } from '@mikro-orm/postgresql'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'
import { ModuleConfig } from '../data/entities'
import { moduleConfigKeySchema } from '../data/validators'
import { compareConfigKeys, validateAndCloneFiniteJsonValue } from './instance-defaults'

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

export type RestoreDefaultsStrictOptions = {
  force?: boolean
  maxConflictRetries?: number
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
  restoreDefaultsStrict?(
    defaults: readonly ModuleConfigDefault[],
    options?: RestoreDefaultsStrictOptions,
  ): Promise<ModuleConfigRecord[]>
  invalidate(moduleId: string, name?: string, scope?: ConfigScope): Promise<void>
}

function prepareStrictDefaults(
  defaults: readonly ModuleConfigDefault[],
): Array<{ moduleId: string; name: string; value: unknown }> {
  if (!Array.isArray(defaults)) {
    throw new Error('[configs] Invalid instance config defaults catalog: expected an array.')
  }
  const seen = new Set<string>()
  const validated: Array<{ moduleId: string; name: string; value: unknown }> = []
  for (let index = 0; index < defaults.length; index += 1) {
    const entry = defaults[index]
    const parsedKey = moduleConfigKeySchema.safeParse({
      moduleId: entry?.moduleId,
      name: entry?.name,
    })
    if (!parsedKey.success) {
      throw new Error(
        `[configs] Invalid instance config default key at index ${index}: ${parsedKey.error.issues[0]?.message ?? 'invalid key'}.`,
      )
    }
    const { moduleId, name } = parsedKey.data
    const keyLabel = `${moduleId}.${name}`
    const dedupeKey = JSON.stringify([moduleId, name])
    if (seen.has(dedupeKey)) {
      throw new Error(`[configs] Duplicate instance config default key "${keyLabel}".`)
    }
    seen.add(dedupeKey)
    const value = validateAndCloneFiniteJsonValue(entry.value, moduleId, keyLabel)
    validated.push({ moduleId, name, value })
  }
  validated.sort(compareConfigKeys)
  return validated
}

/**
 * Strictly restores instance-scoped module configuration defaults in a single
 * transaction on a fresh EntityManager.
 *
 * - An empty catalog is a successful no-op.
 * - All keys and finite JSON values are validated before any DB writes occur.
 * - Missing EntityManager, lookup, persistence, flush, or commit errors propagate
 *   with transaction rollback and zero cache writes.
 * - Concurrent unique-index conflicts (SQLSTATE 23505) retry with a fresh EM fork.
 * - Cache entries are published only after the transaction commits.
 */
export async function restoreInstanceDefaultsStrict(
  container: AppContainer,
  defaults: readonly ModuleConfigDefault[],
  options?: RestoreDefaultsStrictOptions,
): Promise<ModuleConfigRecord[]> {
  const validated = prepareStrictDefaults(defaults)
  if (validated.length === 0) return []

  const em = resolveEm(container)
  if (!em) {
    throw new Error(
      '[configs] Cannot restore instance defaults: EntityManager is not registered in the container.',
    )
  }

  const force = options?.force ?? true
  const maxAttempts = Number.isFinite(options?.maxConflictRetries)
    ? Math.max(1, Math.trunc(options!.maxConflictRetries!))
    : 3
  let committedRecords: ModuleConfigRecord[] | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const freshEm =
      typeof (em as { fork?: unknown }).fork === 'function'
        ? (em.fork({
            clear: true,
            freshEventManager: true,
            useContext: false,
          }) as EntityManager)
        : em

    if (typeof (freshEm as { transactional?: unknown }).transactional !== 'function') {
      throw new Error(
        '[configs] Cannot restore instance defaults: EntityManager does not support transactions.',
      )
    }

    try {
      committedRecords = await freshEm.transactional(async (txEm) => {
        const repo = txEm.getRepository(ModuleConfig)
        const touched: ModuleConfig[] = []
        for (const entry of validated) {
          const existing = await repo.findOne({
            moduleId: entry.moduleId,
            name: entry.name,
            tenantId: null,
          })
          const now = new Date()
          if (!existing) {
            const created = repo.create({
              moduleId: entry.moduleId,
              name: entry.name,
              valueJson: entry.value,
              tenantId: null,
              organizationId: null,
              createdAt: now,
              updatedAt: now,
            })
            txEm.persist(created)
            touched.push(created)
          } else if (force) {
            existing.valueJson = entry.value
            existing.updatedAt = now
            txEm.persist(existing)
            touched.push(existing)
          }
        }
        if (touched.length > 0) {
          await txEm.flush()
        }
        return touched.map((entity) => toRecord(entity, 'instance'))
      })
      break
    } catch (error) {
      if (isUniqueViolation(error) && attempt < maxAttempts) {
        continue
      }
      throw error
    }
  }

  const records = committedRecords ?? []
  const cache = resolveCache(container)
  for (const record of records) {
    await writeCache(
      cache,
      cacheKey(record.moduleId, record.name, null),
      { found: true, record },
      record.moduleId,
      null,
    )
  }
  return records
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
    const entity = await em.getRepository(ModuleConfig).findOne({ moduleId, name, tenantId })
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

  const restoreDefaultsStrict = async (
    defaults: readonly ModuleConfigDefault[],
    options?: RestoreDefaultsStrictOptions,
  ): Promise<ModuleConfigRecord[]> => restoreInstanceDefaultsStrict(container, defaults, options)

  return {
    getRecord,
    getValue,
    setValue,
    restoreDefaults,
    restoreDefaultsStrict,
    invalidate,
  }
}
