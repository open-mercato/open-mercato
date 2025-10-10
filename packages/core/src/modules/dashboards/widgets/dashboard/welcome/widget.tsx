import * as React from 'react'
import type { DashboardWidgetModule, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'

type WelcomeSettings = {
  headline: string
  message?: string
}

const DEFAULT_SETTINGS: WelcomeSettings = {
  headline: 'Welcome back, {{user}}!',
  message: 'Use this dashboard to jump into your most important work.',
}

function normalizeSettings(raw: unknown): WelcomeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const value = raw as Partial<WelcomeSettings>
  return {
    headline: typeof value.headline === 'string' && value.headline.trim().length ? value.headline : DEFAULT_SETTINGS.headline,
    message: typeof value.message === 'string' ? value.message : DEFAULT_SETTINGS.message,
  }
}

const WelcomeWidgetView: React.FC<DashboardWidgetComponentProps<WelcomeSettings>> = ({ mode, settings, onSettingsChange, context }) => {
  const resolved = React.useMemo(() => normalizeSettings(settings), [settings])

  const handleChange = React.useCallback((field: keyof WelcomeSettings, value: string) => {
    const next = { ...resolved, [field]: value }
    onSettingsChange(next)
  }, [resolved, onSettingsChange])

  if (mode === 'settings') {
    return (
      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="welcomeHeadline" className="text-xs font-medium uppercase text-muted-foreground">
            Headline
          </label>
          <input
            id="welcomeHeadline"
            value={resolved.headline}
            onChange={(event) => handleChange('headline', event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Welcome back!"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="welcomeMessage" className="text-xs font-medium uppercase text-muted-foreground">
            Message
          </label>
          <textarea
            id="welcomeMessage"
            value={resolved.message ?? ''}
            onChange={(event) => handleChange('message', event.target.value)}
            className="min-h-[120px] w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Use this dashboard to jump into your most important work."
          />
        </div>
      </form>
    )
  }

  const userLabel = context?.userId ? context.userId.slice(0, 12) : 'there'
  const greeting = resolved.headline.includes('{{user}}')
    ? resolved.headline.replace('{{user}}', userLabel)
    : resolved.headline

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold leading-tight">{greeting}</h2>
      {resolved.message && (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{resolved.message}</p>
      )}
    </div>
  )
}

const widget: DashboardWidgetModule<WelcomeSettings> = {
  metadata: {
    id: 'dashboards.welcome',
    title: 'Welcome message',
    description: 'Greets the current user and highlights what matters today. Use {{user}} in the headline to reference the signed-in user.',
    features: ['dashboards.view', 'dashboards.widgets.welcome'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: WelcomeWidgetView,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (settings) => ({
    headline: settings.headline,
    message: settings.message,
  }),
}

export default widget
