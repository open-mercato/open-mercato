export type WelcomeSettings = {
  headline: string
  message?: string
}

export const DEFAULT_SETTINGS: WelcomeSettings = {
  headline: 'Welcome back, {{user}}!',
  message: 'Use this dashboard to stay on top of your most important work.',
}

export function hydrateWelcomeSettings(raw: unknown): WelcomeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<WelcomeSettings>
  return {
    headline: typeof data.headline === 'string' && data.headline.trim() ? data.headline : DEFAULT_SETTINGS.headline,
    message: typeof data.message === 'string' ? data.message : DEFAULT_SETTINGS.message,
  }
}
