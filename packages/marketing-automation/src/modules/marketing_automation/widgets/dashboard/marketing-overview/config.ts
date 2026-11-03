/** How many days the widget looks back. A week is how marketing is planned, so it is the default. */
export const DEFAULT_WINDOW_DAYS = 7

const ALLOWED_WINDOWS = [7, 14, 30, 90] as const

export type MarketingOverviewSettings = {
  windowDays: number
}

export const DEFAULT_SETTINGS: MarketingOverviewSettings = { windowDays: DEFAULT_WINDOW_DAYS }

/**
 * Settings arrive from persisted layout JSON, which a viewer can edit — so this is total and defensive.
 *
 * An unrecognised window falls back to the default rather than reaching the endpoint, where it would be
 * clamped anyway: two places that clamp differently is how a widget ends up showing a different period from
 * the one its own settings claim.
 */
export function hydrateMarketingOverviewSettings(raw: unknown): MarketingOverviewSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const value = (raw as { windowDays?: unknown }).windowDays
  const days = typeof value === 'number' ? value : Number(value)
  return ALLOWED_WINDOWS.includes(days as (typeof ALLOWED_WINDOWS)[number])
    ? { windowDays: days }
    : DEFAULT_SETTINGS
}

export function allowedWindows(): readonly number[] {
  return ALLOWED_WINDOWS
}
