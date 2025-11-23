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
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@/lib/i18n/context'
import { resolvePartitionEnvKey } from '@open-mercato/core/modules/attachments/lib/partitionEnv'

type Partition = {
  id: string
  code: string
  title: string
  description: string | null
  isPublic: boolean
  envKey: string
  createdAt: string | null
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: Partition }

const DEFAULT_FORM = {
  code: '',
  title: '',
  description: '',
  isPublic: false,
}

export function AttachmentPartitionSettings() {
  const t = useT()
  const [items, setItems] = React.useState<Partition[]>([])
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState(DEFAULT_FORM)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadErrorMessage = t('attachments.partitions.errors.load', 'Failed to load partitions.')

  const loadItems = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: Partition[] }>(
        '/api/attachments/partitions',
        undefined,
        { errorMessage: loadErrorMessage },
      )
      const normalized = Array.isArray(payload.items) ? payload.items : []
      setItems(normalized)
    } catch (err) {
      console.error('[attachments.partitions] list failed', err)
      flash(loadErrorMessage, 'error')
    } finally {
      setLoading(false)
    }
  }, [loadErrorMessage])

  React.useEffect(() => {
    loadItems().catch(() => {})
  }, [loadItems])

  const filteredItems = React.useMemo(() => {
    if (!search.trim()) return items
    const term = search.trim().toLowerCase()
    return items.filter(
      (entry) =>
        entry.code.toLowerCase().includes(term) ||
        entry.title.toLowerCase().includes(term) ||
        (entry.description ?? '').toLowerCase().includes(term),
    )
  }, [items, search])

  const openDialog = React.useCallback((state: DialogState) => {
    if (state.mode === 'edit') {
      setForm({
        code: state.entry.code,
        title: state.entry.title,
        description: state.entry.description ?? '',
        isPublic: state.entry.isPublic,
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
    const trimmedCode = form.code.trim()
    const trimmedTitle = form.title.trim()
    if (!trimmedCode || !trimmedTitle) {
      setError(t('attachments.partitions.errors.required', 'Code and title are required.'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        code: trimmedCode,
        title: trimmedTitle,
        description: form.description.trim() || undefined,
        isPublic: form.isPublic,
      }
      const method = dialog.mode === 'create' ? 'POST' : 'PUT'
      const body =
        dialog.mode === 'edit'
          ? JSON.stringify({ id: dialog.entry.id, ...payload })
          : JSON.stringify(payload)
      const call = await apiCall('/api/attachments/partitions', {
        method,
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (!call.ok) {
        await raiseCrudError(
          call.response,
          t('attachments.partitions.errors.save', 'Failed to save partition.'),
        )
      }
      flash(
        dialog.mode === 'create'
          ? t('attachments.partitions.messages.created', 'Partition created.')
          : t('attachments.partitions.messages.updated', 'Partition updated.'),
        'success',
      )
      closeDialog()
      await loadItems()
    } catch (err) {
      console.error('[attachments.partitions] save failed', err)
      const message =
        err instanceof Error ? err.message : t('attachments.partitions.errors.save', 'Failed to save partition.')
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [dialog, form, t, closeDialog, loadItems])

  const handleDelete = React.useCallback(
    async (entry: Partition) => {
      const confirmMessage = t('attachments.partitions.confirm.delete', 'Delete partition "{{code}}"?').replace(
        '{{code}}',
        entry.code,
      )
      if (!window.confirm(confirmMessage)) return
      try {
        const call = await apiCall(`/api/attachments/partitions?id=${encodeURIComponent(entry.id)}`, {
          method: 'DELETE',
        })
        if (!call.ok) {
          await raiseCrudError(
            call.response,
            t('attachments.partitions.errors.delete', 'Failed to delete partition.'),
          )
        }
        flash(t('attachments.partitions.messages.deleted', 'Partition removed.'), 'success')
        await loadItems()
      } catch (err) {
        console.error('[attachments.partitions] delete failed', err)
        flash(t('attachments.partitions.errors.delete', 'Failed to delete partition.'), 'error')
      }
    },
    [loadItems, t],
  )

  const columns = React.useMemo<ColumnDef<Partition>[]>(
    () => [
      {
        header: t('attachments.partitions.table.code', 'Code'),
        accessorKey: 'code',
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.code}</code>,
      },
      {
        header: t('attachments.partitions.table.title', 'Title'),
        accessorKey: 'title',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            {row.original.description ? (
              <span className="text-xs text-muted-foreground line-clamp-2">{row.original.description}</span>
            ) : null}
          </div>
        ),
      },
      {
        header: t('attachments.partitions.table.visibility', 'Visibility'),
        accessorKey: 'isPublic',
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.isPublic
              ? t('attachments.partitions.table.public', 'Public')
              : t('attachments.partitions.table.private', 'Private')}
          </span>
        ),
      },
      {
        header: t('attachments.partitions.table.envKey', 'Env variable'),
        accessorKey: 'envKey',
        cell: ({ row }) => <code className="text-xs">{row.original.envKey}</code>,
      },
    ],
    [t],
  )

  const tableLabels = React.useMemo(
    () => ({
      search: t('attachments.partitions.table.search', 'Search partitions…'),
      empty: t('attachments.partitions.table.empty', 'No partitions configured.'),
    }),
    [t],
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

  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {t('attachments.partitions.title', 'Attachment partitions')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('attachments.partitions.description', 'Define storage partitions and visibility for uploads.')}
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog({ mode: 'create' })}>
          {t('attachments.partitions.actions.add', 'Add partition')}
        </Button>
      </div>
      <DataTable<Partition>
        columns={columns}
        data={filteredItems}
        searchValue={search}
        onSearchChange={(value: string) => setSearch(value)}
        searchPlaceholder={tableLabels.search}
        emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{tableLabels.empty}</p>}
        isLoading={loading}
        refreshButton={{
          label: t('attachments.partitions.actions.refresh', 'Refresh'),
          onRefresh: () => { void loadItems() },
          isRefreshing: loading,
        }}
        rowActions={(entry) => (
          <RowActions
            items={[
              {
                label: t('attachments.partitions.actions.edit', 'Edit'),
                onSelect: () => openDialog({ mode: 'edit', entry }),
              },
              {
                label: t('attachments.partitions.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => { void handleDelete(entry) },
              },
            ]}
          />
        )}
      />
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('attachments.partitions.dialog.editTitle', 'Edit partition')
                : t('attachments.partitions.dialog.createTitle', 'Create partition')}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'edit'
                ? t('attachments.partitions.dialog.editDescription', 'Update partition metadata and visibility.')
                : t('attachments.partitions.dialog.createDescription', 'Define a storage partition for attachments.')}
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
              <Label htmlFor="partition-code">{t('attachments.partitions.form.codeLabel', 'Code')}</Label>
              <Input
                id="partition-code"
                value={form.code}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder={t('attachments.partitions.form.codePlaceholder', 'e.g. marketingAssets')}
                disabled={dialog?.mode === 'edit'}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partition-title">{t('attachments.partitions.form.titleLabel', 'Title')}</Label>
              <Input
                id="partition-title"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder={t('attachments.partitions.form.titlePlaceholder', 'e.g. Marketing assets')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partition-description">{t('attachments.partitions.form.descriptionLabel', 'Description')}</Label>
              <textarea
                id="partition-description"
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder={t('attachments.partitions.form.descriptionPlaceholder', 'Explain how this partition is used.')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border"
                checked={form.isPublic}
                onChange={(event) => setForm((prev) => ({ ...prev, isPublic: event.target.checked }))}
              />
              {t('attachments.partitions.form.publicLabel', 'Publicly accessible')}
            </label>
            {dialog ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  {t('attachments.partitions.form.envKeyHelp', 'Set this env var to override storage path:')}
                </div>
                <code>
                  {dialog.mode === 'edit'
                    ? dialog.entry.envKey
                    : form.code.trim()
                      ? resolvePartitionEnvKey(form.code.trim())
                      : 'ATTACHMENTS_PARTITION_CODE_ROOT'}
                </code>
              </div>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              {t('attachments.partitions.actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {dialog?.mode === 'edit'
                ? t('attachments.partitions.actions.save', 'Save changes')
                : t('attachments.partitions.actions.create', 'Create partition')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
