import { FeatureToggle, FeatureToggleOverride } from "../data/entities"
import { EntityManager } from "@mikro-orm/core"
import { CacheService } from "@open-mercato/cache"

type ToggleValueType = "boolean" | "string" | "number" | "json"

type ToggleResolutionSource = "override" | "default" | "missing"

type ToggleResolutionResult = {
  valueType: ToggleValueType
  value: boolean | string | number | unknown | null
  source: ToggleResolutionSource
  toggleId: string
  identifier: string
  tenantId: string
}

type ToggleErrorCode = "TYPE_MISMATCH" | "MISSING_TOGGLE" | "INVALID_VALUE"

type ToggleError = {
  code: ToggleErrorCode
  message: string
  identifier: string
  expectedType: ToggleValueType
  actualType?: ToggleValueType
  source?: ToggleResolutionSource
}

type ResultOk<T> = { ok: true; value: T; resolution: ToggleResolutionResult }
type ResultErr = { ok: false; error: ToggleError; resolution: ToggleResolutionResult }
export type Result<T> = ResultOk<T> | ResultErr

type ResolutionContext = {
  tenantId: string
  valueType: ToggleValueType
}

const toCachedResolution = (value: unknown): ToggleResolutionResult | null => {
  if (typeof value !== "object" || value === null) return null
  const record = value as Partial<ToggleResolutionResult>
  if (
    !record.valueType ||
    typeof record.source !== "string" ||
    !record.toggleId ||
    !record.identifier ||
    !record.tenantId
  )
    return null
  return value as ToggleResolutionResult
}

export const getIsEnabledCacheKey = (identifier: string, tenantId: string) => {
  return `feature_toggles:resolution:${identifier}:${tenantId}`
}

const getIdentifierTag = (identifier: string) => `feature_toggles:identifier:${identifier}`
const getTenantTag = (tenantId: string) => `feature_toggles:tenant:${tenantId}`

const getCacheTags = (identifier: string, tenantId: string) => {
  return [getIdentifierTag(identifier), getTenantTag(tenantId)]
}

export class FeatureTogglesService {
  private cacheTtlMs: number = 1 * 60 * 1000 // 1 minute
  constructor(
    private readonly cache: CacheService,
    private readonly em: EntityManager
  ) { }

  private async saveCache(
    identifier: string,
    tenantId: string,
    result: ToggleResolutionResult,
  ) {
    const key = getIsEnabledCacheKey(identifier, tenantId)
    await this.cache.set(key, result, { ttl: this.cacheTtlMs, tags: getCacheTags(identifier, tenantId) })
  }

  private async resolveToggle(identifier: string, tenantId: string): Promise<ToggleResolutionResult> {
    const key = getIsEnabledCacheKey(identifier, tenantId)

    const cached = await this.cache.get(key)
    if (cached) {
      const parsed = toCachedResolution(cached)
      if (parsed) return parsed
    }

    let toggle: FeatureToggle | null = null
    toggle = await this.em.findOne(FeatureToggle, { identifier, deletedAt: null })

    if (!toggle) {
      const result: ToggleResolutionResult = {
        valueType: "boolean",
        value: null,
        source: "missing",
        toggleId: "",
        identifier,
        tenantId,
      }
      return result
    }

    let override: FeatureToggleOverride | null = null
    override = await this.em.findOne(FeatureToggleOverride, { toggle: toggle.id, tenantId })


    const result: ToggleResolutionResult = {
      valueType: toggle.type,
      value: override ? override.value : toggle.defaultValue,
      source: override ? "override" : "default",
      toggleId: toggle.id,
      identifier: toggle.identifier,
      tenantId,
    }

    await this.saveCache(identifier, tenantId, result)
    return result
  }

  public async invalidateIsEnabledCacheByIdentifierTag(identifier: string) {
    await this.cache.deleteByTags([getIdentifierTag(identifier)])
  }

  public async invalidateIsEnabledCacheByKey(identifier: string, tenantId: string) {
    await this.cache.delete(getIsEnabledCacheKey(identifier, tenantId))
  }

  public async getFeatureToggleValue<T>(
    identifier: string,
    ctx: ResolutionContext
  ): Promise<Result<T>> {
    const resolution = await this.resolveToggle(identifier, ctx.tenantId)

    if (resolution.source === "missing") {
      console.warn(`[feature_toggles] Toggle "${identifier}" not found (missing).`)
      return {
        ok: false,
        error: {
          code: "MISSING_TOGGLE",
          message: `Toggle "${identifier}" not found (missing).`,
          identifier,
          expectedType: ctx.valueType,
          actualType: resolution.valueType,
          source: resolution.source,
        },
        resolution,
      }
    }



    if (resolution.valueType !== ctx.valueType) {
      console.error(
        `[feature_toggles] Toggle "${identifier}" has type "${resolution.valueType}" but "${ctx.valueType}" was requested.`,
        { resolution }
      )
      return {
        ok: false,
        error: {
          code: "TYPE_MISMATCH",
          message: `Toggle "${identifier}" has type "${resolution.valueType}" but "${ctx.valueType}" was requested.`,
          identifier,
          expectedType: ctx.valueType,
          actualType: resolution.valueType,
          source: resolution.source,
        },
        resolution,
      }
    }

    const isValueValid =
      (ctx.valueType === "boolean" && typeof resolution.value === "boolean") ||
      (ctx.valueType === "string" && typeof resolution.value === "string") ||
      (ctx.valueType === "number" && typeof resolution.value === "number") ||
      (ctx.valueType === "json")

    if (!isValueValid) {
      console.error(
        `[feature_toggles] Toggle "${identifier}" has invalid value for type "${resolution.valueType}".`,
        { resolution }
      )
      return {
        ok: false,
        error: {
          code: "INVALID_VALUE",
          message: `Toggle "${identifier}" has invalid value for type "${resolution.valueType}".`,
          identifier,
          expectedType: ctx.valueType,
          actualType: resolution.valueType,
          source: resolution.source,
        },
        resolution,
      }
    }

    return {
      ok: true,
      value: resolution.value as T,
      resolution,
    }
  }

  public async getBoolConfig(identifier: string, tenantId: string) {
    return this.getFeatureToggleValue<boolean>(identifier, { tenantId, valueType: "boolean" })
  }

  public async getNumberConfig(identifier: string, tenantId: string) {
    return this.getFeatureToggleValue<number>(identifier, { tenantId, valueType: "number" })
  }

  public async getStringConfig(identifier: string, tenantId: string) {
    return this.getFeatureToggleValue<string>(identifier, { tenantId, valueType: "string" })
  }

  public async getJsonConfig<T = unknown>(identifier: string, tenantId: string) {
    return this.getFeatureToggleValue<T>(identifier, { tenantId, valueType: "json" })
  }
}
