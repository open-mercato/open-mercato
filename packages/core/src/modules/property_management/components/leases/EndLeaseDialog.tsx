"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { formatDate, formatMoney, isSubmitShortcut, readErrorMessage, type CancelSettlement, type LeaseSummary } from './leaseModel'
import { useLeaseMutation } from './useLeaseMutation'
import { browserToday } from './useLeaseSettings'

type EndPreview = {
  defaultSettlement: CancelSettlement
  canCredit: boolean
  cancelAvailable: boolean
  ordersToCancel: number
  options: Array<{ settlement: CancelSettlement; wouldCredit: boolean; allowed: boolean }>
}

type EndLeaseDialogProps = {
  lease: LeaseSummary | null
  today?: string | null
  onClose: () => void
  onEnded: () => void
}

const SETTLEMENTS: CancelSettlement[] = ['prorate', 'credit_full', 'keep']

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

type LoadedPreview = EndPreview & { endsOn: string }

export function EndLeaseDialog({ lease, today, onClose, onEnded }: EndLeaseDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { send } = useLeaseMutation('property-management-lease-end')
  const [endsOn, setEndsOn] = React.useState(() => today ?? browserToday())
  const [dateTouched, setDateTouched] = React.useState(false)
  const [settlement, setSettlement] = React.useState<CancelSettlement | null>(null)
  const [loadedPreview, setPreview] = React.useState<LoadedPreview | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewAttempt, setPreviewAttempt] = React.useState(0)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const leaseId = lease?.id ?? null
  const leaseEndsOn = lease?.endsOn ?? null

  React.useEffect(() => {
    if (!leaseId) return
    setDateTouched(false)
    setSettlement(null)
    setError(null)
  }, [leaseId])

  React.useEffect(() => {
    if (!leaseId || !leaseEndsOn || dateTouched) return
    const current = today ?? browserToday()
    setEndsOn(current > leaseEndsOn ? leaseEndsOn : current)
  }, [dateTouched, leaseId, leaseEndsOn, today])

  React.useEffect(() => {
    setPreview(null)
    if (!leaseId || !ISO_DAY.test(endsOn)) return
    let cancelled = false
    const failed = (message?: string | null) => {
      if (cancelled) return
      setPreview(null)
      setPreviewError(message ?? t('property_management.leases.end.previewError', 'Could not check how the lease can be ended.'))
    }
    setPreviewError(null)
    apiCall<EndPreview & { error?: string }>(`/api/property_management/leases/${encodeURIComponent(leaseId)}/end?endsOn=${endsOn}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) {
          failed(call.result?.error)
          return
        }
        const loaded = call.result
        setPreview({ ...loaded, endsOn })
        setSettlement((current) => {
          const allowed = (value: CancelSettlement | null) => Boolean(value && loaded.options.find((option) => option.settlement === value)?.allowed)
          if (allowed(current)) return current
          if (allowed(loaded.defaultSettlement)) return loaded.defaultSettlement
          return loaded.options.find((option) => option.allowed)?.settlement ?? null
        })
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_end_preview_failed' })
        failed()
      })
    return () => {
      cancelled = true
    }
  }, [endsOn, leaseId, previewAttempt, t])

  const preview = loadedPreview && loadedPreview.endsOn === endsOn ? loadedPreview : null
  const tooLate = Boolean(lease && endsOn > lease.endsOn)
  const tooEarly = Boolean(lease && endsOn < lease.startsOn)
  const cancelBlocked = Boolean(preview && !preview.cancelAvailable && preview.ordersToCancel > 0)
  const settlementAllowed = Boolean(preview?.options.find((entry) => entry.settlement === settlement)?.allowed)
  const canConfirm = Boolean(lease && settlement && preview && settlementAllowed && !tooLate && !tooEarly && !pending && !cancelBlocked)

  const confirm = async () => {
    if (!lease || !settlement || !canConfirm) return
    setPending(true)
    setError(null)
    try {
      await send({
        leaseId: lease.id,
        optimisticLockUpdatedAt: lease.updatedAt,
        url: `/api/property_management/leases/${encodeURIComponent(lease.id)}/end`,
        method: 'POST',
        body: { endsOn, settlement },
        errorMessage: t('property_management.leases.end.error', 'Could not end the lease.'),
      })
      flash(t('property_management.leases.end.success', 'Lease end recorded. Sales applies the billing change in the background.'), 'success')
      onEnded()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        onClose()
        return
      }
      setError(readErrorMessage(err, t('property_management.leases.end.error', 'Could not end the lease.')))
    } finally {
      setPending(false)
    }
  }

  const option = (value: CancelSettlement) => preview?.options.find((entry) => entry.settlement === value)

  return (
    <Dialog open={lease !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.leases.end.title', 'End lease {reference}', { reference: lease?.reference ?? '' })}</DialogTitle>
          <DialogDescription>
            {lease
              ? [lease.unitName, lease.companyName, `${formatDate(lease.startsOn, locale)} — ${formatDate(lease.endsOn, locale)}`, formatMoney(lease.monthlyRate, lease.currencyCode, locale)].filter(Boolean).join(' · ')
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pm-lease-end-date">{t('property_management.leases.end.lastDay', 'Last day of the lease')}</Label>
            <Input id="pm-lease-end-date" type="date" value={endsOn} max={lease?.endsOn} onChange={(event) => { setDateTouched(true); setEndsOn(event.target.value) }} />
            <p className="text-sm text-muted-foreground">
              {tooLate
                ? t('property_management.leases.end.tooLate', 'The lease already ends on {date}. Extend it to make it longer.', { date: formatDate(lease?.endsOn, locale) })
                : t('property_management.leases.end.lastDayHint', 'Billing stops after this day. It may be in the past, today or later — for a later date, monthly invoices continue until then.')}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('property_management.leases.end.settlement', 'Settle the month already invoiced by…')}</legend>
            <RadioGroup value={settlement ?? ''} onValueChange={(value) => setSettlement(value as CancelSettlement)}>
              {SETTLEMENTS.map((value) => {
                const entry = option(value)
                const blocked = entry ? !entry.allowed : false
                return (
                  <RadioField
                    key={value}
                    value={value}
                    disabled={blocked}
                    label={t(`property_management.leases.end.option.${value}`, value)}
                    sublabel={preview?.defaultSettlement === value ? t('property_management.leases.end.default', 'Organization default') : undefined}
                    description={blocked
                      ? t('property_management.leases.end.needsCredit', 'Credits an invoice — needs the sales credit memo permission.')
                      : entry?.wouldCredit
                        ? t('property_management.leases.end.credits', 'Sales issues a credit memo.')
                        : t(`property_management.leases.end.optionHint.${value}`, '')}
                  />
                )
              })}
            </RadioGroup>
          </fieldset>
          {cancelBlocked ? (
            <Alert status="warning" data-testid="pm-lease-end-cancel-unavailable">
              <AlertDescription>
                {t('property_management.leases.end.cancelUnavailable', 'This lease cannot be ended early yet: this installation’s sales module cannot cancel recurring orders. It still ends automatically at term.')}
              </AlertDescription>
            </Alert>
          ) : null}
          {previewError ? (
            <Alert status="error" data-testid="pm-lease-end-preview-error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{previewError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setPreviewAttempt((value) => value + 1)}>
                  {t('property_management.common.retry', 'Try again')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? <Alert status="error">{error}</Alert> : null}
          <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('property_management.common.cancel', 'Cancel')}</Button>
          <Button type="button" variant="destructive-solid" disabled={!canConfirm} onClick={() => void confirm()}>
            {t('property_management.leases.end.confirm', 'End lease')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EndLeaseDialog
