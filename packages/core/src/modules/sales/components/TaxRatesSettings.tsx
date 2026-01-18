"use client"

import * as React from 'react'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TaxRateRow = {
  id: string
  name: string
  code: string | null
  rate: number | null
  isDefault: boolean
  countryCode: string | null
  regionCode: string | null
  postalCode: string | null
  city: string | null
  updatedAt: string | null
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: TaxRateRow }

const taxRateFormSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  rate: z.coerce.number().min(0).max(100),
  countryCode: z.string().trim().optional(),
  regionCode: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  city: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
})

type TaxRateFormValues = z.infer<typeof taxRateFormSchema>

const DEFAULT_FORM_VALUES: TaxRateFormValues = {
  name: '',
  code: '',
  rate: 0,
  countryCode: '',
  regionCode: '',
  postalCode: '',
  city: '',
  isDefault: false,
}

export function TaxRatesSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [entries, setEntries] = React.useState<TaxRateRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [search, setSearch] = React.useState('')

  const translations = React.useMemo(() => ({
    title: t('sales.config.taxRates.title', 'Tax rates'),
    description: t('sales.config.taxRates.description', 'Maintain VAT classes applied to catalog pricing.'),
    actions: {
      add: t('sales.config.taxRates.actions.add', 'Add tax rate'),
      edit: t('sales.config.taxRates.actions.edit', 'Edit'),
      delete: t('sales.config.taxRates.actions.delete', 'Delete'),
      deleteConfirm: t('sales.config.taxRates.actions.deleteConfirm', 'Delete tax rate "{{name}}"?'),
      refresh: t('sales.config.taxRates.actions.refresh', 'Refresh'),
    },
    table: {
      name: t('sales.config.taxRates.table.name', 'Name'),
      code: t('sales.config.taxRates.table.code', 'Code'),
      rate: t('sales.config.taxRates.table.rate', 'Rate'),
      location: t('sales.config.taxRates.table.location', 'Location'),
      updatedAt: t('sales.config.taxRates.table.updatedAt', 'Updated'),
      empty: t('sales.config.taxRates.table.empty', 'No tax rates yet.'),
      search: t('sales.config.taxRates.table.search', 'Search tax rates…'),
      defaultBadge: t('sales.config.taxRates.table.defaultBadge', 'Default'),
    },
    form: {
      createTitle: t('sales.config.taxRates.form.createTitle', 'Add tax rate'),
      editTitle: t('sales.config.taxRates.form.editTitle', 'Edit tax rate'),
      name: t('sales.config.taxRates.form.name', 'Name'),
      code: t('sales.config.taxRates.form.code', 'Code'),
      rate: t('sales.config.taxRates.form.rate', 'Rate (%)'),
      countryCode: t('sales.config.taxRates.form.countryCode', 'Country code'),
      regionCode: t('sales.config.taxRates.form.regionCode', 'Region code'),
      postalCode: t('sales.config.taxRates.form.postalCode', 'Postal code'),
      city: t('sales.config.taxRates.form.city', 'City'),
      isDefault: t('sales.config.taxRates.form.isDefault', 'Default tax class'),
      isDefaultHelp: t(
        'sales.config.taxRates.form.isDefaultHelp',
        'Preselect this class for new catalog products.'
      ),
      save: t('sales.config.taxRates.form.save', 'Save'),
      cancel: t('sales.config.taxRates.form.cancel', 'Cancel'),
      codeHelp: t('sales.config.taxRates.form.codeHelp', 'Lowercase letters, numbers, and dashes.'),
    },
    messages: {
      saved: t('sales.config.taxRates.messages.saved', 'Tax rate saved.'),
      deleted: t('sales.config.taxRates.messages.deleted', 'Tax rate deleted.'),
    },
    errors: {
      load: t('sales.config.taxRates.errors.load', 'Failed to load tax rates.'),
      save: t('sales.config.taxRates.errors.save', 'Failed to save tax rate.'),
      delete: t('sales.config.taxRates.errors.delete', 'Failed to delete tax rate.'),
    },
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: translations.form.name, type: 'text', required: true },
    { id: 'code', label: translations.form.code, type: 'text', required: true, description: translations.form.codeHelp },
    { id: 'rate', label: translations.form.rate, type: 'number', required: true },
    { id: 'countryCode', label: translations.form.countryCode, type: 'text', layout: 'half' },
    { id: 'regionCode', label: translations.form.regionCode, type: 'text', layout: 'half' },
    { id: 'postalCode', label: translations.form.postalCode, type: 'text', layout: 'half' },
    { id: 'city', label: translations.form.city, type: 'text', layout: 'half' },
    {
      id: 'isDefault',
      label: translations.form.isDefault,
      type: 'checkbox',
      description: translations.form.isDefaultHelp,
    },
  ], [translations.form])

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        '/api/sales/tax-rates?pageSize=200',
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [] } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setEntries(
        items.map((item) => {
          const rawRate = typeof item.rate === 'number' ? item.rate : Number(item.rate ?? Number.NaN)
          return {
            id: String(item.id),
            name: typeof item.name === 'string' && item.name.length ? item.name : '—',
            code: typeof item.code === 'string' && item.code.length ? item.code : null,
            rate: Number.isFinite(rawRate) ? rawRate : null,
            isDefault: Boolean(
              typeof item.isDefault === 'boolean'
                ? item.isDefault
                : typeof item.is_default === 'boolean'
                  ? item.is_default
                  : false,
            ),
            countryCode: typeof item.countryCode === 'string' && item.countryCode.length ? item.countryCode : null,
            regionCode: typeof item.regionCode === 'string' && item.regionCode.length ? item.regionCode : null,
            postalCode: typeof item.postalCode === 'string' && item.postalCode.length ? item.postalCode : null,
            city: typeof item.city === 'string' && item.city.length ? item.city : null,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
          }
        }),
      )
    } catch (err) {
      console.error('sales.tax-rates.list failed', err)
      flash(translations.errors.load, 'error')
    } finally {
      setLoading(false)
    }
  }, [translations.errors.load])

  React.useEffect(() => {
    void loadEntries()
  }, [loadEntries, scopeVersion])

  const openCreate = React.useCallback(() => {
    setDialog({ mode: 'create' })
  }, [])

  const openEdit = React.useCallback((entry: TaxRateRow) => {
    setDialog({ mode: 'edit', entry })
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const handleSubmit = React.useCallback(async (values: TaxRateFormValues) => {
    if (!dialog) return
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      code: values.code.trim().toLowerCase(),
      rate: Number(values.rate),
      countryCode: values.countryCode?.trim() ? values.countryCode.trim().toUpperCase() : undefined,
      regionCode: values.regionCode?.trim() || undefined,
      postalCode: values.postalCode?.trim() || undefined,
      city: values.city?.trim() || undefined,
      isDefault: Boolean(values.isDefault),
    }
    const method = dialog.mode === 'create' ? 'POST' : 'PUT'
    if (dialog.mode === 'edit') {
      payload.id = dialog.entry.id
    }
    try {
      const call = await apiCall('/api/sales/tax-rates', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, translations.errors.save)
        return
      }
      flash(translations.messages.saved, 'success')
      closeDialog()
      await loadEntries()
    } catch (err) {
      console.error('sales.tax-rates.save failed', err)
      flash(translations.errors.save, 'error')
    }
  }, [dialog, translations.errors.save, translations.messages.saved, closeDialog, loadEntries])

  const deleteEntry = React.useCallback(async (entry: TaxRateRow) => {
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name || entry.code || entry.id)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      const call = await apiCall('/api/sales/tax-rates', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id }),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, translations.errors.delete)
        return
      }
      flash(translations.messages.deleted, 'success')
      await loadEntries()
    } catch (err) {
      console.error('sales.tax-rates.delete failed', err)
      flash(translations.errors.delete, 'error')
    }
  }, [translations.actions.deleteConfirm, translations.errors.delete, translations.messages.deleted, loadEntries])

  const columns = React.useMemo<ColumnDef<TaxRateRow>[]>(() => [
    {
      header: translations.table.name,
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.isDefault ? (
            <Badge variant="outline" className="text-xs uppercase tracking-wide">
              {translations.table.defaultBadge}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      header: translations.table.code,
      accessorKey: 'code',
      cell: ({ row }) => row.original.code ?? '—',
    },
    {
      header: translations.table.rate,
      accessorKey: 'rate',
      cell: ({ row }) => (typeof row.original.rate === 'number' ? `${row.original.rate}%` : '—'),
    },
    {
      header: translations.table.location,
      cell: ({ row }) => formatLocation(row.original),
    },
    {
      header: translations.table.updatedAt,
      accessorKey: 'updatedAt',
      cell: ({ row }) => (row.original.updatedAt ? formatDateTime(row.original.updatedAt) : '—'),
    },
  ], [translations.table])

  const dialogValues: TaxRateFormValues = React.useMemo(() => {
    if (!dialog || dialog.mode === 'create') return { ...DEFAULT_FORM_VALUES }
    return {
      name: dialog.entry.name ?? '',
      code: dialog.entry.code ?? '',
      rate: dialog.entry.rate ?? 0,
      countryCode: dialog.entry.countryCode ?? '',
      regionCode: dialog.entry.regionCode ?? '',
      postalCode: dialog.entry.postalCode ?? '',
      city: dialog.entry.city ?? '',
      isDefault: Boolean(dialog.entry.isDefault),
    }
  }, [dialog])

  const filteredEntries = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) => {
      const location = formatLocation(entry).toLowerCase()
      return (
        entry.name.toLowerCase().includes(term) ||
        (entry.code ?? '').toLowerCase().includes(term) ||
        location.includes(term)
      )
    })
  }, [entries, search])

  return (
    <section className="rounded border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-medium">{translations.title}</h2>
        <p className="text-sm text-muted-foreground">{translations.description}</p>
      </div>

      <div className="px-2 py-4 sm:px-4">
        <DataTable<TaxRateRow>
          data={filteredEntries}
          columns={columns}
          isLoading={loading}
          embedded
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={translations.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
          actions={(
            <Button onClick={openCreate} size="sm">
              {translations.actions.add}
            </Button>
          )}
          refreshButton={{
            label: translations.actions.refresh,
            onRefresh: () => { void loadEntries() },
            isRefreshing: loading,
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { label: translations.actions.edit, onSelect: () => openEdit(row) },
                { label: translations.actions.delete, destructive: true, onSelect: () => deleteEntry(row) },
              ]}
            />
          )}
        />
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? translations.form.editTitle : translations.form.createTitle}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<TaxRateFormValues>
            schema={taxRateFormSchema}
            fields={fields}
            initialValues={dialogValues}
            submitLabel={translations.form.save}
            cancelHref={undefined}
            embedded
            onSubmit={handleSubmit}
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

function formatLocation(entry: TaxRateRow): string {
  const parts: string[] = []
  if (entry.city) parts.push(entry.city)
  if (entry.regionCode) parts.push(entry.regionCode)
  if (entry.postalCode) parts.push(entry.postalCode)
  if (entry.countryCode) parts.push(entry.countryCode.toUpperCase())
  return parts.length ? parts.join(', ') : '—'
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
