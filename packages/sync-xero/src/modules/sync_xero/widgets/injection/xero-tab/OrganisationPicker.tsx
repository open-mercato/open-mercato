"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { asXeroHttpError, type XeroOrganisationsView, type XeroPreviousOrganisationView } from './types'

export type SaveOrganisationInput = { xeroOrganisationId: string; confirmChange?: boolean }

type PickerProps = {
  open: boolean
  scope: 'consent' | 'all'
  onOpenChange: (open: boolean) => void
  save: (input: SaveOrganisationInput) => Promise<void>
  onSaved: () => Promise<void>
}

type PickerStep =
  | { kind: 'choose' }
  | { kind: 'confirm'; nextName: string; previous: XeroPreviousOrganisationView[] }
  | { kind: 'blocked'; previous: XeroPreviousOrganisationView[] }

function defaultChoice(view: XeroOrganisationsView): string {
  const ids = new Set(view.organisations.map((organisation) => organisation.xeroOrganisationId))
  if (view.selected && ids.has(view.selected)) return view.selected
  const previous = view.previous.find((entry) => ids.has(entry.xeroOrganisationId))
  if (previous) return previous.xeroOrganisationId
  return view.organisations.length === 1 ? view.organisations[0].xeroOrganisationId : ''
}

export function OrganisationPicker({ open, scope, onOpenChange, save, onSaved }: PickerProps) {
  const t = useT()
  const [view, setView] = React.useState<XeroOrganisationsView | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [choice, setChoice] = React.useState('')
  const [step, setStep] = React.useState<PickerStep>({ kind: 'choose' })
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setView(null)
    setLoadError(null)
    setStep({ kind: 'choose' })
    void apiCall<XeroOrganisationsView & { error?: string }>(`/api/sync_xero/organisations?scope=${scope}`, undefined, { fallback: null }).then((call) => {
      if (cancelled) return
      if (call.ok && call.result) {
        setView(call.result)
        setChoice(defaultChoice(call.result))
      } else {
        setLoadError(call.result?.error ?? t('sync_xero.picker.loadFailed'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, scope, t])

  const describePrevious = React.useCallback(
    (entry: XeroPreviousOrganisationView, count: number) =>
      entry.name
        ? t('sync_xero.picker.previousNamed', { name: entry.name, count })
        : t('sync_xero.picker.previousUnknown', { id: entry.xeroOrganisationId, count }),
    [t],
  )

  const submit = React.useCallback(async () => {
    if (!choice || isSaving || step.kind === 'blocked') return
    setIsSaving(true)
    try {
      await save({ xeroOrganisationId: choice, confirmChange: step.kind === 'confirm' ? true : undefined })
      flash(t('sync_xero.picker.saved'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      const failure = asXeroHttpError(error)
      const nextName = view?.organisations.find((organisation) => organisation.xeroOrganisationId === choice)?.name ?? choice
      if (failure?.code === 'xero.organisation_change_confirmation_required') {
        setStep({ kind: 'confirm', nextName, previous: failure.previous ?? [] })
      } else if (failure?.code === 'xero.organisation_switch_blocked') {
        setStep({ kind: 'blocked', previous: failure.previous ?? [] })
      } else if (failure?.code === 'optimistic_lock_conflict') {
        onOpenChange(false)
        await onSaved()
      } else {
        flash(failure?.message ?? t('sync_xero.picker.saveFailed'), 'error')
      }
    } finally {
      setIsSaving(false)
    }
  }, [choice, isSaving, onOpenChange, onSaved, save, step.kind, t, view])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={onKeyDown} data-testid="sync-xero-organisation-picker">
        <DialogHeader>
          <DialogTitle>{t('sync_xero.picker.title')}</DialogTitle>
          <DialogDescription>{t('sync_xero.picker.description')}</DialogDescription>
        </DialogHeader>
        {!view && !loadError ? <LoadingMessage label={t('sync_xero.picker.loading')} /> : null}
        {loadError ? <ErrorMessage label={loadError} /> : null}
        {view && step.kind === 'choose' ? (
          view.organisations.length === 0 ? (
            <Alert status="warning">
              <AlertDescription>{t('sync_xero.picker.empty')}</AlertDescription>
            </Alert>
          ) : (
            <RadioGroup value={choice} onValueChange={setChoice}>
              {view.organisations.map((organisation) => (
                <RadioField key={organisation.xeroOrganisationId} value={organisation.xeroOrganisationId} label={organisation.name} />
              ))}
            </RadioGroup>
          )
        ) : null}
        {step.kind === 'confirm' ? (
          <Alert status="warning" size="default">
            <AlertTitle>{t('sync_xero.picker.confirm.title', { name: step.nextName })}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {step.previous.map((entry) => (
                  <li key={entry.xeroOrganisationId}>{describePrevious(entry, entry.companyCount ?? 0)}</li>
                ))}
              </ul>
              <p className="mt-2">{t('sync_xero.picker.confirm.description', { name: step.nextName })}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {step.kind === 'blocked' ? (
          <Alert status="error" size="default">
            <AlertTitle>{t('sync_xero.picker.blocked.title')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {step.previous.map((entry) => (
                  <li key={entry.xeroOrganisationId}>
                    {t('sync_xero.picker.blocked.invoices', {
                      name: entry.name ?? entry.xeroOrganisationId,
                      count: entry.invoiceCount ?? 0,
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-2">{t('sync_xero.picker.blocked.description')}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('sync_xero.picker.cancel')}
          </Button>
          {step.kind !== 'blocked' ? (
            <Button type="button" onClick={() => void submit()} disabled={!choice || isSaving || !view}>
              {step.kind === 'confirm' ? t('sync_xero.picker.confirm.submit') : t('sync_xero.picker.save')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
