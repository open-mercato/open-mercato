"use client"

import * as React from 'react'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

// Deal status values written by the kanban flow. These intentionally do NOT include 'closed'
// because the rest of the app only persists 'loose' for lost deals (see StatusFilterPopover
// notes). 'in_progress' is kept for backwards compatibility with quick-deals created from
// the previous version of this dialog.
const STATUS_OPTIONS = ['open', 'in_progress', 'win', 'loose'] as const
const CURRENCY_OPTIONS = ['PLN', 'EUR', 'USD', 'GBP'] as const

export type QuickDealContext = {
  pipelineId: string
  pipelineName: string
  pipelineStageId: string
  pipelineStageLabel: string
}

export type QuickDealCompanyOption = {
  id: string
  label: string
}

type QuickDealDialogProps = {
  open: boolean
  context: QuickDealContext | null
  onClose: () => void
  onCreated: () => void
  currentUserId?: string
  currentUserLabel?: string
  companies?: QuickDealCompanyOption[]
}

type QuickDealFormValues = {
  title: string
  valueAmount: number | null
  valueCurrency: (typeof CURRENCY_OPTIONS)[number]
  companyId: string
  status: (typeof STATUS_OPTIONS)[number]
  probability: number | null
  expectedCloseAt: string
  description: string
}

const QUICK_DEAL_CONTEXT_ID = 'customers-deals-kanban:quick-deal'

export function QuickDealDialog({
  open,
  context,
  onClose,
  onCreated,
  currentUserId,
  currentUserLabel,
  companies = [],
}: QuickDealDialogProps): React.ReactElement | null {
  const t = useT()
  // Re-mount CrudForm whenever the dialog opens so cleared state is consistently fresh.
  // We also key on `context?.pipelineStageId` so reopening from a different stage doesn't
  // reuse stale field values (the page passes a fresh stage in `context` each time).
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)
  React.useEffect(() => {
    if (open) setFormInstanceKey((c) => c + 1)
  }, [open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: QUICK_DEAL_CONTEXT_ID,
    blockedMessage: translateWithFallback(t, 'ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const titleRequiredMessage = translateWithFallback(
    t,
    'customers.deals.kanban.quickDeal.title.required',
    'Title is required.',
  )

  const formSchema = React.useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, titleRequiredMessage),
        valueAmount: z.number().min(0).nullable().optional(),
        valueCurrency: z.enum(CURRENCY_OPTIONS),
        companyId: z.string().optional(),
        status: z.enum(STATUS_OPTIONS),
        probability: z.number().min(0).max(100).nullable().optional(),
        expectedCloseAt: z.string().optional(),
        description: z.string().optional(),
      }),
      // Cast widens to QuickDealFormValues so CrudForm's TValues generic stays exact.
    [titleRequiredMessage],
  ) as unknown as z.ZodType<QuickDealFormValues>

  const initialValues = React.useMemo<Partial<QuickDealFormValues>>(
    () => ({
      title: '',
      valueAmount: null,
      valueCurrency: 'PLN',
      companyId: '',
      status: 'open',
      probability: 25,
      expectedCloseAt: '',
      description: '',
    }),
    [],
  )

  const fields = React.useMemo<CrudField[]>(
    () => {
      const list: CrudField[] = [
        {
          // CrudForm auto-focuses the first field of the first group on mount; we don't
          // need (and CrudField doesn't accept) an explicit `autoFocus` prop here.
          id: 'title',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.title.label', 'Deal title'),
          type: 'text',
          required: true,
          placeholder: translateWithFallback(
            t,
            'customers.deals.kanban.quickDeal.title.placeholder',
            'e.g. Q3 Expansion — Lighting Package',
          ),
        },
        {
          id: 'valueAmount',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.value', 'Value'),
          type: 'number',
          layout: 'half',
          placeholder: '0',
        },
        {
          id: 'valueCurrency',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.currency', 'Currency'),
          type: 'select',
          layout: 'half',
          options: CURRENCY_OPTIONS.map((code) => ({ value: code, label: code })),
        },
        {
          id: 'companyId',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.company', 'Company'),
          type: 'select',
          placeholder: translateWithFallback(
            t,
            'customers.deals.kanban.quickDeal.companyPh',
            'Pick a company or add new…',
          ),
          options: [
            { value: '', label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.companyPh', 'Pick a company or add new…') },
            ...companies.map((c) => ({ value: c.id, label: c.label })),
          ],
        },
      ]
      // Owner is read-only display of the current user (mirrors original UX). Hidden when
      // we don't know the user — avoids confusing empty avatar cell.
      if (currentUserLabel) {
        list.push({
          id: 'owner',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.owner', 'Owner'),
          type: 'custom',
          readOnly: true,
          component: () => (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">
              <Avatar label={currentUserLabel} size="sm" />
              <span>{currentUserLabel}</span>
            </div>
          ),
        })
      }
      // Progressive disclosure: status + probability + close date + description live in
      // a separate "More details" group with `defaultExpanded: false` (configured via
      // collapsibleGroups on the host CrudForm).
      list.push(
        {
          id: 'status',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.status', 'Status'),
          type: 'select',
          options: STATUS_OPTIONS.map((v) => ({ value: v, label: v })),
        },
        {
          id: 'probability',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.probability', 'Probability'),
          type: 'number',
          layout: 'half',
          placeholder: '25',
        },
        {
          id: 'expectedCloseAt',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.expectedClose', 'Expected close'),
          type: 'date',
          layout: 'half',
        },
        {
          id: 'description',
          label: translateWithFallback(t, 'customers.deals.kanban.quickDeal.description', 'Description'),
          type: 'textarea',
          rows: 3,
          placeholder: translateWithFallback(
            t,
            'customers.deals.kanban.quickDeal.description.placeholder',
            'Short context, decision makers or next steps. Markdown supported.',
          ),
        },
      )
      return list
    },
    [companies, currentUserLabel, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        // No title — keep the basic section flush with the dialog header.
        fields: ['title', 'valueAmount', 'valueCurrency', 'companyId', ...(currentUserLabel ? ['owner'] : [])],
      },
      {
        id: 'more',
        title: translateWithFallback(
          t,
          'customers.deals.kanban.quickDeal.more',
          'More details (probability, close date, description)',
        ),
        fields: ['status', 'probability', 'expectedCloseAt', 'description'],
      },
    ],
    [currentUserLabel, t],
  )

  const handleSubmit = React.useCallback(
    async (values: QuickDealFormValues) => {
      if (!context) return
      const trimmedTitle = values.title.trim()
      if (!trimmedTitle.length) {
        throw createCrudFormError(titleRequiredMessage, { title: titleRequiredMessage })
      }
      const payload: Record<string, unknown> = {
        title: trimmedTitle,
        pipelineId: context.pipelineId,
        pipelineStageId: context.pipelineStageId,
        valueCurrency: values.valueCurrency,
      }
      if (typeof values.valueAmount === 'number' && Number.isFinite(values.valueAmount)) {
        payload.valueAmount = values.valueAmount
      }
      if (currentUserId) payload.ownerUserId = currentUserId
      if (values.companyId) payload.companyIds = [values.companyId]
      if (values.status) payload.status = values.status
      if (typeof values.probability === 'number' && Number.isFinite(values.probability)) {
        payload.probability = values.probability
      }
      if (values.expectedCloseAt && values.expectedCloseAt.trim().length) {
        payload.expectedCloseAt = values.expectedCloseAt
      }
      if (values.description && values.description.trim().length) {
        payload.description = values.description
      }
      const operation = () =>
        createCrud('customers/deals', payload, {
          errorMessage: translateWithFallback(t, 'customers.deals.create.error', 'Failed to create deal.'),
        })
      await runMutation({
        operation,
        context: {
          formId: QUICK_DEAL_CONTEXT_ID,
          resourceKind: 'customers.deal',
          retryLastMutation,
        },
      })
      flash(
        translateWithFallback(
          t,
          'customers.deals.kanban.quickDeal.success',
          'Deal added to {stage}.',
          { stage: context.pipelineStageLabel },
        ),
        'success',
      )
      onCreated()
      onClose()
    },
    [context, currentUserId, onClose, onCreated, retryLastMutation, runMutation, t, titleRequiredMessage],
  )

  if (!context) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translateWithFallback(t, 'customers.deals.kanban.quickDeal.title', 'Quick deal')}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.kanban.quickDeal.context',
              'Pipeline: {pipeline} · Stage: {stage}',
              { pipeline: context.pipelineName, stage: context.pipelineStageLabel },
            )}
          </DialogDescription>
        </DialogHeader>

        <CrudForm<QuickDealFormValues>
          key={`${context.pipelineStageId}:${formInstanceKey}`}
          embedded
          fields={fields}
          groups={groups}
          // The "More details" group starts collapsed; users can expand to set
          // status / probability / close date / description. Mirrors the previous
          // "+ More details" toggle.
          collapsibleGroups={{ pageType: 'customers.deals.kanban.quickDeal' }}
          initialValues={initialValues}
          schema={formSchema}
          submitLabel={translateWithFallback(t, 'customers.deals.kanban.quickDeal.submit', 'Add deal')}
          onSubmit={handleSubmit}
          extraActions={
            <Button type="button" variant="outline" onClick={onClose}>
              {translateWithFallback(t, 'customers.deals.kanban.quickDeal.cancel', 'Cancel')}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export default QuickDealDialog
