"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { addDays, extensionAnchorDay, leaseEndsOn, respondByDate } from '../../lib/leaseTerm'
import { formatDate, formatMoney, isSubmitShortcut, readErrorMessage, type LeaseSummary } from './leaseModel'
import { useLeaseMutation } from './useLeaseMutation'

type ExtendLeaseDialogProps = {
  lease: LeaseSummary | null
  defaultExpiryDays: number
  onClose: () => void
  onExtended: () => void
}

function positiveInt(value: string): number | null {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

export function ExtendLeaseDialog({ lease, defaultExpiryDays, onClose, onExtended }: ExtendLeaseDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { send } = useLeaseMutation('property-management-lease-extend')
  const [months, setMonths] = React.useState('12')
  const [rate, setRate] = React.useState('')
  const [asProposal, setAsProposal] = React.useState(true)
  const [expiry, setExpiry] = React.useState(String(defaultExpiryDays))
  const [message, setMessage] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!lease) return
    setMonths('12')
    setRate(lease.monthlyRate ? String(Number(lease.monthlyRate)) : '')
    setAsProposal(true)
    setExpiry(String(defaultExpiryDays))
    setMessage('')
    setError(null)
  }, [defaultExpiryDays, lease])

  const monthCount = positiveInt(months)
  const expiryDays = positiveInt(expiry)
  const startsOn = lease ? addDays(lease.endsOn, 1) : null
  const endsOn = lease && startsOn && monthCount ? leaseEndsOn(startsOn, monthCount, extensionAnchorDay(lease.startsOn, startsOn)) : null
  const respondBy = expiryDays && expiryDays <= 90 ? respondByDate(expiryDays) : null
  const rateValue = Number(rate)
  const currentRate = lease?.monthlyRate ? Number(lease.monthlyRate) : null
  const delta = currentRate !== null && Number.isFinite(rateValue) ? rateValue - currentRate : null
  const canConfirm = Boolean(lease && monthCount && rateValue > 0 && (!asProposal || respondBy) && !pending)

  const confirm = async () => {
    if (!lease || !canConfirm) return
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { months: monthCount, monthlyRate: rateValue, asProposal }
      if (asProposal) {
        body.expiresInDays = expiryDays
        if (message.trim()) body.message = message.trim()
      }
      await send({
        leaseId: lease.id,
        optimisticLockUpdatedAt: lease.updatedAt,
        url: `/api/property_management/leases/${encodeURIComponent(lease.id)}/extensions`,
        method: 'POST',
        body,
        errorMessage: t('property_management.leases.extend.error', 'Could not extend the lease.'),
      })
      flash(
        asProposal
          ? t('property_management.leases.extend.proposed', 'Extension proposal recorded. The quote is being created and sent.')
          : t('property_management.leases.extend.success', 'Extension recorded. The lease end moves once its sales order exists.'),
        'success',
      )
      onExtended()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        onClose()
        return
      }
      setError(readErrorMessage(err, t('property_management.leases.extend.error', 'Could not extend the lease.')))
    } finally {
      setPending(false)
    }
  }

  const rateText = formatMoney(rateValue > 0 ? rateValue : null, lease?.currencyCode, locale)
  const deltaText = delta !== null && delta !== 0 && currentRate
    ? `${delta > 0 ? '+' : ''}${formatMoney(delta, lease?.currencyCode, locale)} (${delta > 0 ? '+' : ''}${Math.round((delta / currentRate) * 1000) / 10}%)`
    : null

  return (
    <Dialog open={lease !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl" onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.leases.extend.title', 'Extend lease')}</DialogTitle>
          <DialogDescription>
            {lease ? `${lease.reference} · ${lease.unitName ?? ''} · ${lease.companyName ?? ''}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('property_management.leases.extend.current', 'Current term: {start} — {end} · {rate}', {
                start: formatDate(lease?.startsOn, locale),
                end: formatDate(lease?.endsOn, locale),
                rate: formatMoney(lease?.monthlyRate, lease?.currencyCode, locale),
              })}
            </p>
            <CheckboxField
              checked={asProposal}
              onCheckedChange={(value) => setAsProposal(value === true)}
              label={t('property_management.leases.extend.asProposal', 'Send as a proposal')}
              description={t('property_management.leases.extend.asProposalHint', 'Creates a sales quote for the new term; the tenant approves or declines it in their portal.')}
            />
            <div className="space-y-1">
              <Label htmlFor="pm-extend-months">{t('property_management.leases.extend.months', 'Extend by (months)')}</Label>
              <Input id="pm-extend-months" type="number" min={1} value={months} onChange={(event) => setMonths(event.target.value)} />
              <p className="text-sm text-muted-foreground">
                {startsOn && endsOn
                  ? t('property_management.leases.extend.newTerm', 'New term: {start} — {end}', { start: formatDate(startsOn, locale), end: formatDate(endsOn, locale) })
                  : null}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-extend-rate">{t('property_management.leases.extend.rate', 'New monthly rate')}</Label>
              <Input id="pm-extend-rate" type="number" min={0} step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} />
              {deltaText ? <p className="text-sm text-muted-foreground">{deltaText}</p> : null}
            </div>
            {asProposal ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="pm-extend-expiry">{t('property_management.leases.form.expiresInDays', 'Proposal expires after (days)')}</Label>
                  <Input id="pm-extend-expiry" type="number" min={1} max={90} value={expiry} onChange={(event) => setExpiry(event.target.value)} />
                  <p className="text-sm text-muted-foreground">
                    {respondBy
                      ? t('property_management.leases.extend.respondBy', 'Respond by {date}. Settings default: {days} days.', { date: formatDate(respondBy, locale), days: defaultExpiryDays })
                      : t('property_management.leases.form.expiryRange', 'Between 1 and 90 days.')}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pm-extend-message">{t('property_management.leases.extend.message', 'Message to the tenant (optional)')}</Label>
                  <Textarea id="pm-extend-message" maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} />
                </div>
              </>
            ) : (
              <Alert status="information">
                <AlertTitle>{t('property_management.leases.extend.directTitle', 'The lease is extended straight away')}</AlertTitle>
                <AlertDescription>
                  {t('property_management.leases.extend.directBody', 'Saving creates the extension’s sales order in the background; once it exists the lease end moves to {date}.', { date: formatDate(endsOn, locale) })}
                </AlertDescription>
              </Alert>
            )}
            {error ? <Alert status="error">{error}</Alert> : null}
          </div>
          {asProposal ? (
            <Card data-testid="pm-extend-preview">
              <CardHeader>
                <CardTitle>{t('property_management.leases.extend.previewTitle', 'What the tenant will see')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{t('property_management.leases.extend.offer', 'Extension offer')} · {lease?.unitName ?? ''}</p>
                <p className="text-muted-foreground">{lease?.productName ?? ''}</p>
                {respondBy ? <p>{t('property_management.leases.list.respondBy', 'Respond by {date}', { date: formatDate(respondBy, locale) })}</p> : null}
                {startsOn && endsOn ? <p>{t('property_management.leases.extend.newTerm', 'New term: {start} — {end}', { start: formatDate(startsOn, locale), end: formatDate(endsOn, locale) })}</p> : null}
                <p>{t('property_management.leases.extend.previewRate', 'New monthly rate: {rate}', { rate: rateText })}{deltaText ? ` · ${deltaText}` : ''}</p>
                {message.trim() ? <p className="whitespace-pre-line text-muted-foreground">{message.trim()}</p> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('property_management.common.cancel', 'Cancel')}</Button>
          <Button type="button" disabled={!canConfirm} onClick={() => void confirm()}>
            {asProposal ? t('property_management.leases.extend.sendProposal', 'Send proposal') : t('property_management.leases.extend.confirm', 'Extend lease')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ExtendLeaseDialog
