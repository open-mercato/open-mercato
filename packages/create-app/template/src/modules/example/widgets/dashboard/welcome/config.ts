export type WelcomeSettings = {
  headline: string
  message?: string
}

// These strings are load-bearing: they are persisted verbatim into
// dashboard_layouts.layout_json on a user's first dashboard load, and
// resolveWelcomeText translates a stored value only while it still equals them.
// Editing them makes every previously-persisted layout untranslatable.
export const DEFAULT_SETTINGS: WelcomeSettings = {
  headline: 'Welcome back, {{user}}!',
  message: 'Use this dashboard to stay on top of your most important work.',
}

export const WELCOME_HEADLINE_KEY = 'example.widgets.welcome.defaults.headline'
export const WELCOME_MESSAGE_KEY = 'example.widgets.welcome.defaults.message'

export function resolveWelcomeText(
  value: string,
  shippedDefault: string,
  translationKey: string,
  translate: (key: string, fallback: string) => string,
): string {
  return value === shippedDefault ? translate(translationKey, shippedDefault) : value
}

export function hydrateWelcomeSettings(raw: unknown): WelcomeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<WelcomeSettings>
  return {
    headline: typeof data.headline === 'string' && data.headline.trim() ? data.headline : DEFAULT_SETTINGS.headline,
    message: typeof data.message === 'string' ? data.message : DEFAULT_SETTINGS.message,
  }
}
