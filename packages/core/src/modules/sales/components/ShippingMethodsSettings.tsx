"use client"

import * as React from 'react'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  listShippingProviders,
  type ProviderSettingField,
  type ShippingProvider,
} from '../lib/providers'

type ShippingMethodRow = {
  id: string
  name: string
  code: string
  providerKey: string | null
  providerLabel: string | null
  carrierCode: string | null
  description: string | null
  serviceLevel: string | null
  estimatedTransitDays: number | null
  baseRateNet: number
  baseRateGross: number
  currencyCode: string | null
  isActive: boolean
  updatedAt: string | null
  providerSettings: Record<string, unknown> | null
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: ShippingMethodRow }

const shippingFormSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  providerKey: z.string().trim().optional(),
  description: z.string().optional(),
  carrierCode: z.string().optional(),
  serviceLevel: z.string().optional(),
  estimatedTransitDays: z.coerce.number().min(0).optional(),
  baseRateNet: z.coerce.number().min(0),
  baseRateGross: z.coerce.number().min(0).optional(),
  currencyCode: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  providerSettings: z.record(z.string(), z.unknown()).optional(),
})

type ShippingFormValues = z.infer<typeof shippingFormSchema>

const DEFAULT_FORM: ShippingFormValues = {
  name: '',
  code: '',
  providerKey: '',
  description: '',
  carrierCode: '',
  serviceLevel: '',
  estimatedTransitDays: undefined,
  baseRateNet: 0,
  baseRateGross: 0,
  currencyCode: '',
  isActive: true,
  providerSettings: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function renderFieldInput(opts: {
  field: ProviderSettingField
  value: unknown
  onChange: (next: unknown) => void
}) {
  const { field, value, onChange } = opts
  const common = { id: field.key, 'data-provider-setting': field.key }
  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
          onChange={(evt) => onChange(evt.target.value === '' ? '' : Number(evt.target.value))}
          placeholder={field.placeholder}
        />
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-2 py-1">
          <Switch
            id={field.key}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <Label htmlFor={field.key}>{field.placeholder ?? ''}</Label>
        </div>
      )
    case 'select':
      return (
        <select
          {...common}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    case 'secret':
      return (
        <Input
          {...common}
          type="password"
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
    case 'url':
    case 'text':
    default:
      return (
        <Input
          {...common}
          type={field.type === 'url' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
  }
}

type RateRule = {
  id?: string
  name?: string
  metric?: string
  min?: number | null
  max?: number | null
  amountNet?: number | null
  amountGross?: number | null
  currencyCode?: string | null
}

function FlatRateSettingsEditor(props: {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  translations: {
    title: string
    add: string
    metric: string
    min: string
    max: string
    amountNet: string
    amountGross: string
    currency: string
    remove: string
    applyBaseRate: string
  }
  currencyCode?: string | null
}) {
  const { value, onChange, translations, currencyCode } = props
  const rates = Array.isArray(value.rates) ? (value.rates as RateRule[]) : []
  const applyBaseRate = value.applyBaseRate !== false
  const metrics: Array<{ value: string; label: string }> = [
    { value: 'item_count', label: 'Item count' },
    { value: 'weight', label: 'Total weight' },
    { value: 'volume', label: 'Total volume' },
    { value: 'subtotal', label: 'Subtotal' },
  ]

  const updateRates = (nextRates: RateRule[]) => {
    onChange({ ...value, rates: nextRates })
  }

  const updateRate = (index: number, key: keyof RateRule, nextValue: unknown) => {
    const next = rates.map((rate, idx) =>
      idx === index ? { ...rate, [key]: nextValue } : rate
    )
    updateRates(next)
  }

  const addRate = () => {
    updateRates([
      ...rates,
      {
        id: crypto.randomUUID?.() ?? String(Date.now()),
        name: '',
        metric: 'item_count',
        min: 0,
        max: null,
        amountNet: 0,
        amountGross: 0,
        currencyCode: currencyCode ?? '',
      },
    ])
  }

  const removeRate = (index: number) => {
    updateRates(rates.filter((_, idx) => idx !== index))
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{translations.title}</p>
        <Button size="sm" variant="outline" type="button" onClick={addRate}>
          {translations.add}
        </Button>
      </div>
      <div className="space-y-3">
        {rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{translations.add}</p>
        ) : (
          rates.map((rate, index) => (
            <div key={rate.id ?? index} className="rounded-md border border-border p-3 space-y-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.metric}</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={rate.metric ?? 'item_count'}
                    onChange={(evt) => updateRate(index, 'metric', evt.target.value)}
                  >
                    {metrics.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.min}</Label>
                  <Input
                    type="number"
                    value={rate.min ?? ''}
                    onChange={(evt) => updateRate(index, 'min', evt.target.value === '' ? null : Number(evt.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.max}</Label>
                  <Input
                    type="number"
                    value={rate.max ?? ''}
                    onChange={(evt) => updateRate(index, 'max', evt.target.value === '' ? null : Number(evt.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.amountNet}</Label>
                  <Input
                    type="number"
                    value={rate.amountNet ?? ''}
                    onChange={(evt) =>
                      updateRate(index, 'amountNet', evt.target.value === '' ? null : Number(evt.target.value))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.amountGross}</Label>
                  <Input
                    type="number"
                    value={rate.amountGross ?? ''}
                    onChange={(evt) =>
                      updateRate(index, 'amountGross', evt.target.value === '' ? null : Number(evt.target.value))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{translations.currency}</Label>
                  <Input
                    type="text"
                    value={rate.currencyCode ?? currencyCode ?? ''}
                    onChange={(evt) =>
                      updateRate(index, 'currencyCode', evt.target.value?.toUpperCase?.() ?? '')
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRate(index)}>
                  {translations.remove}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="apply-base-rate"
          checked={applyBaseRate}
          onCheckedChange={(checked) => onChange({ ...value, applyBaseRate: checked })}
        />
        <Label htmlFor="apply-base-rate" className="text-sm">
          {translations.applyBaseRate}
        </Label>
      </div>
    </div>
  )
}

function createShippingProviderSettingsRenderer(params: {
  providers: ShippingProvider[]
  selectPrompt: string
  noFieldsLabel: string
  flatRateLabels: FlatRateSettingsEditor['props']['translations']
}) {
  const { providers, selectPrompt, noFieldsLabel, flatRateLabels } = params
  return function ShippingProviderSettingsField({
    value,
    setValue,
    values,
  }: CrudCustomFieldRenderProps) {
    const providerKey =
      values && typeof values.providerKey === 'string' && values.providerKey.trim().length
        ? values.providerKey
        : null
    const provider = providers.find((entry) => entry.key === providerKey)
    const previousKey = React.useRef<string | null>(providerKey)

    React.useEffect(() => {
      if (providerKey !== previousKey.current) {
        const defaults = provider?.settings?.defaults ?? null
        setValue(defaults && typeof defaults === 'object' ? defaults : {})
        previousKey.current = providerKey
      }
    }, [providerKey, provider, setValue])

    if (!provider) {
      return <p className="text-sm text-muted-foreground">{selectPrompt}</p>
    }

    const settings = isRecord(value) ? value : {}
    const fields = provider.settings?.fields ?? []
    if (provider.key === 'flat-rate') {
      return (
        <FlatRateSettingsEditor
          value={settings}
          onChange={(next) => setValue(next)}
          translations={flatRateLabels}
          currencyCode={typeof values?.currencyCode === 'string' ? values.currencyCode : ''}
        />
      )
    }
    if (!fields.length) {
      return <p className="text-sm text-muted-foreground">{noFieldsLabel}</p>
    }
    return (
      <div className="space-y-4">
        {fields.map((field) => {
          const fieldValue = settings[field.key]
          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-sm font-medium">
                {field.label}
                {field.required ? ' *' : ''}
              </Label>
              {field.description ? (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              ) : null}
              {renderFieldInput({
                field,
                value: fieldValue,
                onChange: (next) => setValue({ ...settings, [field.key]: next }),
              })}
            </div>
          )
        })}
      </div>
    )
  }
}

export function ShippingMethodsSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const providers = React.useMemo(() => listShippingProviders(), [])
  const providerOptions = React.useMemo(
    () => providers.map((provider) => ({ value: provider.key, label: provider.label })),
    [providers]
  )
  const flatRateLabels = React.useMemo(() => ({
    title: t('sales.config.shippingMethods.form.ratesTitle', 'Rates'),
    add: t('sales.config.shippingMethods.form.addRate', 'Add rate'),
    metric: t('sales.config.shippingMethods.form.metric', 'Metric'),
    min: t('sales.config.shippingMethods.form.min', 'Min'),
    max: t('sales.config.shippingMethods.form.max', 'Max'),
    amountNet: t('sales.config.shippingMethods.form.amountNet', 'Amount (net)'),
    amountGross: t('sales.config.shippingMethods.form.amountGross', 'Amount (gross)'),
    currency: t('sales.config.shippingMethods.form.currency', 'Currency'),
    remove: t('sales.config.shippingMethods.form.removeRate', 'Remove'),
    applyBaseRate: t(
      'sales.config.shippingMethods.form.applyBaseRate',
      'Always include the base rate'
    ),
  }), [t])
  const ProviderSettingsField = React.useMemo(
    () =>
      createShippingProviderSettingsRenderer({
        providers,
        selectPrompt: t(
          'sales.config.shippingMethods.form.selectProvider',
          'Choose a provider to configure settings.'
        ),
        noFieldsLabel: t('sales.config.shippingMethods.form.noSettings', 'No configurable settings.'),
        flatRateLabels,
      }),
    [flatRateLabels, providers, t]
  )

  const translations = React.useMemo(() => ({
    title: t('sales.config.shippingMethods.title', 'Shipping methods'),
    description: t(
      'sales.config.shippingMethods.description',
      'Manage carriers, providers, and default shipping prices.'
    ),
    actions: {
      add: t('sales.config.shippingMethods.actions.add', 'Add shipping method'),
      edit: t('sales.config.shippingMethods.actions.edit', 'Edit'),
      delete: t('sales.config.shippingMethods.actions.delete', 'Delete'),
      deleteConfirm: t('sales.config.shippingMethods.actions.deleteConfirm', 'Delete "{{name}}"?'),
      refresh: t('sales.config.shippingMethods.actions.refresh', 'Refresh'),
    },
    table: {
      name: t('sales.config.shippingMethods.table.name', 'Name'),
      code: t('sales.config.shippingMethods.table.code', 'Code'),
      provider: t('sales.config.shippingMethods.table.provider', 'Provider'),
      rate: t('sales.config.shippingMethods.table.rate', 'Base rate'),
      currency: t('sales.config.shippingMethods.table.currency', 'Currency'),
      active: t('sales.config.shippingMethods.table.active', 'Active'),
      statusActive: t('sales.config.shippingMethods.table.statusActive', 'Active'),
      statusInactive: t('sales.config.shippingMethods.table.statusInactive', 'Inactive'),
      updatedAt: t('sales.config.shippingMethods.table.updatedAt', 'Updated'),
      empty: t('sales.config.shippingMethods.table.empty', 'No shipping methods yet.'),
      search: t('sales.config.shippingMethods.table.search', 'Search shipping methods…'),
    },
    form: {
      createTitle: t('sales.config.shippingMethods.form.createTitle', 'Add shipping method'),
      editTitle: t('sales.config.shippingMethods.form.editTitle', 'Edit shipping method'),
      name: t('sales.config.shippingMethods.form.name', 'Name'),
      code: t('sales.config.shippingMethods.form.code', 'Code'),
      provider: t('sales.config.shippingMethods.form.provider', 'Provider'),
      description: t('sales.config.shippingMethods.form.description', 'Description'),
      carrierCode: t('sales.config.shippingMethods.form.carrierCode', 'Carrier'),
      serviceLevel: t('sales.config.shippingMethods.form.serviceLevel', 'Service level'),
      estimatedTransitDays: t(
        'sales.config.shippingMethods.form.estimatedTransitDays',
        'Transit days'
      ),
      baseRateNet: t('sales.config.shippingMethods.form.baseRateNet', 'Base rate (net)'),
      baseRateGross: t('sales.config.shippingMethods.form.baseRateGross', 'Base rate (gross)'),
      currencyCode: t('sales.config.shippingMethods.form.currencyCode', 'Currency'),
      isActive: t('sales.config.shippingMethods.form.isActive', 'Active'),
      providerSettings: t('sales.config.shippingMethods.form.providerSettings', 'Provider settings'),
      save: t('sales.config.shippingMethods.form.save', 'Save'),
      cancel: t('sales.config.shippingMethods.form.cancel', 'Cancel'),
    },
    messages: {
      saved: t('sales.config.shippingMethods.messages.saved', 'Shipping method saved.'),
      deleted: t('sales.config.shippingMethods.messages.deleted', 'Shipping method deleted.'),
    },
    errors: {
      load: t('sales.config.shippingMethods.errors.load', 'Failed to load shipping methods.'),
      save: t('sales.config.shippingMethods.errors.save', 'Failed to save shipping method.'),
      delete: t('sales.config.shippingMethods.errors.delete', 'Failed to delete shipping method.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<ShippingMethodRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-xs text-muted-foreground">{row.original.code}</span>
        </div>
      ),
    },
    {
      accessorKey: 'providerKey',
      header: translations.table.provider,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.providerLabel ?? row.original.providerKey ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'rate',
      header: translations.table.rate,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.baseRateGross.toFixed(2)} {row.original.currencyCode ?? ''}
        </span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: translations.table.active,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.isActive ? translations.table.statusActive : translations.table.statusInactive}
        </span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <RowActions
          onEdit={() => openEdit(row.original)}
          onDelete={() => deleteEntry(row.original)}
          editLabel={translations.actions.edit}
          deleteLabel={translations.actions.delete}
        />
      ),
    },
  ], [deleteEntry, openEdit, translations])

  const [entries, setEntries] = React.useState<ShippingMethodRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [formValues, setFormValues] = React.useState<ShippingFormValues>(DEFAULT_FORM)
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        '/api/sales/shipping-methods?pageSize=200',
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [] } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setEntries(
        items.map((item) => {
          const providerKey = typeof (item as any).providerKey === 'string'
            ? (item as any).providerKey
            : typeof (item as any)?.provider_key === 'string'
              ? (item as any).provider_key
              : null
          const provider = providers.find((entry) => entry.key === providerKey)
          const baseRateGross = typeof item.baseRateGross === 'number'
            ? item.baseRateGross
            : Number((item as any)?.base_rate_gross ?? item.baseRateGross ?? 0) || 0
          const baseRateNet = typeof item.baseRateNet === 'number'
            ? item.baseRateNet
            : Number((item as any)?.base_rate_net ?? item.baseRateNet ?? 0) || 0
          const currency =
            typeof item.currencyCode === 'string'
              ? item.currencyCode
              : typeof (item as any)?.currency_code === 'string'
                ? (item as any).currency_code
                : null
          return {
            id: String(item.id ?? ''),
            name: typeof item.name === 'string' && item.name.length ? item.name : '—',
            code: typeof item.code === 'string' ? item.code : '',
            providerKey,
            providerLabel: provider?.label ?? null,
            carrierCode: typeof item.carrierCode === 'string' ? item.carrierCode : null,
            description: typeof item.description === 'string' ? item.description : null,
            serviceLevel: typeof item.serviceLevel === 'string' ? item.serviceLevel : null,
            estimatedTransitDays:
              typeof (item as any)?.estimatedTransitDays === 'number'
                ? (item as any).estimatedTransitDays
                : typeof (item as any)?.estimated_transit_days === 'number'
                  ? (item as any).estimated_transit_days
                  : null,
            baseRateNet,
            baseRateGross,
            currencyCode: currency,
            isActive:
              typeof item.isActive === 'boolean'
                ? item.isActive
                : typeof (item as any)?.is_active === 'boolean'
                  ? (item as any).is_active
                  : false,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
            providerSettings:
              item && typeof (item as any).providerSettings === 'object'
                ? ((item as any).providerSettings as Record<string, unknown>)
                : null,
          }
        })
      )
    } catch (err) {
      console.error('sales.shipping-methods.list failed', err)
      flash(translations.errors.load, 'error')
    } finally {
      setLoading(false)
    }
  }, [providers, translations.errors.load])

  React.useEffect(() => {
    void loadEntries()
  }, [loadEntries, scopeVersion])

  const openCreate = React.useCallback(() => {
    const defaultProvider = providerOptions[0]?.value ?? ''
    setFormValues({
      ...DEFAULT_FORM,
      providerKey: defaultProvider,
      providerSettings: {},
    })
    setDialog({ mode: 'create' })
  }, [providerOptions])

  const openEdit = React.useCallback((entry: ShippingMethodRow) => {
    setFormValues({
      name: entry.name,
      code: entry.code,
      providerKey: entry.providerKey ?? '',
      description: entry.description ?? '',
      carrierCode: entry.carrierCode ?? '',
      serviceLevel: entry.serviceLevel ?? '',
      estimatedTransitDays: entry.estimatedTransitDays ?? undefined,
      baseRateNet: entry.baseRateNet,
      baseRateGross: entry.baseRateGross,
      currencyCode: entry.currencyCode ?? '',
      isActive: entry.isActive,
      providerSettings: entry.providerSettings ?? {},
    })
    setDialog({ mode: 'edit', entry })
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const deleteEntry = React.useCallback(async (entry: ShippingMethodRow) => {
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (!window.confirm(message)) return
    try {
      const call = await apiCall('/api/sales/shipping-methods', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id }),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, translations.errors.delete)
      }
      flash(translations.messages.deleted, 'success')
      await loadEntries()
    } catch (err) {
      console.error('sales.shipping-methods.delete failed', err)
      const message = err instanceof Error ? err.message : translations.errors.delete
      flash(message, 'error')
    }
  }, [loadEntries, translations.actions.deleteConfirm, translations.errors.delete, translations.messages.deleted])

  const handleSubmit = React.useCallback(async (values: ShippingFormValues) => {
    if (!dialog) return
    setSubmitting(true)
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      code: values.code.trim().toLowerCase(),
      description: values.description?.trim() || undefined,
      carrierCode: values.carrierCode?.trim() || undefined,
      providerKey: values.providerKey?.trim() || undefined,
      serviceLevel: values.serviceLevel?.trim() || undefined,
      estimatedTransitDays:
        values.estimatedTransitDays === undefined || values.estimatedTransitDays === null
          ? undefined
          : Number(values.estimatedTransitDays),
      baseRateNet: Number(values.baseRateNet ?? 0),
      baseRateGross:
        values.baseRateGross === undefined || values.baseRateGross === null
          ? Number(values.baseRateNet ?? 0)
          : Number(values.baseRateGross),
      currencyCode: values.currencyCode?.trim().toUpperCase() || undefined,
      isActive: values.isActive ?? true,
      providerSettings: isRecord(values.providerSettings) ? values.providerSettings : undefined,
    }
    const path = '/api/sales/shipping-methods'
    const method = dialog.mode === 'create' ? 'POST' : 'PUT'
    if (dialog.mode === 'edit') payload.id = dialog.entry.id
    try {
      const call = await apiCall(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, translations.errors.save)
      }
      flash(translations.messages.saved, 'success')
      await loadEntries()
      closeDialog()
    } catch (err) {
      console.error('sales.shipping-methods.save failed', err)
      const message = err instanceof Error ? err.message : translations.errors.save
      flash(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, loadEntries, translations.errors.save, translations.messages.saved])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: translations.form.name, type: 'text', required: true },
    { id: 'code', label: translations.form.code, type: 'text', required: true },
    {
      id: 'providerKey',
      label: translations.form.provider,
      type: 'select',
      required: false,
      options: providerOptions,
    },
    { id: 'carrierCode', label: translations.form.carrierCode, type: 'text' },
    { id: 'serviceLevel', label: translations.form.serviceLevel, type: 'text' },
    {
      id: 'estimatedTransitDays',
      label: translations.form.estimatedTransitDays,
      type: 'number',
      layout: 'half',
    },
    {
      id: 'baseRateNet',
      label: translations.form.baseRateNet,
      type: 'number',
      required: true,
      layout: 'half',
    },
    {
      id: 'baseRateGross',
      label: translations.form.baseRateGross,
      type: 'number',
      required: false,
      layout: 'half',
    },
    {
      id: 'currencyCode',
      label: translations.form.currencyCode,
      type: 'text',
      layout: 'half',
    },
    { id: 'description', label: translations.form.description, type: 'textarea' },
    { id: 'isActive', label: translations.form.isActive, type: 'checkbox' },
    {
      id: 'providerSettings',
      label: translations.form.providerSettings,
      type: 'custom',
      component: ProviderSettingsField,
    },
  ], [ProviderSettingsField, providerOptions, translations.form.baseRateGross, translations.form.baseRateNet, translations.form.carrierCode, translations.form.code, translations.form.currencyCode, translations.form.description, translations.form.estimatedTransitDays, translations.form.isActive, translations.form.name, translations.form.provider, translations.form.providerSettings, translations.form.serviceLevel])

  const filteredEntries = React.useMemo(() => {
    if (!search.trim()) return entries
    const term = search.trim().toLowerCase()
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(term) ||
        entry.code.toLowerCase().includes(term) ||
        (entry.providerLabel ?? '').toLowerCase().includes(term) ||
        (entry.providerKey ?? '').toLowerCase().includes(term)
    )
  }, [entries, search])

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{translations.title}</h2>
          <p className="text-sm text-muted-foreground">{translations.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadEntries()}>
            {translations.actions.refresh}
          </Button>
          <Button size="sm" onClick={openCreate}>
            {translations.actions.add}
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <DataTable
          isLoading={loading}
          columns={columns}
          data={filteredEntries}
          searchValue={search}
          onSearchChange={setSearch}
          emptyLabel={translations.table.empty}
          searchPlaceholder={translations.table.search}
        />
      </div>

      <Dialog open={dialog !== null} onOpenChange={(next) => !next && closeDialog()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? translations.form.editTitle : translations.form.createTitle}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            schema={shippingFormSchema}
            fields={fields}
            initialValues={formValues}
            submitLabel={translations.form.save}
            cancelHref={undefined}
            embedded
            onSubmit={handleSubmit}
            isLoading={submitting}
            twoColumn
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {translations.form.cancel}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}
