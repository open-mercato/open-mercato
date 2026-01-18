// @ts-nocheck

"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { normalizeCustomFieldResponse, normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { DictionaryEntrySelect, type DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SalesAdjustmentKind } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { Settings } from 'lucide-react'
import { extractCustomFieldValues, normalizeCustomFieldSubmitValue } from './customFieldHelpers'

type TaxRateOption = {
  id: string
  name: string
  code: string | null
  rate: number | null
  isDefault: boolean
}

type AdjustmentFormState = {
  id?: string
  label: string
  code: string
  kind: SalesAdjustmentKind
  mode?: 'rate' | 'amount'
  calculatorKey: string
  rate: string
  amountNet: string
  amountGross: string
  position: string
  customFieldSetId?: string | null
  taxRateId?: string | null
  taxRateValue?: number | null
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
  metadata?: Record<string, unknown> | null
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
  metadata?: Record<string, unknown> | null
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

const formatTaxRateLabel = (rate: TaxRateOption): string => {
  const extras: string[] = []
  if (typeof rate.rate === 'number' && Number.isFinite(rate.rate)) {
    extras.push(`${rate.rate}%`)
  }
  if (rate.code) {
    extras.push(rate.code.toUpperCase())
  }
  if (!extras.length) return rate.name
  return `${rate.name} • ${extras.join(' · ')}`
}

const roundAmount = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

const resolveModeFromAdjustment = (adjustment?: AdjustmentRowData | null): 'rate' | 'amount' => {
  if (!adjustment) return 'amount'
  const metadataMode =
    typeof adjustment.metadata === 'object' && adjustment.metadata
      ? (adjustment.metadata as any).calculationMode
      : null
  if (metadataMode === 'rate' || metadataMode === 'amount') return metadataMode
  const rateValue = normalizeNumber(adjustment.rate)
  const amountNetValue = normalizeNumber(adjustment.amountNet)
  const amountGrossValue = normalizeNumber(adjustment.amountGross)
  const hasAmounts = Number.isFinite(amountNetValue) || Number.isFinite(amountGrossValue)
  if (Number.isFinite(rateValue) && (rateValue !== 0 || !hasAmounts)) return 'rate'
  if (hasAmounts) return 'amount'
  return 'amount'
}

const PROVIDER_CALCULATOR_PREFIXES = ['shipping-provider:', 'payment-provider:']

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
  const initialMode: 'rate' | 'amount' = resolveModeFromAdjustment(initialAdjustment)
  const [mode, setMode] = React.useState<'rate' | 'amount'>(initialMode)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [taxRates, setTaxRates] = React.useState<TaxRateOption[]>([])
  const taxRatesRef = React.useRef<TaxRateOption[]>([])
  const taxRatesLoadedRef = React.useRef(false)
  const lastAmountChangedRef = React.useRef<'net' | 'gross' | null>(null)
  const [initialValues, setInitialValues] = React.useState<AdjustmentFormState>(() => ({
    id: undefined,
    label: '',
    code: '',
    kind: (kindOptions[0]?.value as SalesAdjustmentKind) ?? 'custom',
    mode: initialMode,
    calculatorKey: '',
    rate: '',
    amountNet: '',
    amountGross: '',
    position: '',
    customFieldSetId: null,
    taxRateId: null,
    taxRateValue: null,
  }))

  const taxRateMap = React.useMemo(
    () =>
      taxRates.reduce<Map<string, TaxRateOption>>((acc, rate) => {
        acc.set(rate.id, rate)
        return acc
      }, new Map()),
    [taxRates]
  )

  const resolveTaxRateValue = React.useCallback(
    (values: Record<string, unknown>): number | null => {
      const fallback = normalizeNumber((values as any)?.taxRateValue)
      if (Number.isFinite(fallback)) return fallback
      const rateId =
        typeof (values as any)?.taxRateId === 'string' && (values as any)?.taxRateId.trim().length
          ? (values as any)?.taxRateId.trim()
          : null
      if (rateId) {
        const option = taxRateMap.get(rateId)
        const parsed = normalizeNumber(option?.rate)
        if (Number.isFinite(parsed)) return parsed
      }
      return null
    },
    [taxRateMap]
  )

  const loadTaxRates = React.useCallback(async (): Promise<TaxRateOption[]> => {
    if (taxRatesLoadedRef.current && taxRatesRef.current.length) return taxRatesRef.current
    try {
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        '/api/sales/tax-rates?pageSize=200',
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const parsed = items
        .map<TaxRateOption | null>((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          const name =
            typeof item.name === 'string' && item.name.trim().length
              ? item.name.trim()
              : typeof item.code === 'string'
                ? item.code
                : null
          if (!id || !name) return null
          const rate = normalizeNumber((item as any).rate)
          const code =
            typeof (item as any).code === 'string' && (item as any).code.trim().length
              ? (item as any).code.trim()
              : null
          const isDefault = Boolean((item as any).isDefault ?? (item as any).is_default)
          return { id, name, code, rate: Number.isFinite(rate) ? rate : null, isDefault }
        })
        .filter((entry): entry is TaxRateOption => Boolean(entry))
      taxRatesRef.current = parsed
      taxRatesLoadedRef.current = true
      setTaxRates(parsed)
      return parsed
    } catch (err) {
      console.error('sales.tax-rates.fetch', err)
      taxRatesRef.current = []
      setTaxRates([])
      taxRatesLoadedRef.current = true
      return []
    }
  }, [])

  const applyOppositeAmount = React.useCallback(
    (
      source: 'net' | 'gross',
      rawValue: string,
      values: Record<string, unknown>,
      setFormValue?: (key: string, value: unknown) => void
    ) => {
      if (mode !== 'amount') return
      if (!rawValue || rawValue.trim() === '') {
        if (!setFormValue) return
        setFormValue(source === 'net' ? 'amountGross' : 'amountNet', '')
        return
      }
      const rateValue = resolveTaxRateValue(values)
      if (!Number.isFinite(rateValue)) return
      const numeric = normalizeNumber(rawValue)
      if (!Number.isFinite(numeric)) return
      if (!setFormValue) return
      if (source === 'net') {
        const gross = roundAmount(numeric * (1 + rateValue / 100))
        setFormValue('amountGross', Number.isFinite(gross) ? gross.toFixed(2) : '')
      } else {
        const net = roundAmount(numeric / (1 + rateValue / 100))
        setFormValue('amountNet', Number.isFinite(net) ? net.toFixed(2) : '')
      }
    },
    [mode, resolveTaxRateValue]
  )

  React.useEffect(() => {
    if (!open) return
    let mounted = true
    if (!kindOptions.length) {
      void loadKindOptions()
    }
    const prepare = async () => {
      const rates = await loadTaxRates()
      if (!mounted) return
      const metaTaxRateId =
        typeof initialAdjustment?.metadata === 'object' &&
        initialAdjustment?.metadata &&
        typeof (initialAdjustment.metadata as any).taxRateId === 'string'
          ? (initialAdjustment.metadata as any).taxRateId
          : null
      const metaTaxRateValue =
        typeof initialAdjustment?.metadata === 'object' &&
        initialAdjustment?.metadata &&
        Number.isFinite(normalizeNumber((initialAdjustment.metadata as any).taxRate))
          ? Number(normalizeNumber((initialAdjustment.metadata as any).taxRate))
          : null
      const defaultRate = rates.find((rate) => rate.isDefault) ?? null
      const resolvedMode = resolveModeFromAdjustment(initialAdjustment)
      const next: AdjustmentFormState = {
        id: initialAdjustment?.id,
        label: initialAdjustment?.label ?? '',
        code: initialAdjustment?.code ?? '',
        kind: initialAdjustment?.kind ?? (kindOptions[0]?.value as SalesAdjustmentKind) ?? 'custom',
        mode: resolvedMode,
        calculatorKey: initialAdjustment?.calculatorKey ?? '',
        rate: initialAdjustment?.rate ?? '',
        amountNet: initialAdjustment?.amountNet ?? '',
        amountGross: initialAdjustment?.amountGross ?? '',
        position: initialAdjustment?.position ?? '',
        customFieldSetId: initialAdjustment?.customFieldSetId ?? null,
        taxRateId: metaTaxRateId ?? defaultRate?.id ?? null,
        taxRateValue:
          metaTaxRateValue ??
          (Number.isFinite(defaultRate?.rate ?? null) ? (defaultRate?.rate as number) : null),
      }
      const customValues = extractCustomFieldValues(initialAdjustment as Record<string, unknown> | null)
      setInitialValues({ ...next, ...customValues })
      setMode(resolvedMode)
      setFormResetKey((prev) => prev + 1)
    }
    prepare().catch(() => {})
    return () => {
      mounted = false
    }
  }, [initialAdjustment, kindOptions, loadKindOptions, loadTaxRates, open])

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
        component: ({ value, setValue }) => {
          const currentMode = value === 'rate' || value === 'amount' ? value : mode
          return (
            <div className="inline-flex rounded-md border bg-muted/40 p-1 text-sm font-medium">
              {(['rate', 'amount'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`rounded px-3 py-1 transition-colors ${
                    currentMode === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  }`}
                  onClick={() => {
                    setMode(option)
                    setValue?.(option)
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
          )
        },
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
        type: 'custom',
        placeholder: '0.00',
        required: mode === 'amount',
        disabled: mode !== 'amount',
        layout: 'half',
        component: ({ value, setValue, setFormValue, values }) => (
          <Input
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(event) => {
              setValue(event.target.value)
              lastAmountChangedRef.current = 'net'
              applyOppositeAmount('net', event.target.value, values ?? {}, setFormValue)
            }}
            placeholder="0.00"
            disabled={mode !== 'amount'}
          />
        ),
      },
      {
        id: 'amountGross',
        label: t('sales.documents.adjustments.amountGross', 'Gross amount'),
        type: 'custom',
        placeholder: '0.00',
        disabled: mode !== 'amount',
        layout: 'half',
        component: ({ value, setValue, setFormValue, values }) => (
          <Input
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(event) => {
              setValue(event.target.value)
              lastAmountChangedRef.current = 'gross'
              applyOppositeAmount('gross', event.target.value, values ?? {}, setFormValue)
            }}
            placeholder="0.00"
            disabled={mode !== 'amount'}
          />
        ),
      },
      {
        id: 'taxRateId',
        label: t('sales.documents.adjustments.taxRate', 'Tax class'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue, setFormValue, values }) => {
          const resolvedValue =
            typeof value === 'string' && value.trim().length
              ? value
              : null
          const rateId =
            resolvedValue ??
            (() => {
              const rateValue = normalizeNumber(
                (values as any)?.taxRateValue ?? (values as any)?.taxRate
              )
              if (!Number.isFinite(rateValue)) return null
              const match = taxRatesRef.current.find(
                (rate) => Number.isFinite(rate.rate) && rate.rate === rateValue
              )
              return match?.id ?? null
            })()
          const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const nextId = event.target.value || null
            const option = nextId ? taxRateMap.get(nextId) ?? null : null
            setValue(nextId)
            const normalizedRate = normalizeNumber(option?.rate)
            setFormValue?.('taxRateValue', Number.isFinite(normalizedRate) ? normalizedRate : null)
            const rateNumeric = Number.isFinite(normalizedRate) ? normalizedRate : null
            if (rateNumeric === null) return
            const lastChanged = lastAmountChangedRef.current
            if (mode !== 'amount') return
            if (lastChanged === 'gross') {
              const gross = normalizeNumber((values as any)?.amountGross)
              if (Number.isFinite(gross)) {
                const net = roundAmount(gross / (1 + rateNumeric / 100))
                setFormValue?.('amountNet', net.toFixed(2))
              }
              return
            }
            const net = normalizeNumber((values as any)?.amountNet)
            if (Number.isFinite(net)) {
              const gross = roundAmount(net * (1 + rateNumeric / 100))
              setFormValue?.('amountGross', gross.toFixed(2))
            }
          }
          return (
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={rateId ?? ''}
                onChange={handleChange}
                disabled={!taxRates.length}
              >
                <option value="">
                  {taxRates.length
                    ? t('sales.documents.adjustments.taxRate.placeholder', 'No tax class selected')
                    : t('sales.documents.adjustments.taxRate.empty', 'No tax classes available')}
                </option>
                {taxRates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {formatTaxRateLabel(rate)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open('/backend/config/sales?section=tax-rates', '_blank', 'noopener,noreferrer')
                  }
                }}
                title={t('sales.documents.adjustments.taxRate.manage', 'Manage tax classes')}
              >
                <Settings className="h-4 w-4" />
                <span className="sr-only">
                  {t('sales.documents.adjustments.taxRate.manage', 'Manage tax classes')}
                </span>
              </Button>
            </div>
          )
        },
      },
      {
        id: 'taxRateValue',
        label: '',
        type: 'custom',
        component: () => null,
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
  }, [applyOppositeAmount, currencyCode, loadKindOptions, mode, t, taxRates.length, taxRateMap])

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

  const resolveFormMode = React.useCallback(
    (values: Record<string, unknown>): 'rate' | 'amount' => {
      const raw = values.mode
      if (raw === 'rate' || raw === 'amount') return raw
      return mode
    },
    [mode]
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const calculationMode = resolveFormMode(values)
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
      const percentageRate = normalizeNumber(values.rate)
      const amountNet = normalizeNumber(values.amountNet)
      const amountGross = normalizeNumber(values.amountGross)
      if (calculationMode === 'rate') {
        if (!Number.isFinite(percentageRate)) {
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
      const rateValue = resolveTaxRateValue(values)
      const selectedRateId =
        typeof values.taxRateId === 'string' && values.taxRateId.trim().length
          ? values.taxRateId
          : null
      const metadata: Record<string, unknown> = {
        ...(typeof initialAdjustment?.metadata === 'object' && initialAdjustment?.metadata
          ? initialAdjustment.metadata
          : {}),
      }
      const isEditingProviderAdjustment =
        typeof initialAdjustment?.calculatorKey === 'string' &&
        PROVIDER_CALCULATOR_PREFIXES.some((prefix) =>
          (initialAdjustment?.calculatorKey ?? '').startsWith(prefix)
        )
      if (selectedRateId) metadata.taxRateId = selectedRateId
      if (Number.isFinite(rateValue)) metadata.taxRate = rateValue
      if (isEditingProviderAdjustment) {
        metadata.manualOverride = true
      }
      metadata.calculationMode = calculationMode

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
        rate: calculationMode === 'rate' && Number.isFinite(percentageRate) ? percentageRate : null,
        amountNet: calculationMode === 'amount' && Number.isFinite(amountNet) ? amountNet : null,
        amountGross: calculationMode === 'amount' && Number.isFinite(amountGross) ? amountGross : null,
        position: Number.isFinite(normalizeNumber(values.position)) ? Number(normalizeNumber(values.position)) : null,
        currencyCode: resolvedCurrency,
        customFields: Object.keys(customFields).length ? normalizeCustomFieldValues(customFields) : null,
        metadata: Object.keys(metadata).length ? metadata : null,
      }
      await onSubmit(payload)
      onOpenChange(false)
    },
    [
      currencyCode,
      initialAdjustment?.calculatorKey,
      initialAdjustment?.id,
      initialAdjustment?.metadata,
      onOpenChange,
      onSubmit,
      resolveFormMode,
      resolveTaxRateValue,
      t,
    ]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-5xl"
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
          customFieldsLoadingMessage={t('ui.forms.loading', 'Loading data...')}
        />
      </DialogContent>
    </Dialog>
  )
}
