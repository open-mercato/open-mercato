"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { CHARGE_KIND_FALLBACKS, CHARGE_KIND_VALUES } from '../lib/freightEnums'
import { formatFreightAmount } from './freightOptions'
import type { FreightTripRow } from './FreightTripsTable'

const ENTITY_ID = 'freight_operations:freight_trip'
const CONTEXT_ID = 'freight_operations.trips.charges'

export type TripChargeDraft = {
  id: string
  kind: string
  description: string
  quantity: string
  unitAmountNet: string
  isTaxable: boolean
  billable: boolean
}

export type TripChargeRow = {
  id: string
  kind: string
  description?: string | null
  quantity?: string | null
  unit_amount_net: string
  amount_net: string
  is_taxable?: boolean | null
  billable?: boolean | null
}

export function toChargeDrafts(rows: TripChargeRow[]): TripChargeDraft[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description ?? '',
    quantity: row.quantity === null || row.quantity === undefined ? '' : String(row.quantity),
    unitAmountNet: String(row.unit_amount_net ?? ''),
    isTaxable: row.is_taxable !== false,
    billable: row.billable !== false,
  }))
}

export function buildChargeDraft(): TripChargeDraft {
  return {
    id: `draft-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'waiting',
    description: '',
    quantity: '1',
    unitAmountNet: '',
    isTaxable: true,
    billable: true,
  }
}

/**
 * `set-charges` replaces the whole line set in one POST, so the dialog edits an
 * array rather than a form — CrudForm models a single record. The response
 * rewrites the trip's money columns, which is why the caller refetches both the
 * charges and the trip after saving.
 */
export function toChargesPayload(drafts: TripChargeDraft[]): Array<Record<string, unknown>> {
  return drafts.map((draft, index) => ({
    kind: draft.kind,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.quantity.trim() ? { quantity: draft.quantity.trim() } : {}),
    unitAmountNet: draft.unitAmountNet.trim() || '0',
    isTaxable: draft.isTaxable,
    billable: draft.billable,
    position: index,
  }))
}

export function chargesTotal(drafts: TripChargeDraft[]): number {
  return drafts.reduce((sum, draft) => {
    const amount = Number(draft.unitAmountNet)
    if (!Number.isFinite(amount)) return sum
    return sum + amount
  }, 0)
}

export function TripChargesDialog({
  trip,
  onOpenChange,
  onSaved,
}: {
  trip: FreightTripRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useT()
  const open = trip !== null
  const [drafts, setDrafts] = React.useState<TripChargeDraft[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!trip) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const call = await apiCallOrThrow<{ items?: TripChargeRow[] }>(
          `/api/freight_operations/trips/charges?tripId=${encodeURIComponent(trip.id)}`,
        )
        if (!cancelled) setDrafts(toChargeDrafts(call.result?.items ?? []))
      } catch (caught) {
        if (!cancelled) {
          setDrafts([])
          setError(caught instanceof Error && caught.message
            ? caught.message
            : t('freight_operations.trips.charges.loadError', 'Could not load the charge lines.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [trip, t])

  const updateDraft = React.useCallback((id: string, patch: Partial<TripChargeDraft>) => {
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }, [])

  const submit = React.useCallback(async () => {
    if (!trip) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(trip.updatedAt ?? trip.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/trips/set-charges', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: trip.id, charges: toChargesPayload(drafts) }),
          }, { errorMessage: t('freight_operations.trips.charges.saveError', 'Unable to save the charge lines.') }),
        ),
        mutationPayload: { operation: 'trips.set_charges', id: trip.id, updatedAt: trip.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: trip.id, retryLastMutation },
      })
      flash(t('freight_operations.trips.charges.saved', 'Charge lines saved.'), 'success')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.trips.charges.saveError', 'Unable to save the charge lines.'))
    }
  }, [drafts, onSaved, retryLastMutation, runMutation, t, trip])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  const currency = trip?.currency_code ?? 'SAR'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.trips.charges.title', 'Extra charges')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.trips.charges.description', 'Saving replaces this trip\'s charge lines. The trip totals follow the new set.')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingMessage label={t('freight_operations.trips.charges.loading', 'Loading charge lines…')} />
        ) : (
          <div className="flex flex-col gap-3">
            {drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('freight_operations.trips.charges.empty', 'No extra charges yet.')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {drafts.map((draft) => (
                  <div key={draft.id} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
                    <div className="sm:col-span-3">
                      <Select value={draft.kind} onValueChange={(value) => updateDraft(draft.id, { kind: value })}>
                        <SelectTrigger aria-label={t('freight_operations.trips.charges.kind', 'Kind')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHARGE_KIND_VALUES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`freight_operations.trips.charge_kind.${value}`, CHARGE_KIND_FALLBACKS[value] ?? value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-4">
                      <Input
                        value={draft.description}
                        onChange={(event) => updateDraft(draft.id, { description: event.target.value })}
                        placeholder={t('freight_operations.trips.charges.descriptionPlaceholder', 'Description')}
                        aria-label={t('freight_operations.trips.charges.descriptionLabel', 'Description')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        value={draft.quantity}
                        onChange={(event) => updateDraft(draft.id, { quantity: event.target.value })}
                        placeholder={t('freight_operations.trips.charges.quantity', 'Qty')}
                        aria-label={t('freight_operations.trips.charges.quantity', 'Qty')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        value={draft.unitAmountNet}
                        onChange={(event) => updateDraft(draft.id, { unitAmountNet: event.target.value })}
                        placeholder={t('freight_operations.trips.charges.unitAmount', 'Unit (net)')}
                        aria-label={t('freight_operations.trips.charges.unitAmount', 'Unit (net)')}
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDrafts((prev) => prev.filter((entry) => entry.id !== draft.id))}
                      >
                        {t('freight_operations.trips.charges.remove', 'Remove')}
                      </Button>
                    </div>
                    <div className="sm:col-span-12 flex flex-wrap items-center gap-4 ps-0 sm:ps-1">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={draft.isTaxable}
                          onCheckedChange={(checked) => updateDraft(draft.id, { isTaxable: checked === true })}
                        />
                        {t('freight_operations.trips.charges.isTaxable', 'Taxable')}
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={draft.billable}
                          onCheckedChange={(checked) => updateDraft(draft.id, { billable: checked === true })}
                        />
                        {t('freight_operations.trips.charges.billable', 'Billable')}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((prev) => [...prev, buildChargeDraft()])}>
                {t('freight_operations.trips.charges.add', 'Add charge')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('freight_operations.trips.charges.total', 'Charges total (net): {amount}', {
                  amount: formatFreightAmount(chargesTotal(drafts), currency),
                })}
              </span>
            </div>

            {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.trips.charges.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={loading} onClick={() => { void submit() }}>
            {t('freight_operations.trips.charges.submit', 'Save charges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
