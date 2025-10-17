"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'

type DictionaryKind = 'statuses' | 'sources' | 'lifecycle-stages'

type DictionaryEntry = {
  id: string
  value: string
  label: string
}

export default DictionarySettings

type DictionarySectionProps = {
  kind: DictionaryKind
  title: string
  description: string
  valueLabel: string
  labelLabel: string
  actionsLabel: string
  emptyLabel: string
  addLabel: string
  editLabel: string
  deleteLabel: string
  refreshLabel: string
  addDialogTitle: string
  editDialogTitle: string
  dialogValueLabel: string
  dialogLabelLabel: string
  dialogSaveLabel: string
  dialogCancelLabel: string
  deleteConfirmTemplate: string
  requiredValueMessage: string
  errorLoad: string
  errorSave: string
  errorDelete: string
  successSave: string
  successDelete: string
}

export function DictionarySettings() {
  const t = useT()

  const common = React.useMemo(() => ({
    valueLabel: t('customers.config.dictionaries.columns.value', 'Value'),
    labelLabel: t('customers.config.dictionaries.columns.label', 'Label'),
    actionsLabel: t('customers.config.dictionaries.columns.actions', 'Actions'),
    emptyLabel: t('customers.config.dictionaries.empty', 'No entries yet.'),
    addLabel: t('customers.config.dictionaries.actions.add', 'Add entry'),
    editLabel: t('customers.config.dictionaries.actions.edit', 'Edit'),
    deleteLabel: t('customers.config.dictionaries.actions.delete', 'Delete'),
    refreshLabel: t('customers.config.dictionaries.actions.refresh', 'Refresh'),
    addDialogTitle: t('customers.config.dictionaries.dialog.addTitle', 'Add entry'),
    editDialogTitle: t('customers.config.dictionaries.dialog.editTitle', 'Edit entry'),
    dialogValueLabel: t('customers.config.dictionaries.dialog.valueLabel', 'Value'),
    dialogLabelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'),
    dialogSaveLabel: t('customers.config.dictionaries.dialog.save', 'Save'),
    dialogCancelLabel: t('customers.config.dictionaries.dialog.cancel', 'Cancel'),
    deleteConfirmTemplate: t('customers.config.dictionaries.deleteConfirm', 'Delete "{{value}}"?'),
    requiredValueMessage: t('customers.config.dictionaries.errors.required', 'Please provide a value.'),
    errorLoad: t('customers.config.dictionaries.error.load', 'Failed to load dictionary entries.'),
    errorSave: t('customers.config.dictionaries.error.save', 'Failed to save dictionary entry.'),
    errorDelete: t('customers.config.dictionaries.error.delete', 'Failed to delete dictionary entry.'),
    successSave: t('customers.config.dictionaries.success.save', 'Dictionary entry saved.'),
    successDelete: t('customers.config.dictionaries.success.delete', 'Dictionary entry deleted.'),
  }), [t])

  const sections = React.useMemo(() => ([
    {
      kind: 'statuses' as const,
      title: t('customers.config.dictionaries.sections.statuses.title', 'Statuses'),
      description: t('customers.config.dictionaries.sections.statuses.description', 'Define the statuses available for customer records.'),
    },
    {
      kind: 'sources' as const,
      title: t('customers.config.dictionaries.sections.sources.title', 'Sources'),
      description: t('customers.config.dictionaries.sections.sources.description', 'Capture how customers were acquired.'),
    },
    {
      kind: 'lifecycle-stages' as const,
      title: t('customers.config.dictionaries.sections.lifecycle.title', 'Lifecycle stages'),
      description: t('customers.config.dictionaries.sections.lifecycle.description', 'Configure lifecycle stages to track customer progress.'),
    },
  ]), [t])

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t('customers.config.dictionaries.title', 'Customers dictionaries')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('customers.config.dictionaries.description', 'Manage the dictionaries used by the customers module.')}
        </p>
      </header>

      <div className="space-y-6">
        {sections.map((section) => (
          <DictionarySection
            key={section.kind}
            kind={section.kind}
            title={section.title}
            description={section.description}
            {...common}
          />
        ))}
      </div>
    </div>
  )
}

type FormState = {
  value: string
  label: string
}

function DictionarySection({
  kind,
  title,
  description,
  valueLabel,
  labelLabel,
  actionsLabel,
  emptyLabel,
  addLabel,
  editLabel,
  deleteLabel,
  refreshLabel,
  addDialogTitle,
  editDialogTitle,
  dialogValueLabel,
  dialogLabelLabel,
  dialogSaveLabel,
  dialogCancelLabel,
  deleteConfirmTemplate,
  requiredValueMessage,
  errorLoad,
  errorSave,
  errorDelete,
  successSave,
  successDelete,
}: DictionarySectionProps) {
  const [entries, setEntries] = React.useState<DictionaryEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<DictionaryEntry | null>(null)
  const [formState, setFormState] = React.useState<FormState>({ value: '', label: '' })
  const [saving, setSaving] = React.useState(false)

  const resetForm = React.useCallback(() => {
    setFormState({ value: '', label: '' })
    setSaving(false)
  }, [])

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : errorLoad
        setError(message)
        flash(message, 'error')
        setEntries([])
        return
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const normalized = items
        .map((item: any) => {
          const id = typeof item?.id === 'string' ? item.id : null
          const value = typeof item?.value === 'string' ? item.value.trim() : ''
          if (!id || !value) return null
          const label = typeof item?.label === 'string' && item.label.trim().length ? item.label.trim() : value
          return { id, value, label }
        })
        .filter((entry): entry is DictionaryEntry => !!entry)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      setEntries(normalized)
    } catch (err: any) {
      const message = err?.message || errorLoad
      setError(message)
      flash(message, 'error')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [kind, errorLoad])

  React.useEffect(() => {
    loadEntries().catch(() => {})
  }, [loadEntries])

  const openCreateDialog = React.useCallback(() => {
    resetForm()
    setAddOpen(true)
  }, [resetForm])

  const openEditDialog = React.useCallback((entry: DictionaryEntry) => {
    setEditTarget(entry)
    setFormState({ value: entry.value, label: entry.label })
    setEditOpen(true)
  }, [])

  const closeDialogs = React.useCallback(() => {
    setAddOpen(false)
    setEditOpen(false)
    setEditTarget(null)
    resetForm()
  }, [resetForm])

  const handleInputChange = React.useCallback((field: keyof FormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleCreate = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const value = formState.value.trim()
    const label = formState.label.trim()
    if (!value) {
      flash(requiredValueMessage, 'error')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, label: label || undefined }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : errorSave
        flash(message, 'error')
        return
      }
      flash(successSave, 'success')
      closeDialogs()
      await loadEntries()
    } catch {
      flash(errorSave, 'error')
    } finally {
      setSaving(false)
    }
  }, [closeDialogs, errorSave, formState.label, formState.value, kind, loadEntries, saving, successSave])

  const handleUpdate = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !editTarget) return
    const value = formState.value.trim()
    const label = formState.label.trim()
    if (!value) {
      flash(requiredValueMessage, 'error')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}/${encodeURIComponent(editTarget.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, label: label || undefined }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : errorSave
        flash(message, 'error')
        return
      }
      flash(successSave, 'success')
      closeDialogs()
      await loadEntries()
    } catch {
      flash(errorSave, 'error')
    } finally {
      setSaving(false)
    }
  }, [closeDialogs, editTarget, errorSave, formState.label, formState.value, kind, loadEntries, saving, successSave])

  const handleDelete = React.useCallback(async (entry: DictionaryEntry) => {
    const message = deleteConfirmTemplate.replace('{{value}}', entry.label || entry.value)
    if (!window.confirm(message)) return
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        let payload: any = null
        try {
          payload = await res.json()
        } catch {}
        const errMessage = typeof payload?.error === 'string' ? payload.error : errorDelete
        flash(errMessage, 'error')
        return
      }
      flash(successDelete, 'success')
      await loadEntries()
    } catch {
      flash(errorDelete, 'error')
    }
  }, [deleteConfirmTemplate, errorDelete, kind, loadEntries, successDelete])

  return (
    <section className="rounded border bg-card text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadEntries()}
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={addOpen} onOpenChange={(open) => (open ? openCreateDialog() : closeDialogs())}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                {addLabel}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{addDialogTitle}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">{dialogValueLabel}</label>
                  <input
                    type="text"
                    value={formState.value}
                    onChange={(event) => handleInputChange('value', event.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">{dialogLabelLabel}</label>
                  <input
                    type="text"
                    value={formState.label}
                    onChange={(event) => handleInputChange('label', event.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeDialogs} disabled={saving}>
                    {dialogCancelLabel}
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {dialogSaveLabel}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">{valueLabel}</TableHead>
                <TableHead className="w-1/3">{labelLabel}</TableHead>
                <TableHead className="w-1/3 text-right">{actionsLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.value}</TableCell>
                  <TableCell>{entry.label}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Dialog open={editOpen && editTarget?.id === entry.id} onOpenChange={(open) => (open ? openEditDialog(entry) : closeDialogs())}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Pencil className="mr-2 h-4 w-4" />
                            {editLabel}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>{editDialogTitle}</DialogTitle>
                            <DialogDescription>{description}</DialogDescription>
                          </DialogHeader>
                          <form className="space-y-4" onSubmit={handleUpdate}>
                            <div className="space-y-2">
                              <label className="block text-sm font-medium">{dialogValueLabel}</label>
                              <input
                                type="text"
                                value={formState.value}
                                onChange={(event) => handleInputChange('value', event.target.value)}
                                className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                required
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-sm font-medium">{dialogLabelLabel}</label>
                              <input
                                type="text"
                                value={formState.label}
                                onChange={(event) => handleInputChange('label', event.target.value)}
                                className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              />
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" onClick={closeDialogs} disabled={saving}>
                                {dialogCancelLabel}
                              </Button>
                              <Button type="submit" disabled={saving}>
                                {dialogSaveLabel}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        title={deleteLabel}
                        aria-label={deleteLabel}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  )
}
