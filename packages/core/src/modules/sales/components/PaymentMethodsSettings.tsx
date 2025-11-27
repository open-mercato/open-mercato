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
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  listPaymentProviders,
  type PaymentProvider,
  type ProviderSettingField,
} from '../lib/providers'

type PaymentMethodRow = {
  id: string
  name: string
  code: string
  providerKey: string | null
  providerLabel: string | null
  description: string | null
  terms: string | null
  isActive: boolean
  updatedAt: string | null
  providerSettings: Record<string, unknown> | null
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: PaymentMethodRow }

const paymentFormSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  providerKey: z.string().trim().optional(),
  description: z.string().optional(),
  terms: z.string().optional(),
  isActive: z.boolean().optional(),
  providerSettings: z.record(z.string(), z.unknown()).optional(),
})

type PaymentFormValues = z.infer<typeof paymentFormSchema>

const DEFAULT_FORM: PaymentFormValues = {
  name: '',
  code: '',
  providerKey: '',
  description: '',
  terms: '',
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

function createPaymentProviderSettingsRenderer(params: {
  providers: PaymentProvider[]
  selectPrompt: string
  noFieldsLabel: string
}) {
  const { providers, selectPrompt, noFieldsLabel } = params
  return function PaymentProviderSettingsField({
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

export function PaymentMethodsSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const providers = React.useMemo(() => listPaymentProviders(), [])
  const providerOptions = React.useMemo(
    () => providers.map((provider) => ({ value: provider.key, label: provider.label })),
    [providers]
  )
  const ProviderSettingsField = React.useMemo(
    () =>
      createPaymentProviderSettingsRenderer({
        providers,
        selectPrompt: t(
          'sales.config.paymentMethods.form.selectProvider',
          'Choose a provider to configure settings.'
        ),
        noFieldsLabel: t('sales.config.paymentMethods.form.noSettings', 'No configurable settings.'),
      }),
    [providers, t]
  )

  const translations = React.useMemo(() => ({
    title: t('sales.config.paymentMethods.title', 'Payment methods'),
    description: t(
      'sales.config.paymentMethods.description',
      'Configure payment providers and any checkout fees.'
    ),
    actions: {
      add: t('sales.config.paymentMethods.actions.add', 'Add payment method'),
      edit: t('sales.config.paymentMethods.actions.edit', 'Edit'),
      delete: t('sales.config.paymentMethods.actions.delete', 'Delete'),
      deleteConfirm: t('sales.config.paymentMethods.actions.deleteConfirm', 'Delete "{{name}}"?'),
      refresh: t('sales.config.paymentMethods.actions.refresh', 'Refresh'),
    },
    table: {
      name: t('sales.config.paymentMethods.table.name', 'Name'),
      code: t('sales.config.paymentMethods.table.code', 'Code'),
      provider: t('sales.config.paymentMethods.table.provider', 'Provider'),
      active: t('sales.config.paymentMethods.table.active', 'Active'),
      statusActive: t('sales.config.paymentMethods.table.statusActive', 'Active'),
      statusInactive: t('sales.config.paymentMethods.table.statusInactive', 'Inactive'),
      updatedAt: t('sales.config.paymentMethods.table.updatedAt', 'Updated'),
      empty: t('sales.config.paymentMethods.table.empty', 'No payment methods yet.'),
      search: t('sales.config.paymentMethods.table.search', 'Search payment methods…'),
    },
    form: {
      createTitle: t('sales.config.paymentMethods.form.createTitle', 'Add payment method'),
      editTitle: t('sales.config.paymentMethods.form.editTitle', 'Edit payment method'),
      name: t('sales.config.paymentMethods.form.name', 'Name'),
      code: t('sales.config.paymentMethods.form.code', 'Code'),
      provider: t('sales.config.paymentMethods.form.provider', 'Provider'),
      description: t('sales.config.paymentMethods.form.description', 'Description'),
      terms: t('sales.config.paymentMethods.form.terms', 'Terms'),
      isActive: t('sales.config.paymentMethods.form.isActive', 'Active'),
      providerSettings: t('sales.config.paymentMethods.form.providerSettings', 'Provider settings'),
      save: t('sales.config.paymentMethods.form.save', 'Save'),
      cancel: t('sales.config.paymentMethods.form.cancel', 'Cancel'),
    },
    messages: {
      saved: t('sales.config.paymentMethods.messages.saved', 'Payment method saved.'),
      deleted: t('sales.config.paymentMethods.messages.deleted', 'Payment method deleted.'),
    },
    errors: {
      load: t('sales.config.paymentMethods.errors.load', 'Failed to load payment methods.'),
      save: t('sales.config.paymentMethods.errors.save', 'Failed to save payment method.'),
      delete: t('sales.config.paymentMethods.errors.delete', 'Failed to delete payment method.'),
    },
  }), [t])

  const [entries, setEntries] = React.useState<PaymentMethodRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [formValues, setFormValues] = React.useState<PaymentFormValues>(DEFAULT_FORM)
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        '/api/sales/payment-methods?pageSize=200',
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [] } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setEntries(
        items.map((item) => {
          const providerKey = typeof (item as any).providerKey === 'string'
            ? (item as any).providerKey
            : typeof (item as any).provider_key === 'string'
              ? (item as any).provider_key
              : null
          const provider = providers.find((entry) => entry.key === providerKey)
          return {
            id: String(item.id ?? ''),
            name: typeof item.name === 'string' && item.name.length ? item.name : '—',
            code: typeof item.code === 'string' ? item.code : '',
            providerKey,
            providerLabel: provider?.label ?? null,
            description: typeof item.description === 'string' ? item.description : null,
            terms: typeof item.terms === 'string' ? item.terms : null,
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
      console.error('sales.payment-methods.list failed', err)
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

  const openEdit = React.useCallback((entry: PaymentMethodRow) => {
    setFormValues({
      name: entry.name,
      code: entry.code,
      providerKey: entry.providerKey ?? '',
      description: entry.description ?? '',
      terms: entry.terms ?? '',
      isActive: entry.isActive,
      providerSettings: entry.providerSettings ?? {},
    })
    setDialog({ mode: 'edit', entry })
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const deleteEntry = React.useCallback(async (entry: PaymentMethodRow) => {
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (!window.confirm(message)) return
    try {
      const call = await apiCall('/api/sales/payment-methods', {
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
      console.error('sales.payment-methods.delete failed', err)
      const message =
        err instanceof Error ? err.message : translations.errors.delete
      flash(message, 'error')
    }
  }, [loadEntries, translations.actions.deleteConfirm, translations.errors.delete, translations.messages.deleted])

  const handleSubmit = React.useCallback(async (values: PaymentFormValues) => {
    if (!dialog) return
    setSubmitting(true)
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      code: values.code.trim().toLowerCase(),
      description: values.description?.trim() || undefined,
      providerKey: values.providerKey?.trim() || undefined,
      terms: values.terms?.trim() || undefined,
      isActive: values.isActive ?? true,
      providerSettings: isRecord(values.providerSettings) ? values.providerSettings : undefined,
    }
    const path = '/api/sales/payment-methods'
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
      console.error('sales.payment-methods.save failed', err)
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
    { id: 'description', label: translations.form.description, type: 'textarea' },
    { id: 'terms', label: translations.form.terms, type: 'textarea' },
    { id: 'isActive', label: translations.form.isActive, type: 'checkbox' },
    {
      id: 'providerSettings',
      label: translations.form.providerSettings,
      type: 'custom',
      component: ProviderSettingsField,
    },
  ], [ProviderSettingsField, providerOptions, translations.form.code, translations.form.description, translations.form.isActive, translations.form.name, translations.form.provider, translations.form.providerSettings, translations.form.terms])

  const columns = React.useMemo<ColumnDef<PaymentMethodRow>[]>(() => [
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? translations.form.editTitle : translations.form.createTitle}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            schema={paymentFormSchema}
            fields={fields}
            initialValues={formValues}
            submitLabel={translations.form.save}
            onSubmit={handleSubmit}
            cancelHref={undefined}
            embedded
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
