// @ts-nocheck

"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { normalizeCustomFieldResponse, normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { DictionaryEntrySelect, type DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useT } from '@/lib/i18n/context'
import type { SalesAdjustmentKind } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type AdjustmentFormState = {
  id?: string
  label: string
  code: string
  kind: SalesAdjustmentKind
  calculatorKey: string
  rate: string
  amountNet: string
  amountGross: string
  position: string
  customFieldSetId?: string | null
}

export type AdjustmentRowData = {
  id: string
  label: string | null
  code: string | null
  kind: SalesAdjustmentKind
  calculatorKey: string | null
  rate: number | null
  amountNet: number | null
  amountGross: number | null
  currencyCode: string | null
  position: number
  customFields?: Record<string, unknown> | null
  customFieldSetId?: string | null
}

export type AdjustmentSubmitPayload = {
  id?: string
  label: string | null
  code: string | null
  kind: SalesAdjustmentKind
  calculatorKey: string | null
  rate?: number | null
  amountNet?: number | null
  amountGross?: number | null
  position?: number | null
  currencyCode: string
  customFields?: Record<string, unknown> | null
}

type AdjustmentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
  kindOptions: DictionaryOption[]
  loadKindOptions: () => Promise<DictionaryOption[]>
  labels: {
    addTitle: string
    editTitle: string
    submitCreate: string
    submitUpdate: string
  }
  initialAdjustment?: AdjustmentRowData | null
  onSubmit: (payload: AdjustmentSubmitPayload) => Promise<void>
}

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}

function prefixCustomFieldValues(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalized = key.startsWith('cf_') ? key : `cf_${key}`
    acc[normalized] = value
    return acc
  }, {})
}

export function AdjustmentDialog({
  open,
  onOpenChange,
  kind,
  currencyCode,
  kindOptions,
  loadKindOptions,
  labels,
  initialAdjustment,
  onSubmit,
}: AdjustmentDialogProps) {
  const t = useT()
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const entityId = kind === 'order' ? E.sales.sales_order_adjustment : E.sales.sales_quote_adjustment
  const initialMode: 'rate' | 'amount' =
    initialAdjustment?.rate && Number.isFinite(initialAdjustment.rate) ? 'rate' : 'amount'
  const [mode, setMode] = React.useState<'rate' | 'amount'>(initialMode)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [initialValues, setInitialValues] = React.useState<AdjustmentFormState>(() => ({
    id: undefined,
    label: '',
    code: '',
    kind: (kindOptions[0]?.value as SalesAdjustmentKind) ?? 'custom',
    calculatorKey: '',
    rate: '',
    amountNet: '',
    amountGross: '',
    position: '',
    customFieldSetId: null,
  }))

  React.useEffect(() => {
    if (!open) return
    const next: AdjustmentFormState = {
      id: initialAdjustment?.id,
      label: initialAdjustment?.label ?? '',
      code: initialAdjustment?.code ?? '',
      kind: initialAdjustment?.kind ?? (kindOptions[0]?.value as SalesAdjustmentKind) ?? 'custom',
      calculatorKey: initialAdjustment?.calculatorKey ?? '',
      rate: initialAdjustment?.rate ?? '',
      amountNet: initialAdjustment?.amountNet ?? '',
      amountGross: initialAdjustment?.amountGross ?? '',
      position: initialAdjustment?.position ?? '',
      customFieldSetId: initialAdjustment?.customFieldSetId ?? null,
    }
    const customValues = prefixCustomFieldValues(
      normalizeCustomFieldResponse(initialAdjustment?.customFields) ?? {}
    )
    setInitialValues({ ...next, ...customValues })
    setMode(
      initialAdjustment?.rate && Number.isFinite(initialAdjustment.rate) ? 'rate' : 'amount'
    )
    setFormResetKey((prev) => prev + 1)
  }, [initialAdjustment, kindOptions, open])

  const fields = React.useMemo<CrudField<AdjustmentFormState>[]>(() => {
    const percentSuffix = (
      <div className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm font-semibold text-muted-foreground">
        %
      </div>
    )
    return [
      {
        id: 'label',
        label: t('sales.documents.adjustments.label', 'Label'),
        type: 'text',
        placeholder: t('sales.documents.adjustments.labelPlaceholder', 'e.g. Shipping fee'),
        required: true,
      },
      {
        id: 'code',
        label: t('sales.documents.adjustments.code', 'Code'),
        type: 'text',
        placeholder: t('sales.documents.adjustments.codePlaceholder', 'PROMO10'),
      },
      {
        id: 'kind',
        label: t('sales.documents.adjustments.kindLabel', 'Kind'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => (
          <DictionaryEntrySelect
            value={typeof value === 'string' ? value : undefined}
            onChange={(next) => setValue(next ?? 'custom')}
            fetchOptions={loadKindOptions}
            allowInlineCreate={false}
            manageHref="/backend/config/sales#adjustment-kinds"
            selectClassName="w-full"
            labels={{
              placeholder: t('sales.documents.adjustments.kindSelect.placeholder', 'Select adjustment kind…'),
              addLabel: t('sales.config.adjustmentKinds.actions.add', 'Add adjustment kind'),
              addPrompt: t(
                'sales.config.adjustmentKinds.dialog.createDescription',
                'Define a reusable adjustment kind shown in document adjustment dialogs.'
              ),
              dialogTitle: t('sales.config.adjustmentKinds.dialog.createTitle', 'Create adjustment kind'),
              valueLabel: t('sales.config.adjustmentKinds.form.codeLabel', 'Code'),
              valuePlaceholder: t('sales.config.adjustmentKinds.form.codePlaceholder', 'e.g. discount'),
              labelLabel: t('sales.config.adjustmentKinds.form.labelLabel', 'Label'),
              labelPlaceholder: t('sales.config.adjustmentKinds.form.labelPlaceholder', 'e.g. Discount'),
              emptyError: t('sales.config.adjustmentKinds.errors.required', 'Code is required.'),
              cancelLabel: t('ui.actions.cancel', 'Cancel'),
              saveLabel: t('ui.actions.save', 'Save'),
              saveShortcutHint: t('ui.actions.saveShortcut', 'Cmd/Ctrl + Enter'),
              successCreateLabel: t('sales.config.adjustmentKinds.messages.created', 'Adjustment kind created.'),
              errorLoad: t('sales.config.adjustmentKinds.errors.load', 'Failed to load adjustment kinds.'),
              errorSave: t('sales.config.adjustmentKinds.errors.save', 'Failed to save adjustment kind.'),
              loadingLabel: t('sales.config.adjustmentKinds.loading', 'Loading adjustment kinds…'),
              manageTitle: t('sales.config.adjustmentKinds.title', 'Adjustment kinds'),
            }}
            showLabelInput={false}
          />
        ),
      },
      {
        id: 'calculatorKey',
        label: t('sales.documents.adjustments.calculatorKey', 'Calculator key'),
        type: 'text',
        placeholder: 'optional',
      },
      {
        id: 'mode',
        label: t('sales.documents.adjustments.amountMode', 'Calculation mode'),
        type: 'custom',
        component: () => (
          <div className="inline-flex rounded-md border bg-muted/40 p-1 text-sm font-medium">
            {(['rate', 'amount'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded px-3 py-1 transition-colors ${
                  mode === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
                onClick={() => {
                  setMode(option)
                  if (option === 'rate') {
                    const form = dialogContentRef.current?.querySelector('form')
                    const rateInput = form?.querySelector<HTMLInputElement>('input[name="rate"]')
                    rateInput?.focus()
                  }
                }}
              >
                {option === 'rate'
                  ? t('sales.documents.adjustments.mode.rate', 'Percentage')
                  : t('sales.documents.adjustments.mode.amount', 'Fixed amount')}
              </button>
            ))}
          </div>
        ),
      },
      {
        id: 'rate',
        label: t('sales.documents.adjustments.rate', 'Rate'),
        type: 'custom',
        placeholder: '0.00',
        required: mode === 'rate',
        component: ({ value, setValue }) => (
          <div className="flex items-center">
            <Input
              value={typeof value === 'string' ? value : value == null ? '' : String(value)}
              onChange={(event) => setValue(event.target.value)}
              placeholder="0.00"
              disabled={mode !== 'rate'}
              className="rounded-r-none"
            />
            {percentSuffix}
          </div>
        ),
      },
      {
        id: 'amountNet',
        label: t('sales.documents.adjustments.amountNet', 'Net amount'),
        type: 'number',
        placeholder: '0.00',
        required: mode === 'amount',
        disabled: mode !== 'amount',
        layout: 'half',
      },
      {
        id: 'amountGross',
        label: t('sales.documents.adjustments.amountGross', 'Gross amount'),
        type: 'number',
        placeholder: '0.00',
        disabled: mode !== 'amount',
        layout: 'half',
      },
      {
        id: 'position',
        label: t('sales.documents.adjustments.position', 'Position'),
        type: 'number',
        placeholder: '0',
      },
      {
        id: 'currencyDisplay',
        label: t('sales.documents.adjustments.currency', 'Currency'),
        type: 'custom',
        component: () => (
          <Badge variant="outline" className="px-3 py-2 text-sm font-semibold">
            {currencyCode ? currencyCode.toUpperCase() : t('sales.documents.adjustments.currencyPlaceholder', 'e.g. USD')}
          </Badge>
        ),
      },
    ]
  }, [currencyCode, loadKindOptions, mode, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      { id: 'adjustment-core', fields },
      {
        id: 'adjustment-custom',
        column: 2,
        title: t('entities.customFields.title', 'Custom fields'),
        kind: 'customFields',
      },
    ]
  }, [fields, t])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const resolvedCurrency = currencyCode ? currencyCode.toUpperCase() : ''
      if (!resolvedCurrency || resolvedCurrency.length !== 3) {
        throw createCrudFormError(
          t('sales.documents.adjustments.errorCurrency', 'Currency is required.'),
          { currencyCode: t('sales.documents.adjustments.errorCurrency', 'Currency is required.') }
        )
      }
      const label = typeof values.label === 'string' ? values.label.trim() : ''
      if (!label.length) {
        throw createCrudFormError(
          t('sales.documents.adjustments.labelRequired', 'Label is required.'),
          { label: t('sales.documents.adjustments.labelRequired', 'Label is required.') }
        )
      }
      const rateValue = normalizeNumber(values.rate)
      const amountNet = normalizeNumber(values.amountNet)
      const amountGross = normalizeNumber(values.amountGross)
      if (mode === 'rate') {
        if (!Number.isFinite(rateValue)) {
          throw createCrudFormError(
            t('sales.documents.adjustments.errorRate', 'Enter a percentage rate.'),
            { rate: t('sales.documents.adjustments.errorRate', 'Enter a percentage rate.') }
          )
        }
      } else {
        if (!Number.isFinite(amountNet) && !Number.isFinite(amountGross)) {
          throw createCrudFormError(
            t('sales.documents.adjustments.errorAmount', 'Provide at least one amount.'),
            { amountNet: t('sales.documents.adjustments.errorAmount', 'Provide at least one amount.') }
          )
        }
      }
      const customFields = collectCustomFieldValues(values, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
      })
      const payload: AdjustmentSubmitPayload = {
        id: typeof values.id === 'string' ? values.id : initialAdjustment?.id,
        label,
        code:
          typeof values.code === 'string' && values.code.trim().length ? values.code.trim() : null,
        kind:
          typeof values.kind === 'string' && values.kind.trim().length
            ? (values.kind as SalesAdjustmentKind)
            : 'custom',
        calculatorKey:
          typeof values.calculatorKey === 'string' && values.calculatorKey.trim().length
            ? values.calculatorKey.trim()
            : null,
        rate: mode === 'rate' && Number.isFinite(rateValue) ? rateValue : null,
        amountNet: mode === 'amount' && Number.isFinite(amountNet) ? amountNet : null,
        amountGross: mode === 'amount' && Number.isFinite(amountGross) ? amountGross : null,
        position: Number.isFinite(normalizeNumber(values.position)) ? Number(normalizeNumber(values.position)) : null,
        currencyCode: resolvedCurrency,
        customFields: Object.keys(customFields).length ? normalizeCustomFieldValues(customFields) : null,
      }
      await onSubmit(payload)
      onOpenChange(false)
    },
    [currencyCode, initialAdjustment?.id, mode, onOpenChange, onSubmit, t]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onOpenChange(false)
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            const form = dialogContentRef.current?.querySelector('form')
            form?.requestSubmit()
          }
        }}
        ref={dialogContentRef}
      >
        <DialogHeader>
          <DialogTitle>{initialAdjustment ? labels.editTitle : labels.addTitle}</DialogTitle>
        </DialogHeader>
        <CrudForm<AdjustmentFormState>
          key={formResetKey}
          embedded
          fields={fields}
          groups={groups}
          entityId={entityId}
          initialValues={initialValues}
          submitLabel={initialAdjustment ? labels.submitUpdate : labels.submitCreate}
          onSubmit={handleSubmit}
          loadingMessage={t('sales.documents.adjustments.loading', 'Loading adjustments…')}
        />
      </DialogContent>
    </Dialog>
  )
}
