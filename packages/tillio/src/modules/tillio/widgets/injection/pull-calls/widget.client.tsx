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

const DEFAULT_RANGE_DAYS = 7

type PullBlocker = 'environment_not_ready' | 'operator_missing' | 'environment_drift'

type PullReadiness = {
  ok: boolean
  environmentReady: boolean
  operatorAttached: boolean
  envDrift: boolean
  blocker: PullBlocker | null
}

type PullResult = {
  ok: boolean
  message?: string
  fetched?: number
  created?: number
  updated?: number
  failed?: number
  nextCursor?: string | null
  hasMore?: boolean
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
    } finally {
      setChecking(false)
    }
  }, [])

  const blockerMessage = React.useCallback(
    (blocker: PullBlocker): string => {
      if (blocker === 'operator_missing') {
        return t('tillio.pull.operatorMissing', 'Attach a Tillio operator on the integration page before pulling calls.')
      }
      if (blocker === 'environment_drift') {
        return t('tillio.pull.envDrift', 'The Tillio environment changed after the operator was attached. Detach and attach it again before pulling calls.')
      }
      return t('tillio.pull.envNotReady', 'Configure the Tillio credentials and run the health check on the integration page first.')
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
    let created = 0
    let updated = 0
    let failed = 0
    let cursor: string | null = null

    try {
      // The route returns one batch per call; keep resuming from `nextCursor`
      // until Tillio has no further pages for this range.
      do {
        const response = await runMutation({
          context: mutationContext,
          mutationPayload: { providerKey: 'tillio', from, to },
          operation: () =>
            apiCall<PullResult>('/api/tillio/pull', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ from, to, ...(cursor ? { cursor } : {}) }),
            }),
        })
        const body = response.result as PullResult | undefined
        if (!response.ok) {
          flash(body?.message ?? t('tillio.pull.failed', 'Could not pull calls from Tillio.'), 'error')
          return
        }
        created += body?.created ?? 0
        updated += body?.updated ?? 0
        failed += body?.failed ?? 0
        cursor = body?.hasMore ? (body.nextCursor ?? null) : null
      } while (cursor)

      if (failed > 0) {
        flash(
          t('tillio.pull.partial', 'Pulled {created} new and {updated} updated calls, {failed} failed.')
            .replace('{created}', String(created))
            .replace('{updated}', String(updated))
            .replace('{failed}', String(failed)),
          'warning',
        )
      } else {
        flash(
          t('tillio.pull.succeeded', 'Pulled {created} new and {updated} updated calls.')
            .replace('{created}', String(created))
            .replace('{updated}', String(updated)),
          'success',
        )
      }
      setOpen(false)
      window.location.reload()
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
                <span className="text-xs text-muted-foreground">
                  {t('tillio.pull.timezoneHint', 'Days are interpreted in the Europe/Warsaw timezone used by Tillio.')}
                </span>
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
