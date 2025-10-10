"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateWelcomeSettings, type WelcomeSettings } from './config'

const WelcomeWidgetClient: React.FC<DashboardWidgetComponentProps<WelcomeSettings>> = ({ mode, settings, onSettingsChange, context }) => {
  const value = React.useMemo(() => hydrateWelcomeSettings(settings), [settings])

  const handleChange = React.useCallback((key: keyof WelcomeSettings, next: string) => {
    const normalized = hydrateWelcomeSettings(settings)
    onSettingsChange({ ...normalized, [key]: next })
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
            Use <code className='rounded bg-muted px-1 py-0.5'>{'{{user}}'}</code> to include the signed-in identifier.
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
        <p className="text-sm text-muted-foreground whitespace-pre-line">{value.message}</p>
      ) : null}
    </div>
  )
}

export default WelcomeWidgetClient
