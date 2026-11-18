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
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { usePlural } from '../plural'
import { addDays, extensionAnchorDay, leaseEndsOn, respondByDate } from '../../lib/leaseTerm'
import { formatDate, formatMoney, formatPercent, isSubmitShortcut, readErrorMessage, type LeaseSummary } from './leaseModel'
import { useLeaseMutation } from './useLeaseMutation'

type ExtendLeaseDialogProps = {
  lease: LeaseSummary | null
  defaultExpiryDays: number | null
  onClose: () => void
  onExtended: () => void
}

const INLINE_FIELDS = ['months', 'monthlyRate', 'expiresInDays', 'message'] as const
type InlineField = typeof INLINE_FIELDS[number]
type InlineFieldErrors = Partial<Record<InlineField, string>>

function splitFieldErrors(err: unknown): { inline: InlineFieldErrors; hasOther: boolean } {
  const { fieldErrors } = mapCrudServerErrorToFormErrors(err)
  const inline: InlineFieldErrors = {}
  let hasOther = false
  for (const [field, message] of Object.entries(fieldErrors ?? {})) {
    const known = INLINE_FIELDS.find((entry) => entry === field)
    if (known) inline[known] = message
    else hasOther = true
  }
  return { inline, hasOther }
}

function positiveInt(value: string): number | null {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

export function ExtendLeaseDialog({ lease, defaultExpiryDays, onClose, onExtended }: ExtendLeaseDialogProps) {
  const t = useT()
  const { plural } = usePlural()
  const locale = useLocale()
  const { send } = useLeaseMutation('property-management-lease-extend')
  const [months, setMonths] = React.useState('12')
  const [rate, setRate] = React.useState('')
  const [asProposal, setAsProposal] = React.useState(true)
  const [expiry, setExpiry] = React.useState(defaultExpiryDays === null ? '' : String(defaultExpiryDays))
  const [message, setMessage] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<InlineFieldErrors>({})

  const leaseId = lease?.id ?? null
  const leaseRate = lease?.monthlyRate ?? null

  React.useEffect(() => {
    if (!leaseId) return
    setMonths('12')
    setRate(leaseRate ? String(Number(leaseRate)) : '')
    setAsProposal(true)
    setMessage('')
    setError(null)
    setFieldErrors({})
  }, [leaseId, leaseRate])

  React.useEffect(() => {
    if (!leaseId) return
    setExpiry(defaultExpiryDays === null ? '' : String(defaultExpiryDays))
  }, [defaultExpiryDays, leaseId])

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
    setFieldErrors({})
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
      const { inline, hasOther } = splitFieldErrors(err)
      setFieldErrors(inline)
      if (hasOther || !Object.keys(inline).length) {
        setError(readErrorMessage(err, t('property_management.leases.extend.error', 'Could not extend the lease.')))
      }
    } finally {
      setPending(false)
    }
  }

  const rateText = formatMoney(rateValue > 0 ? rateValue : null, lease?.currencyCode, locale)
  const deltaText = delta !== null && delta !== 0 && currentRate
    ? t('property_management.leases.extend.rateDelta', '{amount} ({percent})', {
        amount: formatMoney(delta, lease?.currencyCode, locale, { signDisplay: 'exceptZero' }),
        percent: formatPercent(delta / currentRate, locale, { signDisplay: 'exceptZero' }),
      })
    : null

  return (
    <Dialog open={lease !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl" onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.leases.extend.title', 'Extend lease')}</DialogTitle>
          <DialogDescription>
            {lease ? [lease.reference, lease.unitName, lease.companyName].filter(Boolean).join(' · ') : ''}
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
              <Input id="pm-extend-months" type="number" min={1} value={months} aria-invalid={fieldErrors.months ? true : undefined} onChange={(event) => setMonths(event.target.value)} />
              {fieldErrors.months ? <p className="text-sm text-status-error-text" data-testid="pm-extend-months-error">{fieldErrors.months}</p> : null}
              <p className="text-sm text-muted-foreground">
                {startsOn && endsOn
                  ? t('property_management.leases.extend.newTerm', 'New term: {start} — {end}', { start: formatDate(startsOn, locale), end: formatDate(endsOn, locale) })
                  : null}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-extend-rate">{t('property_management.leases.extend.rate', 'New monthly rate')}</Label>
              <Input id="pm-extend-rate" type="number" min={0} step="0.01" value={rate} aria-invalid={fieldErrors.monthlyRate ? true : undefined} onChange={(event) => setRate(event.target.value)} />
              {fieldErrors.monthlyRate ? <p className="text-sm text-status-error-text" data-testid="pm-extend-rate-error">{fieldErrors.monthlyRate}</p> : null}
              {deltaText ? <p className="text-sm text-muted-foreground">{deltaText}</p> : null}
            </div>
            {asProposal ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="pm-extend-expiry">{t('property_management.leases.form.expiresInDays', 'Proposal expires after (days)')}</Label>
                  <Input id="pm-extend-expiry" type="number" min={1} max={90} value={expiry} aria-invalid={fieldErrors.expiresInDays ? true : undefined} onChange={(event) => setExpiry(event.target.value)} />
                  {fieldErrors.expiresInDays ? <p className="text-sm text-status-error-text" data-testid="pm-extend-expiry-error">{fieldErrors.expiresInDays}</p> : null}
                  <p className="text-sm text-muted-foreground">
                    {respondBy
                      ? defaultExpiryDays === null
                        ? t('property_management.leases.extend.respondByOnly', 'Respond by {date}.', { date: formatDate(respondBy, locale) })
                        : plural('property_management.leases.extend.respondBy', 'Respond by {date}. Settings default: {count} days.', defaultExpiryDays, { date: formatDate(respondBy, locale) })
                      : t('property_management.leases.form.expiryRange', 'Between 1 and 90 days.')}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pm-extend-message">{t('property_management.leases.extend.message', 'Message to the tenant (optional)')}</Label>
                  <Textarea id="pm-extend-message" maxLength={4000} value={message} aria-invalid={fieldErrors.message ? true : undefined} onChange={(event) => setMessage(event.target.value)} />
                  {fieldErrors.message ? <p className="text-sm text-status-error-text" data-testid="pm-extend-message-error">{fieldErrors.message}</p> : null}
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
