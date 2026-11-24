"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { isMaintenanceStatus, resolveWidgetMode, type MaintenanceStatus, type MaintenanceWidgetMode } from './status'

const POLL_INTERVAL_MS = 30_000
const STATUS_PATH = '/api/maintenance/status'

function formatUntil(until: string | null, locale: string | undefined): string | null {
  if (!until) return null
  const parsed = new Date(until)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

export default function MaintenanceStatusWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const [status, setStatus] = React.useState<MaintenanceStatus | null>(null)
  const [mode, setMode] = React.useState<MaintenanceWidgetMode | null>(null)
  const modeRef = React.useRef<MaintenanceWidgetMode | null>(null)

  const poll = React.useCallback(async () => {
    try {
      const call = await apiCall<MaintenanceStatus>(STATUS_PATH, { cache: 'no-store' })
      const next = call.ok && isMaintenanceStatus(call.result) ? call.result : null
      if (!call.ok && call.status !== 503) return
      const nextMode = resolveWidgetMode(modeRef.current, next)
      modeRef.current = nextMode
      setMode(nextMode)
      setStatus(next)
    } catch {
      return
    }
  }, [])

  React.useEffect(() => {
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [poll])

  if (!status || !mode || mode === 'hidden') return null

  const locale = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined
  const untilLabel = formatUntil(status.until, locale)

  if (mode === 'bypass-banner') {
    return (
      <Alert status="warning" className="mb-4" data-testid="maintenance-bypass-banner">
        <AlertTitle>{t('maintenance.banner.title', 'Maintenance mode is on — you are bypassing it')}</AlertTitle>
        {untilLabel ? (
          <AlertDescription>{t('maintenance.banner.until', 'The window is expected to end at {until}.', { until: untilLabel })}</AlertDescription>
        ) : null}
      </Alert>
    )
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-overlay-title"
      data-testid="maintenance-overlay"
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="maintenance-overlay-title" className="text-lg font-semibold">
          {t('maintenance.overlay.title', 'Scheduled maintenance in progress')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {status.message || t('maintenance.overlay.message', 'Changes cannot be saved right now. Reload the page when maintenance has finished.')}
        </p>
        {untilLabel ? (
          <p className="mt-2 text-sm">{t('maintenance.overlay.until', 'Expected back: {until}', { until: untilLabel })}</p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => window.location.reload()}>
            {t('maintenance.overlay.reload', 'Reload')}
          </Button>
        </div>
      </div>
    </div>
  )
}
