"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AdjustmentKind = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
  createdAt: string | null
  updatedAt: string | null
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: AdjustmentKind }

type FormState = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

const DEFAULT_FORM: FormState = {
  value: '',
  label: '',
  color: null,
  icon: null,
}

const PAGE_SIZE = 100

const normalizeEntry = (raw: any): AdjustmentKind | null => {
  if (!raw || typeof raw !== 'object') return null
  const value = typeof raw.value === 'string' ? raw.value.trim() : ''
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!value || !id) return null
  const label = typeof raw.label === 'string' && raw.label.trim().length ? raw.label.trim() : value
  const color =
    typeof raw.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(raw.color) ? `#${raw.color.slice(1).toLowerCase()}` : null
  const icon = typeof raw.icon === 'string' && raw.icon.trim().length ? raw.icon.trim() : null
  return {
    id,
    value,
    label,
    color,
    icon,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

export function AdjustmentKindSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [items, setItems] = React.useState<AdjustmentKind[]>([])
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const labels = React.useMemo(
    () => ({
      title: t('sales.config.adjustmentKinds.title', 'Adjustment kinds'),
      description: t(
        'sales.config.adjustmentKinds.description',
        'Manage reusable adjustment kinds for taxes, surcharges, shipping, and discounts.'
      ),
      add: t('sales.config.adjustmentKinds.actions.add', 'Add adjustment kind'),
      refresh: t('sales.config.adjustmentKinds.actions.refresh', 'Refresh'),
      edit: t('sales.config.adjustmentKinds.actions.edit', 'Edit'),
      delete: t('sales.config.adjustmentKinds.actions.delete', 'Delete'),
      deleteConfirm: t('sales.config.adjustmentKinds.confirm.delete', 'Delete adjustment kind "{{code}}"?'),
      createTitle: t('sales.config.adjustmentKinds.dialog.createTitle', 'Create adjustment kind'),
      editTitle: t('sales.config.adjustmentKinds.dialog.editTitle', 'Edit adjustment kind'),
      createDescription: t(
        'sales.config.adjustmentKinds.dialog.createDescription',
        'Define a reusable adjustment kind shown in document adjustment dialogs.'
      ),
      editDescription: t(
        'sales.config.adjustmentKinds.dialog.editDescription',
        'Update the code, label, or appearance for this adjustment kind.'
      ),
      codeLabel: t('sales.config.adjustmentKinds.form.codeLabel', 'Code'),
      codePlaceholder: t('sales.config.adjustmentKinds.form.codePlaceholder', 'e.g. discount'),
      labelLabel: t('sales.config.adjustmentKinds.form.labelLabel', 'Label'),
      labelPlaceholder: t('sales.config.adjustmentKinds.form.labelPlaceholder', 'e.g. Discount'),
      appearanceLabel: t('sales.config.adjustmentKinds.form.appearanceLabel', 'Appearance'),
      saveCreate: t('sales.config.adjustmentKinds.actions.create', 'Create'),
      saveEdit: t('sales.config.adjustmentKinds.actions.save', 'Save changes'),
      cancel: t('ui.actions.cancel', 'Cancel'),
      required: t('sales.config.adjustmentKinds.errors.required', 'Code is required.'),
      loadError: t('sales.config.adjustmentKinds.errors.load', 'Failed to load adjustment kinds.'),
      saveError: t('sales.config.adjustmentKinds.errors.save', 'Failed to save adjustment kind.'),
      deleteError: t('sales.config.adjustmentKinds.errors.delete', 'Failed to delete adjustment kind.'),
      created: t('sales.config.adjustmentKinds.messages.created', 'Adjustment kind created.'),
      updated: t('sales.config.adjustmentKinds.messages.updated', 'Adjustment kind updated.'),
      deleted: t('sales.config.adjustmentKinds.messages.deleted', 'Adjustment kind deleted.'),
      empty: t('sales.config.adjustmentKinds.table.empty', 'No adjustment kinds yet.'),
      searchPlaceholder: t('sales.config.adjustmentKinds.search.placeholder', 'Search by code or label…'),
      columns: {
        code: t('sales.config.adjustmentKinds.table.code', 'Code'),
        label: t('sales.config.adjustmentKinds.table.label', 'Label'),
        appearance: t('sales.config.adjustmentKinds.table.appearance', 'Appearance'),
      },
      appearanceLabels: {
        colorLabel: t('dictionaries.form.colorLabel', 'Color'),
        colorHelp: t('dictionaries.form.colorHelp', 'Pick a highlight color.'),
        colorClearLabel: t('dictionaries.form.colorClear', 'Remove color'),
        iconLabel: t('dictionaries.form.iconLabel', 'Icon or emoji'),
        iconPlaceholder: t('dictionaries.form.iconPlaceholder', 'Type an emoji or icon token.'),
        iconPickerTriggerLabel: t('dictionaries.form.iconPickerTriggerLabel', 'Browse icons and emoji'),
        iconSearchPlaceholder: t('dictionaries.form.iconSearchPlaceholder', 'Search icons or emojis…'),
        iconSearchEmptyLabel: t('dictionaries.form.iconSearchEmptyLabel', 'No icons match your search.'),
        iconSuggestionsLabel: t('dictionaries.form.iconSuggestionsLabel', 'Suggestions'),
        iconClearLabel: t('dictionaries.form.iconClearLabel', 'Remove icon'),
        previewEmptyLabel: t('dictionaries.form.previewEmptyLabel', 'No appearance selected'),
      },
    }),
    [t]
  )

  const loadItems = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: any[] }>(
        `/api/sales/adjustment-kinds?pageSize=${PAGE_SIZE}`,
        undefined,
        { errorMessage: labels.loadError }
      )
      const mapped = Array.isArray(payload.items)
        ? payload.items
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is AdjustmentKind => Boolean(entry))
        : []
      setItems(mapped)
    } catch (err) {
      console.error('sales.adjustment-kinds.list failed', err)
      flash(labels.loadError, 'error')
    } finally {
      setLoading(false)
    }
  }, [labels.loadError])

  React.useEffect(() => {
    loadItems().catch(() => {})
  }, [loadItems, scopeVersion])

  const openDialog = React.useCallback((state: DialogState) => {
    if (state.mode === 'edit') {
      setForm({
        value: state.entry.value,
        label: state.entry.label,
        color: state.entry.color,
        icon: state.entry.icon,
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setError(null)
    setDialog(state)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setSubmitting(false)
    setError(null)
    setForm(DEFAULT_FORM)
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!dialog) return
    const trimmedValue = form.value.trim()
    const trimmedLabel = form.label.trim()
    if (!trimmedValue) {
      setError(labels.required)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        value: trimmedValue,
      }
      if (trimmedLabel) payload.label = trimmedLabel
      if (form.color !== undefined) payload.color = form.color
      if (form.icon !== undefined) payload.icon = form.icon

      const method = dialog.mode === 'create' ? 'POST' : 'PUT'
      const body =
        dialog.mode === 'create'
          ? JSON.stringify(payload)
          : JSON.stringify({ id: dialog.entry.id, ...payload })

      const call = await apiCall('/api/sales/adjustment-kinds', {
        method,
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (!call.ok) {
        await raiseCrudError(call.response, labels.saveError)
      }
      flash(dialog.mode === 'create' ? labels.created : labels.updated, 'success')
      closeDialog()
      await loadItems()
    } catch (err) {
      console.error('sales.adjustment-kinds.save failed', err)
      const message = err instanceof Error ? err.message : labels.saveError
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, form.color, form.icon, form.label, form.value, labels, loadItems])

  const handleDelete = React.useCallback(
    async (entry: AdjustmentKind) => {
      const message = labels.deleteConfirm.replace('{{code}}', entry.label || entry.value)
      if (!window.confirm(message)) return
      try {
        const call = await apiCall('/api/sales/adjustment-kinds', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: entry.id }),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, labels.deleteError)
        }
        flash(labels.deleted, 'success')
        await loadItems()
      } catch (err) {
        console.error('sales.adjustment-kinds.delete failed', err)
        const message = err instanceof Error ? err.message : labels.deleteError
        flash(message, 'error')
      }
    },
    [labels, loadItems]
  )

  const formKeyHandler = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit]
  )

  const columns = React.useMemo<ColumnDef<AdjustmentKind>[]>(() => [
    {
      accessorKey: 'value',
      header: labels.columns.code,
      cell: ({ row }) => <span className="font-mono uppercase">{row.original.value}</span>,
    },
    {
      accessorKey: 'label',
      header: labels.columns.label,
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    },
    {
      id: 'appearance',
      header: labels.columns.appearance,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {renderDictionaryIcon(row.original.icon, 'h-4 w-4')}
          {renderDictionaryColor(row.original.color, 'h-4 w-4 rounded-full')}
        </div>
      ),
    },
  ], [labels.columns.appearance, labels.columns.code, labels.columns.label])

  const filteredItems = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) => item.value.toLowerCase().includes(term) || item.label.toLowerCase().includes(term))
  }, [items, search])

  const onRowClick = React.useCallback((entry: AdjustmentKind) => {
    openDialog({ mode: 'edit', entry })
  }, [openDialog])

  return (
    <section className="border bg-card text-card-foreground shadow-sm" id="adjustment-kinds">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <p className="text-sm text-muted-foreground">{labels.description}</p>
      </div>
      <div className="px-2 py-4 sm:px-4">
        <DataTable<AdjustmentKind>
          data={filteredItems}
          columns={columns}
          embedded
          isLoading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={labels.searchPlaceholder}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>}
          actions={(
            <Button size="sm" onClick={() => openDialog({ mode: 'create' })}>
              {labels.add}
            </Button>
          )}
          refreshButton={{
            label: labels.refresh,
            onRefresh: () => { void loadItems() },
            isRefreshing: loading,
          }}
          rowActions={(entry) => (
            <RowActions
              items={[
                { id: 'edit', label: labels.edit, onSelect: () => openDialog({ mode: 'edit', entry }) },
                { id: 'delete', label: labels.delete, destructive: true, onSelect: () => { void handleDelete(entry) } },
              ]}
            />
          )}
          onRowClick={onRowClick}
        />
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? labels.editTitle : labels.createTitle}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'edit' ? labels.editDescription : labels.createDescription}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onKeyDown={formKeyHandler}
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="adjustment-kind-code">{labels.codeLabel}</Label>
              <Input
                id="adjustment-kind-code"
                value={form.value}
                onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
                placeholder={labels.codePlaceholder}
                className="font-mono uppercase"
                disabled={dialog?.mode === 'edit'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-kind-label">{labels.labelLabel}</Label>
              <Input
                id="adjustment-kind-label"
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder={labels.labelPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{labels.appearanceLabel}</Label>
              <AppearanceSelector
                color={form.color}
                icon={form.icon}
                onColorChange={(next) => setForm((prev) => ({ ...prev, color: next }))}
                onIconChange={(next) => setForm((prev) => ({ ...prev, icon: next }))}
                labels={labels.appearanceLabels}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              {labels.cancel}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {dialog?.mode === 'edit' ? labels.saveEdit : labels.saveCreate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
