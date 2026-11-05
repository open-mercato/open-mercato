import { cache } from 'react'
import { runWithCacheTenant } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { dateLocaleSettingsInputSchema } from '@open-mercato/shared/lib/date-locale/validation'
import {
  USER_TIME_ZONE_LOOKUP_DI_KEY,
  type NormalizedDateLocaleSettingsRecord,
  type ResolvedDateLocaleSettings,
  type UserTimeZoneLookup,
} from '@open-mercato/shared/lib/date-locale/types'
import type { ModuleConfigRecord, ModuleConfigService } from './module-config-service'

const logger = createLogger('configs').child({ component: 'date-locale-settings' })

export const DATE_LOCALE_CONFIG_MODULE = 'configs'
export const DATE_LOCALE_CONFIG_NAME = 'date_locale'

/** Reports a date/locale failure that the caller turns into a fallback, so the fallback is visible. */
export function reportDateLocaleError(err: unknown, code: string): void {
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'configs', code })
  } catch {}
}

type Resolver = { resolve: <T = unknown>(name: string) => T; hasRegistration?: (name: string) => boolean }

export type StoredDateLocaleSettings = {
  settings: NormalizedDateLocaleSettingsRecord
  updatedAt: string | null
}

const EMPTY_SETTINGS: NormalizedDateLocaleSettingsRecord = {
  locale: null,
  dateFormat: null,
  dateTimeFormat: null,
  timeFormat: null,
  timeZone: null,
  firstDayOfWeek: null,
}

/**
 * The stored blob, re-validated on read: a row written by an older release or by hand must not
 * break rendering, so anything that no longer validates is dropped field by field.
 */
export function normalizeStoredDateLocaleSettings(value: unknown): NormalizedDateLocaleSettingsRecord {
  if (!value || typeof value !== 'object') return { ...EMPTY_SETTINGS }
  const record = value as Record<string, unknown>
  const normalized = { ...EMPTY_SETTINGS }
  for (const key of Object.keys(EMPTY_SETTINGS) as Array<keyof NormalizedDateLocaleSettingsRecord>) {
    const parsed = dateLocaleSettingsInputSchema.safeParse({ [key]: record[key] ?? null })
    if (parsed.success) Object.assign(normalized, { [key]: parsed.data[key] })
  }
  return normalized
}

function toIso(value: ModuleConfigRecord['updatedAt'] | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function readTenantDateLocaleSettings(container: Resolver, tenantId: string): Promise<StoredDateLocaleSettings> {
  const service = container.resolve<ModuleConfigService>('moduleConfigService')
  // Cache keys are namespaced by the active cache tenant. API routes run inside the caller's
  // tenant, page renders and workers do not, so pin the namespace here: otherwise a layout reads
  // a `tenant:global` copy that a settings save never updates, and shows old settings until TTL.
  const record = await runWithCacheTenant(tenantId, () =>
    service.getRecord(DATE_LOCALE_CONFIG_MODULE, DATE_LOCALE_CONFIG_NAME, { tenantId }),
  )
  if (!record || record.source !== 'tenant') return { settings: { ...EMPTY_SETTINGS }, updatedAt: null }
  return { settings: normalizeStoredDateLocaleSettings(record.value), updatedAt: toIso(record.updatedAt) }
}

async function lookupUserTimeZone(container: Resolver, userId: string | null | undefined, tenantId: string): Promise<string | null> {
  if (!userId) return null
  try {
    if (container.hasRegistration && !container.hasRegistration(USER_TIME_ZONE_LOOKUP_DI_KEY)) return null
    const lookup = container.resolve<UserTimeZoneLookup>(USER_TIME_ZONE_LOOKUP_DI_KEY)
    return typeof lookup === 'function' ? await lookup({ userId, tenantId }) : null
  } catch (err) {
    logger.warn('Could not read the user timezone; using the organization default', { err })
    reportDateLocaleError(err, 'configs.date_locale.user_time_zone_failed')
    return null
  }
}

export async function resolveDateLocaleSettingsForScope(
  container: Resolver,
  { tenantId, userId }: { tenantId: string; userId?: string | null },
): Promise<ResolvedDateLocaleSettings> {
  const [{ settings }, userTimeZone] = await Promise.all([
    readTenantDateLocaleSettings(container, tenantId),
    lookupUserTimeZone(container, userId, tenantId),
  ])
  return resolveDateLocaleSettings({ tenant: settings, userTimeZone })
}

/**
 * The scope resolver registered into the shared slot: reports a failed lookup, then rethrows so the
 * shared registry falls back to env defaults as before.
 */
export async function resolveDateLocaleSettingsForScopeWithReporting(
  container: Resolver,
  scope: { tenantId: string; userId?: string | null },
): Promise<ResolvedDateLocaleSettings> {
  try {
    return await resolveDateLocaleSettingsForScope(container, scope)
  } catch (err) {
    logger.warn('Could not resolve tenant date/locale settings; using env defaults', { err })
    reportDateLocaleError(err, 'configs.date_locale.scope_resolve_failed')
    throw err
  }
}

/**
 * Request resolver registered into `@open-mercato/shared/lib/date-locale/registry`. Never throws:
 * anonymous requests or a container that cannot be built yet return `null`, and the caller falls
 * back to env defaults. Memoized per server render (React `cache`), so the root and backend
 * layouts share one tenant read and one primary-key user lookup per request.
 */
export const resolveDateLocaleSettingsFromCookies = cache(async (): Promise<ResolvedDateLocaleSettings | null> => {
  let auth: Awaited<ReturnType<typeof getAuthFromCookies>>
  try {
    auth = await getAuthFromCookies()
  } catch (err) {
    // No request scope (static rendering, build) or an unreadable cookie: an expected anonymous render.
    logger.debug('No session to resolve date/locale settings for', { err })
    return null
  }
  if (!auth?.tenantId) return null
  try {
    const container = await createRequestContainer()
    const userId = typeof auth.sub === 'string' && !auth.isApiKey ? auth.sub : null
    return await resolveDateLocaleSettingsForScope(container, { tenantId: auth.tenantId, userId })
  } catch (err) {
    logger.warn('Could not resolve tenant date/locale settings; using env defaults', { err })
    reportDateLocaleError(err, 'configs.date_locale.resolve_failed')
    return null
  }
})
