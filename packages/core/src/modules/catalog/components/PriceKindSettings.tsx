"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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

type PriceKind = {
  id: string
  code: string
  title: string
  displayMode: 'including-tax' | 'excluding-tax'
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: PriceKind }

const DISPLAY_MODES: Array<{ value: 'including-tax' | 'excluding-tax'; label: string }> = [
  { value: 'excluding-tax', label: 'Excluding tax' },
  { value: 'including-tax', label: 'Including tax' },
]

const DEFAULT_FORM = {
  code: '',
  title: '',
  displayMode: 'excluding-tax' as const,
  currencyCode: '',
  isPromotion: false,
  isActive: true,
}

export function PriceKindSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [items, setItems] = React.useState<PriceKind[]>([])
  const [loading, setLoading] = React.useState(false)
  const [searchDraft, setSearchDraft] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState(DEFAULT_FORM)
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
    try {
      const params = new URLSearchParams({ pageSize: '200' })
      if (search.trim().length) params.set('search', search.trim())
      const payload = await readApiResultOrThrow<{ items?: PriceKind[] }>(
        `/api/catalog/price-kinds?${params.toString()}`,
        undefined,
        { errorMessage: t('catalog.priceKinds.errors.load', 'Failed to load price kinds.') },
      )
      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (err) {
      console.error('catalog.price-kinds.list failed', err)
      flash(t('catalog.priceKinds.errors.load', 'Failed to load price kinds.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [search, t])

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

  const displayModeOptions = React.useMemo(
    () =>
      DISPLAY_MODES.map((mode) => ({
        ...mode,
        label:
          mode.value === 'including-tax'
            ? t('catalog.priceKinds.form.displayMode.include', 'Including tax')
            : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax'),
      })),
    [t],
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

  const tableEmpty = !loading && items.length === 0

  return (
    <section className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-4 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('catalog.priceKinds.title', 'Price kinds')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('catalog.priceKinds.description', 'Configure reusable price kinds that control pricing columns and tax display.')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openDialog({ mode: 'create' })}>
          <Plus className="mr-2 h-4 w-4" />
          {t('catalog.priceKinds.actions.add', 'Add price kind')}
        </Button>
      </div>
      <div className="space-y-4 p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t('catalog.priceKinds.search.placeholder', 'Search by code or title…')}
            className="md:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSearch(searchDraft.trim())} disabled={loading}>
              {t('catalog.priceKinds.actions.search', 'Search')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setSearch(''); setSearchDraft('') }} disabled={loading}>
              {t('catalog.priceKinds.actions.clear', 'Clear')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => loadItems()} disabled={loading}>
              {t('catalog.priceKinds.actions.refresh', 'Refresh')}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.code', 'Code')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.title', 'Title')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.displayMode', 'Display mode')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.currency', 'Currency')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.promotion', 'Promotion')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.active', 'Active')}</th>
                <th className="px-4 py-2 font-medium">{t('catalog.priceKinds.table.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs uppercase">{entry.code}</td>
                  <td className="px-4 py-2">{entry.title}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                      {entry.displayMode === 'including-tax'
                        ? t('catalog.priceKinds.form.displayMode.include', 'Including tax')
                        : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax')}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.currencyCode ? (
                      <span className="font-mono text-xs uppercase">{entry.currencyCode}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.isPromotion ? (
                      <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-900 dark:border-purple-500/50 dark:bg-purple-500/10 dark:text-purple-100">
                        {t('catalog.priceKinds.table.promotionYes', 'Yes')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('catalog.priceKinds.table.promotionNo', 'No')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.isActive ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-100">
                        {t('catalog.priceKinds.table.activeYes', 'Active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                        {t('catalog.priceKinds.table.activeNo', 'Inactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => openDialog({ mode: 'edit', entry })}>
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">{t('catalog.priceKinds.actions.edit', 'Edit')}</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(entry)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">{t('catalog.priceKinds.actions.delete', 'Delete')}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {tableEmpty ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('catalog.priceKinds.table.empty', 'No price kinds yet.')}
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('catalog.priceKinds.table.loading', 'Loading…')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
