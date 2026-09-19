import type { EntityManager } from '@mikro-orm/core'
import type { CacheStrategy } from '@open-mercato/cache'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MarketDisplayProfile } from '../data/entities'

export type DisplayProfileScope = {
  organizationId: string
  tenantId: string
}

export interface DisplayProfileResolver {
  resolve(scope: DisplayProfileScope): Promise<DisplayProfile | null>
  invalidate(scope: DisplayProfileScope): Promise<void>
}

export const DISPLAY_PROFILE_CACHE_TAG = 'markets:display-profile'
const CACHE_TTL_MS = 300_000

const logger = createLogger('markets.display-profile')

type CachedProfile = { profile: DisplayProfile | null }

function isCachedProfile(value: unknown): value is CachedProfile {
  return typeof value === 'object' && value !== null && 'profile' in value
}

export function displayProfileCacheKey(scope: DisplayProfileScope): string {
  return `markets:display-profile:${scope.tenantId}:${scope.organizationId}`
}

export function displayProfileCacheTags(scope: DisplayProfileScope): string[] {
  return [`tenant:${scope.tenantId}`, `org:${scope.organizationId}`, DISPLAY_PROFILE_CACHE_TAG]
}

/**
 * The stored row as the plain shape the helper layer takes.
 *
 * The entity's enum-ish columns are plain text in the database so a market can gain a value without
 * a type migration; narrowing happens here, once, at the only boundary that reads the table.
 */
export function toDisplayProfile(row: MarketDisplayProfile): DisplayProfile {
  return {
    code: row.code,
    name: row.name,
    languageTag: row.languageTag,
    currencyCode: row.currencyCode,
    currencyDisplay: row.currencyDisplay as DisplayProfile['currencyDisplay'],
    decimalSeparator: row.decimalSeparator ?? null,
    thousandsSeparator: row.thousandsSeparator ?? null,
    negativeStyle: row.negativeStyle as DisplayProfile['negativeStyle'],
    dateFormat: row.dateFormat,
    dateTimeFormat: row.dateTimeFormat,
    timeFormat: row.timeFormat,
    hourCycle: row.hourCycle as DisplayProfile['hourCycle'],
    firstDayOfWeek: row.firstDayOfWeek as DisplayProfile['firstDayOfWeek'],
    timeZone: row.timeZone,
    addressLayout: row.addressLayout as DisplayProfile['addressLayout'],
    defaultCountryCode: row.defaultCountryCode,
    subdivisionRequired: row.subdivisionRequired,
    postalCodePattern: row.postalCodePattern ?? null,
    postalCodeLabelKey: row.postalCodeLabelKey,
    subdivisionLabelKey: row.subdivisionLabelKey,
    addressLine2LabelKey: row.addressLine2LabelKey,
    phoneNationalPattern: row.phoneNationalPattern ?? null,
    phoneDefaultDialCode: row.phoneDefaultDialCode ?? null,
    measurementSystem: row.measurementSystem as DisplayProfile['measurementSystem'],
    defaultWeightUnit: row.defaultWeightUnit,
    defaultLengthUnit: row.defaultLengthUnit,
    lengthDisplay: row.lengthDisplay as DisplayProfile['lengthDisplay'],
    paperSize: row.paperSize as DisplayProfile['paperSize'],
    pricePresentation: row.pricePresentation as DisplayProfile['pricePresentation'],
    taxLineLabelKey: row.taxLineLabelKey,
    taxNoteKey: row.taxNoteKey ?? null,
  }
}

/**
 * Resolve the organization's market display profile, or `null` when none was picked.
 *
 * `null` is a real answer, not a failure: every helper then renders the frozen legacy defaults,
 * which is exactly today's output (spec assumption A5). The read goes through the DI cache because
 * nearly every page needs this value and it changes a few times a year.
 *
 * This is the only place in the design that reads `process.env` - the env date pins stay in force
 * as the second level of the fallback chain for an organization with no row, so a deployment that
 * pinned a format keeps it.
 */
export class CachedDisplayProfileResolver implements DisplayProfileResolver {
  constructor(
    private readonly em: EntityManager,
    private readonly cache: CacheStrategy | null,
  ) {}

  async resolve(scope: DisplayProfileScope): Promise<DisplayProfile | null> {
    if (!scope?.organizationId || !scope?.tenantId) return null
    const key = displayProfileCacheKey(scope)

    if (this.cache) {
      try {
        const cached = await this.cache.get(key)
        // Wrapped, because `get` answers `null` for both a miss and a cached `null`, and "no market
        // picked" is a real answer worth caching - otherwise every request from an organization
        // without a profile row would hit the database.
        if (isCachedProfile(cached)) return cached.profile
      } catch (error) {
        logger.warn('Display profile cache read failed', { err: error })
      }
    }

    const row = await this.em.findOne(MarketDisplayProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      isActive: true,
    })

    const profile = row ? this.applyEnvFallbacks(toDisplayProfile(row)) : null

    if (this.cache) {
      try {
        const envelope: CachedProfile = { profile }
        await this.cache.set(key, envelope, { ttl: CACHE_TTL_MS, tags: displayProfileCacheTags(scope) })
      } catch (error) {
        logger.warn('Display profile cache write failed', { err: error })
      }
    }
    return profile
  }

  async invalidate(scope: DisplayProfileScope): Promise<void> {
    if (!this.cache) return
    try {
      await this.cache.delete(displayProfileCacheKey(scope))
    } catch (error) {
      logger.warn('Display profile cache invalidation failed', { err: error })
    }
  }

  /**
   * An explicit env pin still wins over a seeded pattern, because an operator who set
   * `NEXT_PUBLIC_OM_DATE_FORMAT` said how dates must look on their deployment.
   */
  private applyEnvFallbacks(profile: DisplayProfile): DisplayProfile {
    const datePin = normalizePin(process.env.NEXT_PUBLIC_OM_DATE_FORMAT ?? process.env.NEXT_PUBLIC_DATE_FORMAT)
    const dateTimePin = normalizePin(
      process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT ?? process.env.NEXT_PUBLIC_DATE_TIME_FORMAT,
    )
    if (!datePin && !dateTimePin) return profile
    return {
      ...profile,
      dateFormat: datePin ?? profile.dateFormat,
      dateTimeFormat: dateTimePin ?? datePin ?? profile.dateTimeFormat,
    }
  }
}

const SYSTEM_FORMAT_VALUES = new Set(['auto', 'default', 'locale', 'system'])

function normalizePin(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (SYSTEM_FORMAT_VALUES.has(trimmed.toLowerCase())) return null
  return trimmed.replace(/YYYY/g, 'yyyy').replace(/YY/g, 'yy').replace(/DD/g, 'dd')
}
