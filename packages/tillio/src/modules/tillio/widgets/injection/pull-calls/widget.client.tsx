'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { DateRange } from '@open-mercato/ui/backend/date-range/dateRanges'
import { PULL_BLOCKER_COPY, tillioErrorCopy } from '../../../lib/error-codes'
import type { PullBlocker } from '../../../lib/pull-readiness'

const DEFAULT_RANGE_DAYS = 7

type PullReadiness = {
  ok: boolean
  environmentReady: boolean
  operatorAttached: boolean
  envDrift: boolean
  blocker: PullBlocker | null
  timeZone: string | null
}

type PullResult = {
  ok: boolean
  code?: string
  progressJobId?: string
}

function toDayString(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function defaultRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (DEFAULT_RANGE_DAYS - 1))
  return { start, end }
}

export default function PullCallsWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [range, setRange] = React.useState<DateRange | null>(defaultRange)
  const [pending, setPending] = React.useState(false)
  const [readiness, setReadiness] = React.useState<PullReadiness | null>(null)
  const [checking, setChecking] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'tillio-pull-calls',
    blockedMessage: t('tillio.pull.blocked', 'Pull blocked by validation.'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'tillio', retryLastMutation }),
    [retryLastMutation],
  )

  // Readiness is checked when the dialog opens rather than on mount, so the
  // calls list does not pay for a request every visitor never needs.
  const openDialog = React.useCallback(async () => {
    setOpen(true)
    setChecking(true)
    try {
      const response = await apiCall<PullReadiness>('/api/tillio/pull')
      setReadiness(response.ok ? (response.result ?? null) : null)
    } catch {
      // A null readiness already renders the "could not check" notice, so the failure is
      // handled here rather than escaping the void call as an unhandled rejection.
      setReadiness(null)
    } finally {
      setChecking(false)
    }
  }, [])

  const blockerMessage = React.useCallback(
    (blocker: PullBlocker): string => {
      // The lookup can still miss at runtime when this bundle is older than the server it talks to.
      const copy = PULL_BLOCKER_COPY[blocker]
      return copy ? t(copy.key, copy.fallback) : t('tillio.pull.blocked', 'Pull blocked by validation.')
    },
    [t],
  )

  const pull = React.useCallback(async () => {
    if (pending) return
    if (!range?.start || !range.end) {
      flash(t('tillio.pull.rangeRequired', 'Pick a date range first.'), 'error')
      return
    }
    const from = toDayString(range.start)
    const to = toDayString(range.end)

    setPending(true)
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: 'tillio', from, to },
        operation: () =>
          apiCall<PullResult>('/api/tillio/pull', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from, to }),
          }),
      })
      const body = response.result as PullResult | undefined
      if (!response.ok) {
        const copy = tillioErrorCopy(body?.code, 'pull_failed')
        flash(t(copy.key, copy.fallback), 'error')
        return
      }
      // The sweep runs in a worker, so the dialog only confirms the handover; the top bar owns
      // the rest and the list picks the calls up on its next load.
      flash(t('tillio.pull.queued', 'Pulling calls from Tillio. Track it in the progress bar.'), 'success')
      setOpen(false)
    } finally {
      setPending(false)
    }
  }, [mutationContext, pending, range, runMutation, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void pull()
      }
    },
    [pull],
  )

  const blocker = readiness?.blocker ?? null
  const blocked = checking || !readiness || Boolean(blocker)

  return (
    <>
      <Button type="button" variant="outline" onClick={() => void openDialog()}>
        {t('tillio.pull.action', 'Pull calls')}
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
        <DialogContent onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('tillio.pull.title', 'Pull calls from Tillio')}</DialogTitle>
            <DialogDescription>
              {t('tillio.pull.description', 'Calls in the selected range are ingested from the attached operator. Pulling the same range again updates existing calls instead of duplicating them.')}
            </DialogDescription>
          </DialogHeader>

          {checking ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner />
              {t('tillio.pull.checking', 'Checking the Tillio connection...')}
            </div>
          ) : (
            <>
              {!readiness ? (
                <Alert status="error">
                  <AlertTitle>{t('tillio.pull.checkFailed', 'Could not check the Tillio connection.')}</AlertTitle>
                  <AlertDescription>
                    <Button type="button" variant="outline" size="sm" onClick={() => void openDialog()}>
                      {t('tillio.pull.retry', 'Retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {blocker ? (
                <Alert status="warning">
                  <AlertTitle>{t('tillio.pull.notReadyTitle', 'Tillio is not ready')}</AlertTitle>
                  <AlertDescription>{blockerMessage(blocker)}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-2 py-2">
                <DateRangePicker value={range} onChange={setRange} disabled={pending || blocked} />
                {readiness?.timeZone ? (
                  <span className="text-xs text-muted-foreground">
                    {t(
                      'tillio.pull.timezoneHint',
                      'Days are interpreted in the {{timeZone}} timezone that Tillio uses.',
                      { timeZone: readiness.timeZone },
                    )}
                  </span>
                ) : null}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('tillio.pull.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void pull()} disabled={pending || blocked}>
              {pending ? t('tillio.pull.pulling', 'Pulling...') : t('tillio.pull.confirm', 'Pull calls')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
