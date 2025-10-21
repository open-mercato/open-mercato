"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { AppearanceSelector, useAppearanceState } from './AppearanceSelector'
import { DictionaryValue } from './dictionaryAppearance'
import {
  invalidateDictionaryEntries,
  useDictionaryEntries,
} from './hooks/useDictionaryEntries'
import type { DictionaryEntryRecord } from './hooks/useDictionaryEntries'

type Entry = DictionaryEntryRecord

type DictionaryEntriesEditorProps = {
  dictionaryId: string
  dictionaryName: string
  readOnly?: boolean
}

type FormState = {
  id?: string | null
  value: string
  label: string
  color: string | null
  icon: string | null
}

export function DictionaryEntriesEditor({ dictionaryId, dictionaryName, readOnly = false }: DictionaryEntriesEditorProps) {
  const t = useT()
  const readOnlyMessage = t('dictionaries.config.entries.readOnly', 'Inherited dictionaries are managed at the parent organization.')
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useDictionaryEntries(dictionaryId, scopeVersion)
  const entries = React.useMemo<Entry[]>(() => dictionaryQuery.data?.fullEntries ?? [], [dictionaryQuery.data?.fullEntries])
  const dictionaryMap = dictionaryQuery.data?.map ?? {}
  const isInitialLoading = dictionaryQuery.isLoading
  const loadError = dictionaryQuery.isError
    ? dictionaryQuery.error instanceof Error
      ? dictionaryQuery.error.message
      : t('dictionaries.config.entries.error.load', 'Failed to load dictionary entries.')
    : null
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [formState, setFormState] = React.useState<FormState>(() => ({
    value: '',
    label: '',
    color: null,
    icon: null,
  }))
  const appearance = useAppearanceState(formState.icon, formState.color)

  const resetForm = React.useCallback(() => {
    setFormState({ value: '', label: '', color: null, icon: null })
    appearance.setColor(null)
    appearance.setIcon(null)
  }, [appearance])

  const openDialog = React.useCallback(
    (entry?: Entry) => {
      if (readOnly) {
        flash(readOnlyMessage, 'info')
        return
      }
      if (entry) {
        setFormState({
          id: entry.id,
          value: entry.value,
          label: entry.label,
          color: entry.color,
          icon: entry.icon,
        })
        appearance.setColor(entry.color)
        appearance.setIcon(entry.icon)
      } else {
        resetForm()
      }
      setDialogOpen(true)
    },
    [appearance, readOnly, readOnlyMessage, resetForm],
  )

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    resetForm()
  }, [resetForm])

  const handleSave = React.useCallback(async () => {
    if (readOnly) {
      flash(readOnlyMessage, 'info')
      return
    }
    if (!formState.value.trim()) {
      flash(t('dictionaries.config.entries.error.required', 'Value is required.'), 'error')
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        value: formState.value.trim(),
        label: formState.label.trim() || formState.value.trim(),
        color: appearance.color,
        icon: appearance.icon,
      }
      if (formState.id) {
        const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries/${formState.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to save dictionary entry')
        }
        flash(t('dictionaries.config.entries.success.update', 'Dictionary entry updated.'), 'success')
      } else {
        const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to create dictionary entry')
        }
        flash(t('dictionaries.config.entries.success.create', 'Dictionary entry created.'), 'success')
      }
      await invalidateDictionaryEntries(queryClient, dictionaryId)
      setDialogOpen(false)
      setFormState({ value: '', label: '', color: null, icon: null })
      appearance.setColor(null)
      appearance.setIcon(null)
    } catch (err) {
      console.error('Failed to save dictionary entry', err)
      flash(t('dictionaries.config.entries.error.save', 'Failed to save dictionary entry.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [appearance, dictionaryId, formState.id, formState.label, formState.value, queryClient, readOnly, readOnlyMessage, t])

  const handleDelete = React.useCallback(
    async (entry: Entry) => {
      if (readOnly) {
        flash(readOnlyMessage, 'info')
        return
      }
      if (!entry.id) return
      const confirmDelete = window.confirm(
        t('dictionaries.config.entries.delete.confirm', 'Delete "{{value}}"?', { value: entry.label || entry.value }),
      )
      if (!confirmDelete) return
      setIsDeleting(true)
      try {
        const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries/${entry.id}`, { method: 'DELETE' })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to delete dictionary entry')
        }
        await invalidateDictionaryEntries(queryClient, dictionaryId)
        flash(t('dictionaries.config.entries.success.delete', 'Dictionary entry deleted.'), 'success')
      } catch (err) {
        console.error('Failed to delete dictionary entry', err)
        flash(t('dictionaries.config.entries.error.delete', 'Failed to delete dictionary entry.'), 'error')
      } finally {
        setIsDeleting(false)
      }
    },
    [dictionaryId, queryClient, readOnly, readOnlyMessage, t],
  )

  const tableContent = React.useMemo(() => {
    if (isInitialLoading) {
      return (
        <TableRow>
          <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
            <Spinner className="mx-auto mb-2 h-5 w-5" />
            {t('dictionaries.config.entries.loading', 'Loading entries…')}
          </TableCell>
        </TableRow>
      )
    }
    if (loadError) {
      return (
        <TableRow>
          <TableCell colSpan={4} className="py-6 text-center text-sm text-destructive">
            {loadError}
          </TableCell>
        </TableRow>
      )
    }
    if (!entries.length) {
      return (
        <TableRow>
          <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
            {t('dictionaries.config.entries.empty', 'No entries yet.')}
          </TableCell>
        </TableRow>
      )
    }
    return entries
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      .map((entry) => (
        <TableRow key={entry.id}>
          <TableCell className="font-medium">{entry.value}</TableCell>
          <TableCell>{entry.label}</TableCell>
          <TableCell>
            <DictionaryValue
              value={entry.value}
              map={dictionaryMap}
              fallback={<span className="text-sm text-muted-foreground">{t('dictionaries.config.entries.appearance.none', 'None')}</span>}
            />
          </TableCell>
          <TableCell className="flex items-center gap-2">
            {readOnly ? (
              <span className="text-xs text-muted-foreground">
                {t('dictionaries.config.entries.readOnlyActions', 'Managed in parent organization')}
              </span>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openDialog(entry)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(entry)}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </TableCell>
      </TableRow>
      ))
  }, [dictionaryMap, entries, handleDelete, isDeleting, isInitialLoading, loadError, openDialog, readOnly, t])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{dictionaryName}</h2>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? readOnlyMessage
              : t('dictionaries.config.entries.subtitle', 'Manage reusable values and appearance for this dictionary.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              dictionaryQuery.refetch().catch(() => {})
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('dictionaries.config.entries.actions.refresh', 'Refresh')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openDialog()}
            disabled={readOnly}
            title={readOnly ? readOnlyMessage : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('dictionaries.config.entries.actions.add', 'Add entry')}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">{t('dictionaries.config.entries.columns.value', 'Value')}</TableHead>
              <TableHead className="w-48">{t('dictionaries.config.entries.columns.label', 'Label')}</TableHead>
              <TableHead>{t('dictionaries.config.entries.columns.appearance', 'Appearance')}</TableHead>
              <TableHead className="w-32 text-right">{t('dictionaries.config.entries.columns.actions', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{tableContent}</TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (!open ? closeDialog() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formState.id
                ? t('dictionaries.config.entries.dialog.editTitle', 'Edit dictionary entry')
                : t('dictionaries.config.entries.dialog.addTitle', 'Add dictionary entry')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('dictionaries.config.entries.dialog.valueLabel', 'Value')}
              </label>
              <input
                type="text"
                value={formState.value}
                onChange={(event) => setFormState((prev) => ({ ...prev, value: event.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('dictionaries.config.entries.dialog.labelLabel', 'Label')}
              </label>
              <input
                type="text"
                value={formState.label}
                onChange={(event) => setFormState((prev) => ({ ...prev, label: event.target.value }))}
                placeholder={t('dictionaries.config.entries.dialog.labelPlaceholder', 'Display name shown in UI')}
                className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <AppearanceSelector
              icon={appearance.icon}
              color={appearance.color}
              onIconChange={(next) => {
                appearance.setIcon(next)
                setFormState((prev) => ({ ...prev, icon: next }))
              }}
              onColorChange={(next) => {
                appearance.setColor(next)
                setFormState((prev) => ({ ...prev, color: next }))
              }}
              labels={{
                colorLabel: t('dictionaries.config.entries.dialog.colorLabel', 'Color'),
                colorHelp: t('dictionaries.config.entries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
                colorClearLabel: t('dictionaries.config.entries.dialog.colorClear', 'Remove color'),
                iconLabel: t('dictionaries.config.entries.dialog.iconLabel', 'Icon or emoji'),
                iconPlaceholder: t('dictionaries.config.entries.dialog.iconPlaceholder', 'Type an emoji or icon token.'),
                iconPickerTriggerLabel: t('dictionaries.config.entries.dialog.iconBrowse', 'Browse icons and emoji'),
                iconSearchPlaceholder: t('dictionaries.config.entries.dialog.iconSearchPlaceholder', 'Search icons or emojis…'),
                iconSearchEmptyLabel: t('dictionaries.config.entries.dialog.iconSearchEmpty', 'No icons match your search.'),
                iconSuggestionsLabel: t('dictionaries.config.entries.dialog.iconSuggestions', 'Suggestions'),
                iconClearLabel: t('dictionaries.config.entries.dialog.iconClear', 'Remove icon'),
                previewEmptyLabel: t('dictionaries.config.entries.dialog.previewEmpty', 'No appearance selected'),
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeDialog}
              disabled={isSaving}
            >
              {t('dictionaries.config.entries.dialog.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('dictionaries.config.entries.dialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
