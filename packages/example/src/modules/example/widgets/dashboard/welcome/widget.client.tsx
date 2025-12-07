"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateWelcomeSettings, type WelcomeSettings } from './config'
import { useT } from '@/lib/i18n/context'

const WelcomeWidgetClient: React.FC<DashboardWidgetComponentProps<WelcomeSettings>> = ({
  mode,
  settings,
  onSettingsChange,
  context,
  refreshToken: _refreshToken,
  onRefreshStateChange: _onRefreshStateChange,
}) => {
  const value = React.useMemo(() => hydrateWelcomeSettings(settings), [settings])

  const handleChange = React.useCallback((key: keyof WelcomeSettings, next: string) => {
    const normalized = hydrateWelcomeSettings(settings)
    onSettingsChange({ ...normalized, [key]: next })
  }, [onSettingsChange, settings])

  const userLabel = React.useMemo(() => {
    const name = context?.userName?.trim()
    if (name) return name
    const label = context?.userLabel?.trim()
    if (label) return label
    if (context?.userEmail) return context.userEmail
    return context?.userId ?? 'there'
  }, [context])

  const t = useT()
  
  if (mode === 'settings') {
    return (
      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="welcome-headline" className="text-xs font-medium uppercase text-muted-foreground">
            {t('example.widgets.welcome.settings.headlineLabel', 'Headline')}
          </label>
          <input
            id="welcome-headline"
            className="w-full rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={value.headline}
            onChange={(event) => handleChange('headline', event.target.value)}
            placeholder={t('example.widgets.welcome.settings.headlinePlaceholder', 'Welcome back, {{user}}!')}
          />
          <p className="text-xs text-muted-foreground">
            {t('example.widgets.welcome.settings.headlineHint', 'Use {{user}} to include the signed-in identifier.')}
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="welcome-message" className="text-xs font-medium uppercase text-muted-foreground">
            {t('example.widgets.welcome.settings.messageLabel', 'Message')}
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
