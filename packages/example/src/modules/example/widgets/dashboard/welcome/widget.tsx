"use client"

import * as React from 'react'
import type { DashboardWidgetModule, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'

type WelcomeSettings = {
  headline: string
  message?: string
}

const DEFAULT_SETTINGS: WelcomeSettings = {
  headline: 'Welcome back, {{user}}!',
  message: 'Use this dashboard to stay on top of your most important work.',
}

function normalizeSettings(raw: unknown): WelcomeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<WelcomeSettings>
  return {
    headline: typeof data.headline === 'string' && data.headline.trim() ? data.headline : DEFAULT_SETTINGS.headline,
    message: typeof data.message === 'string' ? data.message : DEFAULT_SETTINGS.message,
  }
}

const WelcomeWidget: React.FC<DashboardWidgetComponentProps<WelcomeSettings>> = ({
  mode,
  settings,
  onSettingsChange,
  context,
}) => {
  const value = React.useMemo(() => normalizeSettings(settings), [settings])

  const handleChange = React.useCallback((key: keyof WelcomeSettings, value: string) => {
    onSettingsChange({ ...normalizeSettings(settings), [key]: value })
  }, [onSettingsChange, settings])

  if (mode === 'settings') {
    return (
      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="welcome-headline" className="text-xs font-medium uppercase text-muted-foreground">
            Headline
          </label>
          <input
            id="welcome-headline"
            className="w-full rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={value.headline}
            onChange={(event) => handleChange('headline', event.target.value)}
            placeholder="Welcome back, {{user}}!"
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="rounded bg-muted px-1 py-0.5">{"{{user}}"}</code> to include the signed-in identifier.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="welcome-message" className="text-xs font-medium uppercase text-muted-foreground">
            Message
          </label>
          <textarea
            id="welcome-message"
            className="min-h-[120px] w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={value.message ?? ''}
            onChange={(event) => handleChange('message', event.target.value)}
            placeholder={DEFAULT_SETTINGS.message}
          />
        </div>
      </form>
    )
  }

  const userLabel = context?.userId ? context.userId.slice(0, 12) : 'there'
  const headline = value.headline.includes('{{user}}')
    ? value.headline.replace(/{{user}}/g, userLabel)
    : value.headline

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold leading-tight">{headline}</h2>
      {value.message ? (
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {value.message}
        </p>
      ) : null}
    </div>
  )
}

const widget: DashboardWidgetModule<WelcomeSettings> = {
  metadata: {
    id: 'example.dashboard.welcome',
    title: 'Welcome message',
    description: 'Greets the current user with a configurable headline and message.',
    features: ['dashboards.view', 'example.widgets.welcome'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: WelcomeWidget,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (value) => ({
    headline: value.headline,
    message: value.message,
  }),
}

export default widget
