"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRightSquare, Loader2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import type { DealSummary, SectionAction, TabEmptyState, Translator } from './types'
import { formatDate } from './utils'

export type DealsSectionProps = {
  deals: DealSummary[]
  onCreate: (payload: {
    title: string
    status?: string
    pipelineStage?: string
    valueAmount?: number
    valueCurrency?: string
    probability?: number
    expectedCloseAt?: string
    description?: string
  }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
}

type DealDraft = {
  title: string
  status: string
  pipelineStage: string
  valueAmount: string
  valueCurrency: string
  probability: string
  expectedCloseAt: string
  description: string
}

const DEFAULT_DRAFT: DealDraft = {
  title: '',
  status: '',
  pipelineStage: '',
  valueAmount: '',
  valueCurrency: '',
  probability: '',
  expectedCloseAt: '',
  description: '',
}

export function DealsSection({
  deals,
  onCreate,
  isSubmitting,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
}: DealsSectionProps) {
  const tHook = useT()
  const t: Translator = React.useMemo(
    () => translator ?? ((key, fallback) => {
      const value = tHook(key)
      return value === key && fallback ? fallback : value
    }),
    [translator, tHook],
  )

  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [draft, setDraft] = React.useState<DealDraft>(DEFAULT_DRAFT)

  const openDialog = React.useCallback(() => setOpen(true), [])

  const resetDraft = React.useCallback(() => {
    setDraft(DEFAULT_DRAFT)
  }, [])

  const closeDialog = React.useCallback(() => {
    resetDraft()
    setOpen(false)
    setSaving(false)
  }, [resetDraft])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [addActionLabel, isSubmitting, onActionChange, openDialog])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (saving || isSubmitting) return
      const trimmedTitle = draft.title.trim()
      if (!trimmedTitle) {
        flash(t('customers.people.detail.deals.titleRequired', 'Deal name is required.'), 'error')
        return
      }
      const payload: DealsSectionProps['onCreate'] extends (arg: infer A) => unknown ? A : never = {
        title: trimmedTitle,
      }
      const pushNumber = (input: string): number | undefined => {
        if (!input.trim()) return undefined
        const parsed = Number(input.trim())
        return Number.isNaN(parsed) ? undefined : parsed
      }
      const status = draft.status.trim()
      if (status) payload.status = status
      const stage = draft.pipelineStage.trim()
      if (stage) payload.pipelineStage = stage
      const valueAmount = pushNumber(draft.valueAmount)
      if (typeof valueAmount === 'number') payload.valueAmount = valueAmount
      const currency = draft.valueCurrency.trim().toUpperCase()
      if (currency) payload.valueCurrency = currency
      const probability = pushNumber(draft.probability)
      if (typeof probability === 'number') payload.probability = probability
      if (draft.expectedCloseAt) payload.expectedCloseAt = draft.expectedCloseAt
      const description = draft.description.trim()
      if (description) payload.description = description

      setSaving(true)
      try {
        await onCreate(payload)
        closeDialog()
      } catch {
        // surface handled upstream
        setSaving(false)
      }
    },
    [closeDialog, draft, isSubmitting, onCreate, saving, t],
  )

  const dialogTitle = t('customers.people.detail.deals.addTitle', 'Add deal')

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {deals.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          deals.map((deal) => {
            const valueLabel =
              deal.valueAmount && deal.valueCurrency
                ? `${deal.valueAmount} ${deal.valueCurrency}`
                : emptyLabel
            const expectedLabel = deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) ?? emptyLabel : emptyLabel
            return (
              <article key={deal.id} className="rounded-lg border bg-card p-4 shadow-xs transition hover:border-border/80">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{deal.title}</h3>
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {deal.status ?? emptyLabel}
                  </span>
                </header>
                <dl className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex flex-col gap-0.5">
                    <dt className="font-medium">{t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}</dt>
                    <dd>{deal.pipelineStage ?? emptyLabel}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="font-medium">{t('customers.people.detail.deals.fields.probability', 'Probability')}</dt>
                    <dd>{typeof deal.probability === 'number' ? `${deal.probability}%` : emptyLabel}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="font-medium">{t('customers.people.detail.deals.fields.valueAmount', 'Value')}</dt>
                    <dd>{valueLabel}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="font-medium">{t('customers.people.detail.deals.fields.expectedCloseAt', 'Expected close')}</dt>
                    <dd>{expectedLabel}</dd>
                  </div>
                </dl>
                <div className="mt-3 text-xs">
                  <Link
                    href={`/backend/customers/deals/${encodeURIComponent(deal.id)}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ArrowUpRightSquare className="h-3.5 w-3.5" aria-hidden />
                    {t('customers.people.detail.deals.openDeal', 'Open deal')}
                  </Link>
                </div>
              </article>
            )
          })
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog(); else setOpen(next) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="deal-title">
                {t('customers.people.detail.deals.fields.title', 'Title')}
              </label>
              <input
                id="deal-title"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-status">
                  {t('customers.people.detail.deals.fields.status', 'Status')}
                </label>
                <input
                  id="deal-status"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-stage">
                  {t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}
                </label>
                <input
                  id="deal-stage"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.pipelineStage}
                  onChange={(event) => setDraft((prev) => ({ ...prev, pipelineStage: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-value">
                  {t('customers.people.detail.deals.fields.valueAmount', 'Amount')}
                </label>
                <input
                  id="deal-value"
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.valueAmount}
                  onChange={(event) => setDraft((prev) => ({ ...prev, valueAmount: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-currency">
                  {t('customers.people.detail.deals.fields.valueCurrency', 'Currency')}
                </label>
                <input
                  id="deal-currency"
                  className="w-full rounded-md border px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.valueCurrency}
                  onChange={(event) => setDraft((prev) => ({ ...prev, valueCurrency: event.target.value }))}
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-probability">
                  {t('customers.people.detail.deals.fields.probability', 'Probability')}
                </label>
                <input
                  id="deal-probability"
                  type="number"
                  min="0"
                  max="100"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.probability}
                  onChange={(event) => setDraft((prev) => ({ ...prev, probability: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-expected">
                  {t('customers.people.detail.deals.fields.expectedCloseAt', 'Expected close')}
                </label>
                <input
                  id="deal-expected"
                  type="date"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.expectedCloseAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, expectedCloseAt: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="deal-description">
                {t('customers.people.detail.deals.fields.description', 'Description')}
              </label>
              <textarea
                id="deal-description"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.description}
                onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving || isSubmitting}>
                {t('customers.people.detail.deals.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={saving || isSubmitting}>
                {saving || isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('customers.people.detail.deals.save', 'Save deal')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DealsSection
