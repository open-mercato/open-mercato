"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DictionaryEntriesEditor } from './DictionaryEntriesEditor'

export type DictionarySummary = {
  id: string
  key: string
  name: string
  description?: string | null
  isSystem?: boolean
  isActive?: boolean
  organizationId: string
  isInherited: boolean
  managerVisibility: 'default' | 'hidden'
}

type DialogState = {
  mode: 'create' | 'edit'
  dictionary?: DictionarySummary
}

export function DictionariesManager() {
  const t = useT()
  const [items, setItems] = React.useState<DictionarySummary[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState({ key: '', name: '', description: '' })
  const [errors, setErrors] = React.useState<{ key?: string; name?: string }>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const inheritedManageMessage = t('dictionaries.config.error.inheritedManage', 'Inherited dictionaries must be managed at the parent organization.')

  const loadDictionaries = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<{ items?: unknown[]; error?: string }>('/api/dictionaries')
      if (!call.ok) {
        throw new Error(typeof call.result?.error === 'string' ? call.result.error : 'Failed to load dictionaries')
      }
      const resultItems = Array.isArray(call.result?.items) ? call.result!.items : []
      const list: DictionarySummary[] = Array.isArray(resultItems)
        ? resultItems.map((item: any): DictionarySummary => ({
            id: String(item.id),
            key: String(item.key),
            name: String(item.name ?? item.key),
            description: typeof item.description === 'string' ? item.description : null,
            isSystem: Boolean(item.isSystem),
            isActive: item.isActive !== false,
            organizationId: typeof item.organizationId === 'string' ? item.organizationId : '',
            isInherited: item.isInherited === true,
            managerVisibility:
              item.managerVisibility === 'hidden' ? 'hidden' : 'default',
          }))
        : []
      const filtered = list.filter((dictionary: DictionarySummary) => dictionary.managerVisibility !== 'hidden')
      setItems(filtered)
      if (!filtered.find((dict: DictionarySummary) => dict.id === selectedId)) {
        setSelectedId(filtered.length ? filtered[0].id : null)
      }
    } catch (err) {
      console.error('Failed to load dictionaries', err)
      flash(t('dictionaries.config.error.load', 'Failed to load dictionaries.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedId, t])

  React.useEffect(() => {
    loadDictionaries().catch(() => {})
  }, [loadDictionaries])

  const openCreateDialog = React.useCallback(() => {
    setForm({ key: '', name: '', description: '' })
    setDialog({ mode: 'create' })
    setErrors({})
  }, [])

  const openEditDialog = React.useCallback((dictionary: DictionarySummary) => {
    if (dictionary.isInherited) {
      flash(inheritedManageMessage, 'info')
      return
    }
    setForm({ key: dictionary.key, name: dictionary.name, description: dictionary.description ?? '' })
    setDialog({ mode: 'edit', dictionary })
    setErrors({})
  }, [inheritedManageMessage])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setForm({ key: '', name: '', description: '' })
    setErrors({})
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!dialog) return
    if (dialog.mode === 'edit' && dialog.dictionary?.isInherited) {
      flash(inheritedManageMessage, 'info')
      return
    }
    const trimmedKey = form.key.trim()
    const trimmedName = form.name.trim()
    const nextErrors: { key?: string; name?: string } = {}
    if (!trimmedKey) {
      nextErrors.key = t('dictionaries.config.dialog.keyErrorRequired', 'Key is required.')
    } else if (trimmedKey.length > 100) {
      nextErrors.key = t('dictionaries.config.dialog.keyErrorLength', 'Key must be at most 100 characters long.')
    } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmedKey)) {
      nextErrors.key = t('dictionaries.config.dialog.keyErrorPattern', 'Use lowercase letters, numbers, hyphen, or underscore.')
    }
    if (!trimmedName) {
      nextErrors.name = t('dictionaries.config.dialog.nameErrorRequired', 'Name is required.')
    }
    if (nextErrors.key || nextErrors.name) {
      setErrors(nextErrors)
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        key: trimmedKey,
        name: trimmedName,
        description: form.description.trim() || undefined,
      }
      if (dialog.mode === 'create') {
        const call = await apiCall<Record<string, unknown>>('/api/dictionaries', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!call.ok) {
          throw new Error(typeof call.result?.error === 'string' ? call.result.error : 'Failed to create dictionary')
        }
        flash(t('dictionaries.config.success.create', 'Dictionary created.'), 'success')
      } else if (dialog.dictionary) {
        const call = await apiCall<Record<string, unknown>>(`/api/dictionaries/${dialog.dictionary.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!call.ok) {
          throw new Error(typeof call.result?.error === 'string' ? call.result.error : 'Failed to update dictionary')
        }
        flash(t('dictionaries.config.success.update', 'Dictionary updated.'), 'success')
      }
      closeDialog()
      await loadDictionaries()
      setErrors({})
    } catch (err) {
      console.error('Failed to save dictionary', err)
      flash(t('dictionaries.config.error.save', 'Failed to save dictionary.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, form.description, form.key, form.name, inheritedManageMessage, loadDictionaries, t])

  const handleDelete = React.useCallback(
    async (dictionary: DictionarySummary) => {
      if (dictionary.isInherited) {
        flash(inheritedManageMessage, 'info')
        return
      }
      if (dictionary.isSystem) {
        flash(t('dictionaries.config.error.system', 'System dictionaries cannot be deleted.'), 'error')
        return
      }
      const rawConfirm = t('dictionaries.config.delete.confirm', { name: dictionary.name })
      const confirmMessage = rawConfirm && rawConfirm !== 'dictionaries.config.delete.confirm'
        ? rawConfirm
        : `Delete dictionary "${dictionary.name}"?`
      const confirmed = window.confirm(confirmMessage)
      if (!confirmed) return
      setDeleting(dictionary.id)
      try {
        const call = await apiCall<Record<string, unknown>>(`/api/dictionaries/${dictionary.id}`, { method: 'DELETE' })
        if (!call.ok) {
          throw new Error(typeof call.result?.error === 'string' ? call.result.error : 'Failed to delete dictionary')
        }
        flash(t('dictionaries.config.success.delete', 'Dictionary deleted.'), 'success')
        await loadDictionaries()
      } catch (err) {
        console.error('Failed to delete dictionary', err)
        flash(t('dictionaries.config.error.delete', 'Failed to delete dictionary.'), 'error')
      } finally {
        setDeleting(null)
      }
    },
    [inheritedManageMessage, loadDictionaries, t],
  )

  const selectedDictionary = items.find((item) => item.id === selectedId) ?? null

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {t('dictionaries.config.list.title', 'Dictionaries')}
          </h2>
          <Button type="button" size="sm" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t('dictionaries.config.list.add', 'New dictionary')}
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {t('dictionaries.config.list.loading', 'Loading dictionaries…')}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dictionaries.config.list.empty', 'No dictionaries yet. Create one to get started.')}
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((dictionary) => (
                <li key={dictionary.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={dictionary.id === selectedId}
                    className={`flex w-full cursor-pointer select-none items-center justify-between rounded border px-3 py-2 text-left text-sm transition ${
                      dictionary.id === selectedId ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => setSelectedId(dictionary.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(dictionary.id)
                      }
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <span>{dictionary.name}</span>
                        {dictionary.isInherited ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
                            {t('dictionaries.config.list.inherited', 'Inherited')}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{dictionary.key}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={dictionary.isInherited}
                        title={dictionary.isInherited ? inheritedManageMessage : undefined}
                        onClick={(event) => {
                          event.stopPropagation()
                          openEditDialog(dictionary)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={dictionary.isInherited || deleting === dictionary.id}
                        title={dictionary.isInherited ? inheritedManageMessage : undefined}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDelete(dictionary)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div>
        {selectedDictionary ? (
          <DictionaryEntriesEditor
            dictionaryId={selectedDictionary.id}
            dictionaryName={selectedDictionary.name}
            readOnly={selectedDictionary.isInherited}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t('dictionaries.config.entries.placeholder', 'Select a dictionary to manage its entries.')}
          </div>
        )}
      </div>

      <Dialog open={dialog != null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'create'
                ? t('dictionaries.config.dialog.createTitle', 'Create dictionary')
                : t('dictionaries.config.dialog.editTitle', 'Edit dictionary')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.dialog.keyLabel', 'Key')}</label>
              <input
                value={form.key}
                onChange={(event) => {
                  const next = event.target.value
                  setForm((prev) => ({ ...prev, key: next }))
                  if (errors.key) setErrors((prev) => ({ ...prev, key: undefined }))
                }}
                placeholder={t('dictionaries.config.dialog.keyPlaceholder', 'slug_name')}
                disabled={dialog?.mode === 'edit'}
                className={`w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-muted ${errors.key ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                aria-invalid={errors.key ? 'true' : 'false'}
                aria-describedby="dictionary-key-hint"
              />
              <p
                id="dictionary-key-hint"
                className={`text-xs ${errors.key ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {errors.key ?? t('dictionaries.config.dialog.keyHint', 'Use lowercase letters, numbers, hyphen, or underscore.')}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.dialog.nameLabel', 'Name')}</label>
              <input
                value={form.name}
                onChange={(event) => {
                  const next = event.target.value
                  setForm((prev) => ({ ...prev, name: next }))
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('dictionaries.config.dialog.namePlaceholder', 'Display name')}
                className={`w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${errors.name ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                aria-invalid={errors.name ? 'true' : 'false'}
              />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.dialog.descriptionLabel', 'Description')}</label>
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="min-h-[120px] w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                placeholder={t('dictionaries.config.dialog.descriptionPlaceholder', 'Explain how this dictionary is used (optional).')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
              {t('dictionaries.config.dialog.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('dictionaries.config.dialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
