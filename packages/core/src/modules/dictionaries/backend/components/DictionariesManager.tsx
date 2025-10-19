"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { DictionaryEntriesEditor } from './DictionaryEntriesEditor'

export type DictionarySummary = {
  id: string
  key: string
  name: string
  description?: string | null
  isSystem?: boolean
  isActive?: boolean
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
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)

  const loadDictionaries = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/dictionaries')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load dictionaries')
      }
      const list = Array.isArray(data.items)
        ? data.items.map((item: any) => ({
            id: String(item.id),
            key: String(item.key),
            name: String(item.name ?? item.key),
            description: typeof item.description === 'string' ? item.description : null,
            isSystem: Boolean(item.isSystem),
            isActive: item.isActive !== false,
          }))
        : []
      setItems(list)
      if (!list.find((dict) => dict.id === selectedId)) {
        setSelectedId(list.length ? list[0].id : null)
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
  }, [])

  const openEditDialog = React.useCallback((dictionary: DictionarySummary) => {
    setForm({ key: dictionary.key, name: dictionary.name, description: dictionary.description ?? '' })
    setDialog({ mode: 'edit', dictionary })
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setForm({ key: '', name: '', description: '' })
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!dialog) return
    if (!form.key.trim() || !form.name.trim()) {
      flash(t('dictionaries.config.error.required', 'Key and name are required.'), 'error')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      }
      if (dialog.mode === 'create') {
        const res = await apiFetch('/api/dictionaries', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to create dictionary')
        }
        flash(t('dictionaries.config.success.create', 'Dictionary created.'), 'success')
      } else if (dialog.dictionary) {
        const res = await apiFetch(`/api/dictionaries/${dialog.dictionary.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to update dictionary')
        }
        flash(t('dictionaries.config.success.update', 'Dictionary updated.'), 'success')
      }
      closeDialog()
      await loadDictionaries()
    } catch (err) {
      console.error('Failed to save dictionary', err)
      flash(t('dictionaries.config.error.save', 'Failed to save dictionary.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, form.description, form.key, form.name, loadDictionaries, t])

  const handleDelete = React.useCallback(
    async (dictionary: DictionarySummary) => {
      if (dictionary.isSystem) {
        flash(t('dictionaries.config.error.system', 'System dictionaries cannot be deleted.'), 'error')
        return
      }
      const confirmed = window.confirm(
        t('dictionaries.config.delete.confirm', 'Delete dictionary "{{name}}"?', {
          name: dictionary.name,
        }),
      )
      if (!confirmed) return
      setDeleting(dictionary.id)
      try {
        const res = await apiFetch(`/api/dictionaries/${dictionary.id}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to delete dictionary')
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
    [loadDictionaries, t],
  )

  const selectedDictionary = items.find((item) => item.id === selectedId) ?? null

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="p-4">
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
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {t('dictionaries.config.list.loading', 'Loading dictionaries…')}
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dictionaries.config.list.empty', 'No dictionaries yet. Create one to get started.')}
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((dictionary) => (
                <li key={dictionary.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition ${
                      dictionary.id === selectedId ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => setSelectedId(dictionary.id)}
                  >
                    <div>
                      <div className="font-medium">{dictionary.name}</div>
                      <div className="text-xs text-muted-foreground">{dictionary.key}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
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
                        disabled={deleting === dictionary.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDelete(dictionary)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <div>
        {selectedDictionary ? (
          <DictionaryEntriesEditor dictionaryId={selectedDictionary.id} dictionaryName={selectedDictionary.name} />
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
              <Input
                value={form.key}
                onChange={(event) => setForm((prev) => ({ ...prev, key: event.target.value }))}
                placeholder={t('dictionaries.config.dialog.keyPlaceholder', 'slug_name')}
                disabled={dialog?.mode === 'edit'}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.dialog.nameLabel', 'Name')}</label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('dictionaries.config.dialog.namePlaceholder', 'Display name')}
              />
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

