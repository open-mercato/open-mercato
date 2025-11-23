"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'
import type { DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import type { CatalogPriceDisplayMode } from '../data/types'

type PriceKind = {
  id: string
  code: string
  title: string
  displayMode: CatalogPriceDisplayMode
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: PriceKind }

type PriceKindApiPayload = Partial<PriceKind> & {
  display_mode?: PriceKind['displayMode']
  currency_code?: string | null
  is_promotion?: boolean
  is_active?: boolean
  created_at?: string
  updated_at?: string
}

const DISPLAY_MODES: Array<{ value: 'including-tax' | 'excluding-tax'; label: string }> = [
  { value: 'excluding-tax', label: 'Excluding tax' },
  { value: 'including-tax', label: 'Including tax' },
]

const PAGE_SIZE = 100

type PriceKindFormState = {
  code: string
  title: string
  displayMode: CatalogPriceDisplayMode
  currencyCode: string
  isPromotion: boolean
  isActive: boolean
}

const DEFAULT_FORM: PriceKindFormState = {
  code: '',
  title: '',
  displayMode: 'excluding-tax' as const,
  currencyCode: '',
  isPromotion: false,
  isActive: true,
}

const normalizePriceKind = (input: PriceKindApiPayload | null | undefined): PriceKind => {
  const raw = input ?? {}
  const toStringValue = (value: unknown): string | null => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    return null
  }
  const toBooleanValue = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)
  const resolveDisplayMode = (value: string | null): PriceKind['displayMode'] =>
    value === 'including-tax' ? 'including-tax' : value === 'excluding-tax' ? 'excluding-tax' : 'excluding-tax'

  const displayMode = resolveDisplayMode(
    toStringValue(raw.displayMode) ?? toStringValue(raw.display_mode),
  )
  const currencyCode = toStringValue(raw.currencyCode) ?? toStringValue(raw.currency_code)
  const isPromotion = toBooleanValue(raw.isPromotion) ?? toBooleanValue(raw.is_promotion)
  const isActive = toBooleanValue(raw.isActive) ?? toBooleanValue(raw.is_active)

  return {
    id: toStringValue(raw.id) ?? '',
    code: toStringValue(raw.code) ?? '',
    title: toStringValue(raw.title) ?? '',
    displayMode,
    currencyCode: currencyCode ?? null,
    isPromotion: isPromotion ?? false,
    isActive: isActive ?? true,
    createdAt: toStringValue(raw.createdAt) ?? toStringValue(raw.created_at) ?? '',
    updatedAt: toStringValue(raw.updatedAt) ?? toStringValue(raw.updated_at) ?? '',
  }
}

export function PriceKindSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [items, setItems] = React.useState<PriceKind[]>([])
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState<PriceKindFormState>(DEFAULT_FORM)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { data: currencyDictionary, refetch: refetchCurrencyDictionary } = useCurrencyDictionary()

  const currencyOptionsLoader = React.useCallback(async (): Promise<DictionaryOption[]> => {
    if (currencyDictionary && Array.isArray(currencyDictionary.entries)) {
      return currencyDictionary.entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      }))
    }
    const payload = await refetchCurrencyDictionary()
    return payload.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [currencyDictionary, refetchCurrencyDictionary])

  const loadItems = React.useCallback(async () => {
    setLoading(true)
    const loadErrorMessage = t('catalog.priceKinds.errors.load', 'Failed to load price kinds.')
    try {
      const payload = await readApiResultOrThrow<{ items?: PriceKindApiPayload[] }>(
        `/api/catalog/price-kinds?pageSize=${PAGE_SIZE}`,
        undefined,
        { errorMessage: loadErrorMessage },
      )
      const normalized = Array.isArray(payload.items) ? payload.items.map((item) => normalizePriceKind(item)) : []
      setItems(normalized)
    } catch (err) {
      console.error('catalog.price-kinds.list failed', err)
      flash(loadErrorMessage, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadItems().catch(() => {})
  }, [loadItems, scopeVersion])

  const openDialog = React.useCallback((state: DialogState) => {
    if (state.mode === 'edit') {
      setForm({
        code: state.entry.code,
        title: state.entry.title,
        displayMode: state.entry.displayMode,
        currencyCode: state.entry.currencyCode ?? '',
        isPromotion: state.entry.isPromotion,
        isActive: state.entry.isActive,
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setError(null)
    setDialog(state)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setError(null)
    setSubmitting(false)
    setForm(DEFAULT_FORM)
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!dialog) return
    const trimmedCode = form.code.trim().toLowerCase()
    const trimmedTitle = form.title.trim()
    if (!trimmedCode || !trimmedTitle) {
      setError(t('catalog.priceKinds.errors.required', 'Code and title are required.'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        code: trimmedCode,
        title: trimmedTitle,
        displayMode: form.displayMode,
        currencyCode: form.currencyCode.trim() || undefined,
        isPromotion: form.isPromotion,
        isActive: form.isActive,
      }
      const path = '/api/catalog/price-kinds'
      const method = dialog.mode === 'create' ? 'POST' : 'PUT'
      const body =
        dialog.mode === 'edit'
          ? JSON.stringify({ id: dialog.entry.id, ...payload })
          : JSON.stringify(payload)
      const call = await apiCall(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('catalog.priceKinds.errors.save', 'Failed to save price kind.'))
      }
      flash(
        dialog.mode === 'create'
          ? t('catalog.priceKinds.messages.created', 'Price kind created.')
          : t('catalog.priceKinds.messages.updated', 'Price kind updated.'),
        'success',
      )
      closeDialog()
      await loadItems()
    } catch (err) {
      console.error('catalog.price-kinds.save failed', err)
      const message =
        err instanceof Error ? err.message : t('catalog.priceKinds.errors.save', 'Failed to save price kind.')
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [dialog, form, t, closeDialog, loadItems])

  const handleDelete = React.useCallback(
    async (entry: PriceKind) => {
      const confirmMessage = t('catalog.priceKinds.confirm.delete', 'Delete price kind "{{code}}"?').replace('{{code}}', entry.code)
      if (!window.confirm(confirmMessage)) return
      try {
        const call = await apiCall('/api/catalog/price-kinds', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: entry.id }),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, t('catalog.priceKinds.errors.delete', 'Failed to delete price kind.'))
        }
        flash(t('catalog.priceKinds.messages.deleted', 'Price kind deleted.'), 'success')
        await loadItems()
      } catch (err) {
        console.error('catalog.price-kinds.delete failed', err)
        const message =
          err instanceof Error ? err.message : t('catalog.priceKinds.errors.delete', 'Failed to delete price kind.')
        flash(message, 'error')
      }
    },
    [loadItems, t],
  )

  const formKeyHandler = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  const displayModeLabels = React.useMemo(() => ({
    'including-tax': t('catalog.priceKinds.form.displayMode.include', 'Including tax'),
    'excluding-tax': t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax'),
  }), [t])

  const displayModeOptions = React.useMemo(
    () =>
      DISPLAY_MODES.map((mode) => ({
        ...mode,
        label: displayModeLabels[mode.value],
      })),
    [displayModeLabels],
  )

  const currencyLabels = React.useMemo(() => ({
    placeholder: t('catalog.priceKinds.form.currency.placeholder', 'Select currency…'),
    addLabel: t('catalog.priceKinds.form.currency.add', 'Add currency'),
    addPrompt: t('catalog.priceKinds.form.currency.addPrompt', 'Provide a currency code.'),
    dialogTitle: t('catalog.priceKinds.form.currency.dialogTitle', 'Add currency'),
    valueLabel: t('catalog.priceKinds.form.currency.valueLabel', 'Currency code'),
    valuePlaceholder: t('catalog.priceKinds.form.currency.valuePlaceholder', 'e.g. USD'),
    labelLabel: t('catalog.priceKinds.form.currency.labelLabel', 'Display label (optional)'),
    labelPlaceholder: t('catalog.priceKinds.form.currency.labelPlaceholder', 'e.g. US Dollar'),
    emptyError: t('catalog.priceKinds.form.currency.required', 'Currency code is required.'),
    cancelLabel: t('catalog.priceKinds.form.currency.cancel', 'Cancel'),
    saveLabel: t('catalog.priceKinds.form.currency.save', 'Save'),
    saveShortcutHint: t('catalog.priceKinds.form.currency.saveShortcut', 'Press Enter to save'),
    successCreateLabel: t('catalog.priceKinds.form.currency.success', 'Currency added.'),
    errorLoad: t('catalog.priceKinds.form.currency.loadError', 'Unable to load currencies.'),
    errorSave: t('catalog.priceKinds.form.currency.createError', 'Unable to add currency.'),
    loadingLabel: t('catalog.priceKinds.form.currency.loading', 'Loading currencies…'),
    manageTitle: t('catalog.priceKinds.form.currency.manage', 'Manage currencies'),
  }), [t])

  const tableLabels = React.useMemo(() => ({
    code: t('catalog.priceKinds.table.code', 'Code'),
    title: t('catalog.priceKinds.table.title', 'Title'),
    displayMode: t('catalog.priceKinds.table.displayMode', 'Display mode'),
    currency: t('catalog.priceKinds.table.currency', 'Currency'),
    promotion: t('catalog.priceKinds.table.promotion', 'Promotion'),
    promotionYes: t('catalog.priceKinds.table.promotionYes', 'Yes'),
    promotionNo: t('catalog.priceKinds.table.promotionNo', 'No'),
    active: t('catalog.priceKinds.table.active', 'Active'),
    activeYes: t('catalog.priceKinds.table.activeYes', 'Active'),
    activeNo: t('catalog.priceKinds.table.activeNo', 'Inactive'),
    search: t('catalog.priceKinds.search.placeholder', 'Search by code or title…'),
    empty: t('catalog.priceKinds.table.empty', 'No price kinds yet.'),
  }), [t])

  const columns = React.useMemo<ColumnDef<PriceKind>[]>(() => [
    {
      accessorKey: 'code',
      header: tableLabels.code,
      cell: ({ row }) => <span className="font-mono uppercase">{row.original.code}</span>,
    },
    {
      accessorKey: 'title',
      header: tableLabels.title,
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    {
      accessorKey: 'displayMode',
      header: tableLabels.displayMode,
      cell: ({ row }) => displayModeLabels[row.original.displayMode] ?? row.original.displayMode,
    },
    {
      accessorKey: 'currencyCode',
      header: tableLabels.currency,
      cell: ({ row }) => (row.original.currencyCode ? row.original.currencyCode.toUpperCase() : '—'),
    },
    {
      id: 'promotion',
      header: tableLabels.promotion,
      cell: ({ row }) =>
        row.original.isPromotion ? (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
            {tableLabels.promotionYes}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
            {tableLabels.promotionNo}
          </span>
        ),
    },
    {
      id: 'active',
      header: tableLabels.active,
      cell: ({ row }) =>
        row.original.isActive ? (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-100">
            {tableLabels.activeYes}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
            {tableLabels.activeNo}
          </span>
        ),
    },
  ], [displayModeLabels, tableLabels])

  const filteredItems = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) => {
      const currency = (item.currencyCode ?? '').toLowerCase()
      const modeLabel = (displayModeLabels[item.displayMode] ?? item.displayMode).toLowerCase()
      return (
        item.code.toLowerCase().includes(term) ||
        item.title.toLowerCase().includes(term) ||
        currency.includes(term) ||
        modeLabel.includes(term)
      )
    })
  }, [displayModeLabels, items, search])

  const handleRowClick = React.useCallback((entry: PriceKind) => {
    openDialog({ mode: 'edit', entry })
  }, [openDialog])

  return (
    <section className="border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-semibold">{t('catalog.priceKinds.title', 'Price kinds')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('catalog.priceKinds.description', 'Configure reusable price kinds that control pricing columns and tax display.')}
        </p>
      </div>
      <div className="px-2 py-4 sm:px-4">
        <DataTable<PriceKind>
          data={filteredItems}
          columns={columns}
          embedded
          isLoading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={tableLabels.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{tableLabels.empty}</p>}
          actions={(
            <Button size="sm" onClick={() => openDialog({ mode: 'create' })}>
              {t('catalog.priceKinds.actions.add', 'Add price kind')}
            </Button>
          )}
          refreshButton={{
            label: t('catalog.priceKinds.actions.refresh', 'Refresh'),
            onRefresh: () => { void loadItems() },
            isRefreshing: loading,
          }}
          rowActions={(entry) => (
            <RowActions
              items={[
                {
                  label: t('catalog.priceKinds.actions.edit', 'Edit'),
                  onSelect: () => openDialog({ mode: 'edit', entry }),
                },
                {
                  label: t('catalog.priceKinds.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(entry) },
                },
              ]}
            />
          )}
          onRowClick={handleRowClick}
        />
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('catalog.priceKinds.dialog.editTitle', 'Edit price kind')
                : t('catalog.priceKinds.dialog.createTitle', 'Create price kind')}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'edit'
                ? t('catalog.priceKinds.dialog.editDescription', 'Update labels or tax behavior for this price kind.')
                : t('catalog.priceKinds.dialog.createDescription', 'Define a reusable price kind for product pricing.')}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onKeyDown={formKeyHandler} onSubmit={(event) => { event.preventDefault(); void handleSubmit() }}>
            <div className="space-y-2">
              <Label htmlFor="price-kind-code">{t('catalog.priceKinds.form.codeLabel', 'Code')}</Label>
              <Input
                id="price-kind-code"
                value={form.code}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder={t('catalog.priceKinds.form.codePlaceholder', 'e.g. regular')}
                className="font-mono uppercase"
                disabled={dialog?.mode === 'edit'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price-kind-title">{t('catalog.priceKinds.form.titleLabel', 'Title')}</Label>
              <Input
                id="price-kind-title"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder={t('catalog.priceKinds.form.titlePlaceholder', 'e.g. Regular price')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('catalog.priceKinds.form.displayModeLabel', 'Display mode')}</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {displayModeOptions.map((mode) => (
                  <label
                    key={mode.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                      form.displayMode === mode.value ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <input
                      type="radio"
                      name="displayMode"
                      value={mode.value}
                      checked={form.displayMode === mode.value}
                      onChange={() => setForm((prev) => ({ ...prev, displayMode: mode.value }))}
                    />
                    <span>{mode.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('catalog.priceKinds.form.currencyLabel', 'Currency (optional)')}</Label>
              <DictionaryEntrySelect
                value={form.currencyCode || undefined}
                onChange={(value) => setForm((prev) => ({ ...prev, currencyCode: value ?? '' }))}
                fetchOptions={currencyOptionsLoader}
                labels={currencyLabels}
                allowInlineCreate={false}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border"
                  checked={form.isPromotion}
                  onChange={(event) => setForm((prev) => ({ ...prev, isPromotion: event.target.checked }))}
                />
                {t('catalog.priceKinds.form.promotionLabel', 'Mark as promotion')}
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border"
                  checked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                {t('catalog.priceKinds.form.activeLabel', 'Active')}
              </label>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              {t('catalog.priceKinds.actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {dialog?.mode === 'edit'
                ? t('catalog.priceKinds.actions.saveChanges', 'Save changes')
                : t('catalog.priceKinds.actions.create', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
