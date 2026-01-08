import { createRequestContainer } from "@/lib/di/container"
import { FeatureToggle, FeatureToggleOverride } from "../data/entities"
import { EntityManager } from "@mikro-orm/core"
import { CacheService } from "@open-mercato/cache"

const DEFAULT_CACHE_TTL_MS = 60_000
const ERROR_CACHE_TTL_MS = 10_000

function resolveMissingToggleDefault(): boolean {
    const raw = process.env.FEATURE_TOGGLES_MISSING_TOGGLE_DEFAULT
    if (raw === 'enabled') return true
    if (raw === 'disabled') return false
    return false
}

function resolveCacheTtlMs(): number {
    const raw = process.env.FEATURE_TOGGLES_CACHE_TTL_MS
    if (!raw) return DEFAULT_CACHE_TTL_MS
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CACHE_TTL_MS
    return parsed
}

function resolveErrorTtlMs(): number {
    const raw = process.env.FEATURE_TOGGLES_ERROR_CACHE_TTL_MS
    if (!raw) return ERROR_CACHE_TTL_MS
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return ERROR_CACHE_TTL_MS
    return parsed
}

type FeatureToggleResolutionResult = {
    enabled: boolean
    source: 'override' | 'default' | 'fallback' | 'missing'
    toggleId: string
    identifier: string
    tenantId: string
}

export type IsFeatureEnabledFunction = (
    identifier: string,
    tenantId: string
) => Promise<FeatureToggleResolutionResult>

const toCachedResolution = (value: unknown): FeatureToggleResolutionResult | null => {
    if (typeof value !== 'object' || value === null) return null
    const record = value as Partial<FeatureToggleResolutionResult>
    if (!record.enabled || typeof record.source !== 'string' || !record.toggleId || !record.identifier || !record.tenantId) return null
    return value as FeatureToggleResolutionResult
}

export const getIsEnabledCacheKey = (identifier: string, tenantId: string) => {
    return `feature_toggles:isEnabled:${identifier}:${tenantId}`
}

const getIdentifierTag = (identifier: string) => {
    return `feature_toggles:toggle:${identifier}`
}
const getTenantTag = (tenantId: string) => {
    return `feature_toggles:tenant:${tenantId}`
}

const getCacheTags = (identifier: string, tenantId: string) => {
    return [getIdentifierTag(identifier), getTenantTag(tenantId)]
}

const saveCache = async (cache: CacheService, identifier: string, tenantId: string, result: FeatureToggleResolutionResult, isError: boolean = false) => {
    const key = getIsEnabledCacheKey(identifier, tenantId)
    const ttl = isError ? resolveErrorTtlMs() : resolveCacheTtlMs()
    await cache.set(key, result, { ttl, tags: getCacheTags(identifier, tenantId) })
}

export const isFeatureEnabled = async (identifier: string, tenantId: string) => {
    const container = await createRequestContainer()
    const cache = container.resolve('cache') as CacheService
    const key = `feature_toggles:isEnabled:${identifier}:${tenantId}`
    const cached = await cache.get(key)
    if (cached) {
        const parsed = toCachedResolution(cached)
        if (parsed) {
            return parsed
        }
    }

    const em = container.resolve('em') as EntityManager

    let toggle: FeatureToggle | null = null
    try {
        toggle = await em.findOne(FeatureToggle, { identifier, deletedAt: null })
    } catch (error) {
        console.warn(`[feature_toggles] Failed to lookup toggle ${identifier}, using fallback:`, error)
        const result: FeatureToggleResolutionResult = {
            enabled: resolveMissingToggleDefault(),
            source: 'missing',
            toggleId: '',
            identifier: '',
            tenantId: '',
        }
        return result
    }

    if (!toggle) {
        const result: FeatureToggleResolutionResult = {
            enabled: resolveMissingToggleDefault(),
            source: 'missing',
            toggleId: '',
            identifier: '',
            tenantId: '',
        }
        return result
    }

    let override: FeatureToggleOverride | null = null
    try {
        override = await em.findOne(FeatureToggleOverride, { toggle: toggle.id, tenantId })
    } catch (error) {
        console.warn(`[feature_toggles] Failed to lookup override for ${identifier}, using fail mode fallback:`, error)
        const result: FeatureToggleResolutionResult = {
            enabled: toggle.failMode === 'fail_open',
            source: 'fallback',
            toggleId: toggle.id,
            identifier: toggle.identifier,
            tenantId: tenantId,
        }
        await saveCache(cache, identifier, tenantId, result, true)
        return result
    }

    if (override) {
        const result: FeatureToggleResolutionResult = {
            enabled: override.state === 'enabled',
            source: 'override',
            toggleId: toggle.id,
            identifier: toggle.identifier,
            tenantId: tenantId,
        }
        await saveCache(cache, identifier, tenantId, result, false)
        return result
    }

    const result: FeatureToggleResolutionResult = {
        enabled: !!toggle.defaultState,
        source: 'default',
        toggleId: toggle.id,
        identifier: toggle.identifier,
        tenantId: tenantId,
    }
    await saveCache(cache, identifier, tenantId, result, false)
    return result
}

export const invalidateIsEnabledCacheByIdentifierTag = async (identifier: string) => {
    const container = await createRequestContainer()
    const cache = container.resolve('cache') as CacheService
    const tags = getIdentifierTag(identifier)
    await cache.deleteByTags([tags])
}

export const invalidateIsEnabledCacheByKey = async (identifier: string, tenantId: string) => {
    const container = await createRequestContainer()
    const cache = container.resolve('cache') as CacheService
    const key = getIsEnabledCacheKey(identifier, tenantId)
    await cache.delete(key)
}