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
import { formatDate, formatMoney, isSubmitShortcut, readErrorMessage, type CancelSettlement, type LeaseSummary } from './leaseModel'
import { useLeaseMutation } from './useLeaseMutation'

type EndPreview = {
  defaultSettlement: CancelSettlement
  canCredit: boolean
  cancelAvailable: boolean
  ordersToCancel: number
  options: Array<{ settlement: CancelSettlement; wouldCredit: boolean; allowed: boolean }>
}

type EndLeaseDialogProps = {
  lease: LeaseSummary | null
  onClose: () => void
  onEnded: () => void
}

const SETTLEMENTS: CancelSettlement[] = ['prorate', 'credit_full', 'keep']

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function EndLeaseDialog({ lease, onClose, onEnded }: EndLeaseDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { send } = useLeaseMutation('property-management-lease-end')
  const [endsOn, setEndsOn] = React.useState(today())
  const [settlement, setSettlement] = React.useState<CancelSettlement | null>(null)
  const [preview, setPreview] = React.useState<EndPreview | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!lease) return
    const initial = today() > lease.endsOn ? lease.endsOn : today()
    setEndsOn(initial)
    setSettlement(null)
    setError(null)
  }, [lease])

  React.useEffect(() => {
    if (!lease || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return
    let cancelled = false
    void apiCall<EndPreview>(`/api/property_management/leases/${encodeURIComponent(lease.id)}/end?endsOn=${endsOn}`).then((call) => {
      if (cancelled) return
      if (!call.ok || !call.result) {
        setPreview(null)
        return
      }
      const loaded = call.result
      setPreview(loaded)
      setSettlement((current) => {
        const allowed = (value: CancelSettlement | null) => Boolean(value && loaded.options.find((option) => option.settlement === value)?.allowed)
        if (allowed(current)) return current
        if (allowed(loaded.defaultSettlement)) return loaded.defaultSettlement
        return loaded.options.find((option) => option.allowed)?.settlement ?? null
      })
    })
    return () => {
      cancelled = true
    }
  }, [endsOn, lease])

  const tooLate = Boolean(lease && endsOn > lease.endsOn)
  const tooEarly = Boolean(lease && endsOn < lease.startsOn)
  const canConfirm = Boolean(lease && settlement && !tooLate && !tooEarly && !pending)

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
              ? `${lease.unitName ?? ''} · ${lease.companyName ?? ''} · ${formatDate(lease.startsOn, locale)} — ${formatDate(lease.endsOn, locale)} · ${formatMoney(lease.monthlyRate, lease.currencyCode, locale)}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pm-lease-end-date">{t('property_management.leases.end.lastDay', 'Last day of the lease')}</Label>
            <Input id="pm-lease-end-date" type="date" value={endsOn} max={lease?.endsOn} onChange={(event) => setEndsOn(event.target.value)} />
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
          {preview && !preview.cancelAvailable ? (
            <Alert status="information">
              <AlertDescription>
                {t('property_management.leases.end.cancelQueued', 'This installation’s sales module cannot cancel recurring orders yet. The end is recorded and the billing change stays pending until it can.')}
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
