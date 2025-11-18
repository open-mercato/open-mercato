"use client"

import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'

type AttachmentAssignment = {
  type: string
  id: string
  href?: string | null
  label?: string | null
}

type AttachmentRow = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string | null
  partitionCode: string
  url: string
  createdAt: string
  tags: string[]
  assignments: AttachmentAssignment[]
  thumbnailUrl?: string
}

type AttachmentLibraryResponse = {
  items: AttachmentRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  availableTags: string[]
  partitions: Array<{ code: string; title: string; description?: string | null; isPublic?: boolean }>
  error?: string
}

type AssignmentDraft = {
  type: string
  id: string
  href?: string
  label?: string
}

const PAGE_SIZE = 25

function formatFileSize(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let current = value
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024
    idx += 1
  }
  return `${current.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

function humanDate(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale ?? undefined)
}

function buildFilterSignature(values: FilterValues): string {
  return JSON.stringify(values, Object.keys(values).sort())
}

type AssignmentsEditorProps = {
  value: AssignmentDraft[]
  onChange: (next: AssignmentDraft[]) => void
  labels: {
    title: string
    description: string
    type: string
    id: string
    href: string
    label?: string
    add: string
    remove: string
  }
  disabled?: boolean
}

function AttachmentAssignmentsEditor({ value, onChange, labels, disabled }: AssignmentsEditorProps) {
  const handleChange = React.useCallback(
    (index: number, patch: Partial<AssignmentDraft>) => {
      onChange(value.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry)))
    },
    [onChange, value],
  )

  const handleRemove = React.useCallback(
    (index: number) => {
      onChange(value.filter((_, idx) => idx !== index))
    },
    [onChange, value],
  )

  const handleAdd = React.useCallback(() => {
    onChange([...value, { type: '', id: '', href: '', label: '' }])
  }, [onChange, value])

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{labels.title}</div>
        <div className="text-xs text-muted-foreground">{labels.description}</div>
      </div>
      <div className="space-y-3">
        {value.length === 0 ? (
          <div className="text-xs text-muted-foreground">No assignments yet.</div>
        ) : (
          value.map((entry, index) => (
            <div key={`${index}-${entry.type}-${entry.id}`} className="rounded border p-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium">{labels.type}</label>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm"
                    value={entry.type}
                    disabled={disabled}
                    onChange={(event) => handleChange(index, { type: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">{labels.id}</label>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm"
                    value={entry.id}
                    disabled={disabled}
                    onChange={(event) => handleChange(index, { id: event.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium">{labels.href}</label>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm"
                    value={entry.href ?? ''}
                    disabled={disabled}
                    onChange={(event) => handleChange(index, { href: event.target.value })}
                  />
                </div>
                {labels.label ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">{labels.label}</label>
                    <input
                      className="w-full rounded border px-2 py-1 text-sm"
                      value={entry.label ?? ''}
                      disabled={disabled}
                      onChange={(event) => handleChange(index, { label: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  disabled={disabled}
                  onClick={() => handleRemove(index)}
                >
                  {labels.remove}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleAdd}>
        {labels.add}
      </Button>
    </div>
  )
}

type MetadataDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  item: AttachmentRow | null
  availableTags: string[]
  onSave: (id: string, payload: { tags: string[]; assignments: AssignmentDraft[] }) => Promise<void>
  saving?: boolean
}

function AttachmentMetadataDialog({ open, onOpenChange, item, availableTags, onSave, saving }: MetadataDialogProps) {
  const t = useT()
  const [tags, setTags] = React.useState<string[]>([])
  const [assignments, setAssignments] = React.useState<AssignmentDraft[]>([])

  React.useEffect(() => {
    setTags(item?.tags ?? [])
    setAssignments(
      (item?.assignments ?? []).map((assignment) => ({
        type: assignment.type,
        id: assignment.id,
        href: assignment.href ?? '',
        label: assignment.label ?? '',
      })),
    )
  }, [item])

  const handleSubmit = React.useCallback(async () => {
    if (!item) return
    await onSave(item.id, { tags, assignments })
  }, [assignments, item, onSave, tags])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [handleSubmit, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('attachments.library.metadata.title', 'Edit attachment metadata')}</DialogTitle>
        </DialogHeader>
        {item ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">{item.fileName}</div>
              <div className="text-xs text-muted-foreground">
                {formatFileSize(item.fileSize)} • {item.partitionCode}
              </div>
            </div>
            <TagsInput
              value={tags}
              onChange={(next) => setTags(next)}
              suggestions={availableTags}
              placeholder={t('attachments.library.metadata.tagsPlaceholder', 'Add tags')}
              disabled={saving}
            />
            <AttachmentAssignmentsEditor
              value={assignments}
              onChange={setAssignments}
              disabled={saving}
              labels={{
                title: t('attachments.library.metadata.assignments.title', 'Assignments'),
                description: t(
                  'attachments.library.metadata.assignments.description',
                  'Add the records this attachment belongs to with optional links.',
                ),
                type: t('attachments.library.metadata.assignments.type', 'Type'),
                id: t('attachments.library.metadata.assignments.id', 'Record ID'),
                href: t('attachments.library.metadata.assignments.href', 'Link'),
                label: t('attachments.library.metadata.assignments.label', 'Label'),
                add: t('attachments.library.metadata.assignments.add', 'Add assignment'),
                remove: t('attachments.library.metadata.assignments.remove', 'Remove'),
              }}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('attachments.library.metadata.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('attachments.library.metadata.saving', 'Saving…') : t('attachments.library.metadata.save', 'Save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('attachments.library.metadata.noSelection', 'Select an attachment to edit.')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type UploadDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  partitions: Array<{ code: string; title: string }>
  availableTags: string[]
  onUploaded: () => void
}

function AttachmentUploadDialog({ open, onOpenChange, partitions, availableTags, onUploaded }: UploadDialogProps) {
  const t = useT()
  const [file, setFile] = React.useState<File | null>(null)
  const [partitionCode, setPartitionCode] = React.useState<string>('')
  const [tags, setTags] = React.useState<string[]>([])
  const [assignments, setAssignments] = React.useState<AssignmentDraft[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const reset = React.useCallback(() => {
    setFile(null)
    setTags([])
    setAssignments([])
    setPartitionCode('')
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!file) {
      flash('attachments.library.upload.fileRequired', 'Select a file to upload.', 'error')
      return
    }
    setIsSubmitting(true)
    try {
      const fd = new FormData()
      fd.set('entityId', 'attachments:library')
      fd.set('recordId', typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
      fd.set('file', file)
      if (partitionCode) fd.set('partitionCode', partitionCode)
      if (tags.length) fd.set('tags', JSON.stringify(tags))
      if (assignments.length) fd.set('assignments', JSON.stringify(assignments))
      const call = await apiCall<{ error?: string }>('/api/attachments', {
        method: 'POST',
        body: fd,
      })
      if (!call.ok) {
        const message = call.result?.error || t('attachments.library.upload.failed', 'Upload failed.')
        flash('attachments.library.upload.failed', message, 'error')
        return
      }
      flash('attachments.library.upload.success', t('attachments.library.upload.success', 'Attachment uploaded.'), 'success')
      onUploaded()
      onOpenChange(false)
      reset()
    } finally {
      setIsSubmitting(false)
    }
  }, [assignments, file, onOpenChange, onUploaded, partitionCode, reset, t, tags])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [handleSubmit, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('attachments.library.upload.title', 'Upload attachment')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('attachments.library.upload.file', 'File')}</label>
            <input
              type="file"
              disabled={isSubmitting}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('attachments.library.upload.partition', 'Partition')}</label>
            <select
              className="w-full rounded border px-2 py-1 text-sm"
              value={partitionCode}
              disabled={isSubmitting}
              onChange={(event) => setPartitionCode(event.target.value)}
            >
              <option value="">{t('attachments.library.upload.partitionDefault', 'Default (private)')}</option>
              {partitions.map((partition) => (
                <option key={partition.code} value={partition.code}>
                  {partition.title || partition.code}
                </option>
              ))}
            </select>
          </div>
          <TagsInput
            value={tags}
            onChange={(next) => setTags(next)}
            suggestions={availableTags}
            placeholder={t('attachments.library.upload.tagsPlaceholder', 'Add tags')}
            disabled={isSubmitting}
          />
          <AttachmentAssignmentsEditor
            value={assignments}
            onChange={setAssignments}
            disabled={isSubmitting}
            labels={{
              title: t('attachments.library.upload.assignments.title', 'Assignments'),
              description: t(
                'attachments.library.upload.assignments.description',
                'Optionally link this file to existing records now or add them later.',
              ),
              type: t('attachments.library.upload.assignments.type', 'Type'),
              id: t('attachments.library.upload.assignments.id', 'Record ID'),
              href: t('attachments.library.upload.assignments.href', 'Link'),
              label: t('attachments.library.upload.assignments.label', 'Label'),
              add: t('attachments.library.upload.assignments.add', 'Add assignment'),
              remove: t('attachments.library.upload.assignments.remove', 'Remove'),
            }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              {t('attachments.library.upload.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !file}>
              {isSubmitting ? t('attachments.library.upload.submitting', 'Uploading…') : t('attachments.library.upload.submit', 'Upload')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AttachmentLibrary() {
  const t = useT()
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [metadataDialogOpen, setMetadataDialogOpen] = React.useState(false)
  const [selectedRow, setSelectedRow] = React.useState<AttachmentRow | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = React.useState(false)
  const filterSignature = React.useMemo(() => buildFilterSignature(filterValues), [filterValues])
  const sortingSignature = React.useMemo(() => JSON.stringify(sorting), [sorting])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attachments-library', page, search, filterSignature, sortingSignature],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      if (search.trim().length > 0) params.set('search', search.trim())
      const partition = typeof filterValues.partition === 'string' ? filterValues.partition : ''
      if (partition) params.set('partition', partition)
      const tags = Array.isArray(filterValues.tags) ? filterValues.tags : []
      if (tags.length > 0) params.set('tags', tags.join(','))
      if (sorting.length > 0) {
        const primary = sorting[0]
        params.set('sortField', primary.id)
        params.set('sortDir', primary.desc ? 'desc' : 'asc')
      }
      const call = await apiCall<AttachmentLibraryResponse>(`/api/attachments/library?${params.toString()}`)
      if (!call.ok || !call.result) {
        const message = call.result?.error || t('attachments.library.errors.load', 'Failed to load attachments.')
        throw new Error(message)
      }
      return call.result
    },
  })

  const partitions = data?.partitions ?? []
  const availableTags = data?.availableTags ?? []

  const filters = React.useMemo<FilterDef[]>(() => {
    const partitionOptions = partitions.map((entry) => ({
      value: entry.code,
      label: entry.title || entry.code,
    }))
    return [
      {
        id: 'partition',
        label: t('attachments.library.filters.partition', 'Partition'),
        type: 'select',
        options: partitionOptions,
      },
      {
        id: 'tags',
        label: t('attachments.library.filters.tags', 'Tags'),
        type: 'tags',
        placeholder: t('attachments.library.filters.tagsPlaceholder', 'Filter by tag'),
        options: availableTags.map((tag) => ({ value: tag, label: tag })),
      },
    ]
  }, [availableTags, partitions, t])

  const items = data?.items ?? []

  const columns = React.useMemo<ColumnDef<AttachmentRow>[]>(() => {
    return [
      {
        id: 'preview',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const value = row.original
          if (value.thumbnailUrl) {
            return (
              <div className="h-16 w-16 overflow-hidden rounded border bg-muted">
                <img
                  src={value.thumbnailUrl}
                  alt={value.fileName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            )
          }
          return (
            <div className="flex h-16 w-16 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
              {value.mimeType?.split('/')[0] ?? 'file'}
            </div>
          )
        },
      },
      {
        id: 'fileName',
        accessorKey: 'fileName',
        header: t('attachments.library.table.file', 'File'),
        cell: ({ row }) => {
          const value = row.original
          return (
            <div className="space-y-1">
              <div className="font-medium">{value.fileName}</div>
              <div className="text-xs text-muted-foreground">
                {formatFileSize(value.fileSize)} • {value.mimeType || 'application/octet-stream'}
              </div>
            </div>
          )
        },
      },
      {
        id: 'tags',
        accessorKey: 'tags',
        header: t('attachments.library.table.tags', 'Tags'),
        enableSorting: false,
        cell: ({ row }) => {
          const tags = row.original.tags
          if (!tags.length) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )
        },
      },
      {
        id: 'assignments',
        accessorKey: 'assignments',
        header: t('attachments.library.table.assignments', 'Assignments'),
        enableSorting: false,
        cell: ({ row }) => {
          const assignments = row.original.assignments
          if (!assignments.length) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex flex-col gap-1">
              {assignments.map((assignment) => {
                const label = assignment.label || assignment.id
                return assignment.href ? (
                  <a
                    key={`${assignment.type}-${assignment.id}-${assignment.href}`}
                    href={assignment.href}
                    className="text-sm text-blue-600 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {assignment.type}: {label}
                  </a>
                ) : (
                  <div key={`${assignment.type}-${assignment.id}`} className="text-sm">
                    {assignment.type}: {label}
                  </div>
                )
              })}
            </div>
          )
        },
      },
      {
        id: 'partitionCode',
        accessorKey: 'partitionCode',
        header: t('attachments.library.table.partition', 'Partition'),
        cell: ({ row }) => (
          <div className="text-sm">
            {row.original.partitionCode}
          </div>
        ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('attachments.library.table.created', 'Created'),
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground">
            {humanDate(row.original.createdAt)}
          </div>
        ),
      },
    ]
  }, [t])

  const openMetadataDialog = React.useCallback((row: AttachmentRow) => {
    setSelectedRow(row)
    setMetadataDialogOpen(true)
  }, [])

  const handleMetadataSave = React.useCallback(
    async (id: string, payload: { tags: string[]; assignments: AssignmentDraft[] }) => {
      try {
        const call = await apiCall<{ error?: string }>(`/api/attachments/library/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!call.ok) {
          const message =
            call.result?.error || t('attachments.library.metadata.error', 'Failed to update metadata.')
          flash('attachments.library.metadata.error', message, 'error')
          return
        }
        flash('attachments.library.metadata.success', t('attachments.library.metadata.success', 'Attachment updated.'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['attachments-library'], exact: false })
        setMetadataDialogOpen(false)
      } catch (err: any) {
        flash('attachments.library.metadata.error', err?.message || 'Failed to update attachment.', 'error')
      }
    },
    [queryClient, t],
  )

  const handleUploadCompleted = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['attachments-library'], exact: false })
  }, [queryClient])

  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1
  return (
    <>
      <DataTable<AttachmentRow>
        title={t('attachments.library.title', 'Attachments')}
        refreshButton={{
          label: t('attachments.library.actions.refresh', 'Refresh'),
          onRefresh: () => { void refetch() },
          isRefreshing: isLoading,
        }}
        actions={(
          <Button onClick={() => setUploadDialogOpen(true)}>
            {t('attachments.library.actions.upload', 'Upload')}
          </Button>
        )}
        columns={columns}
        data={items}
        sorting={sorting}
        onSortingChange={setSorting}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                label: t('attachments.library.actions.open', 'Open'),
                onSelect: () => window.open(row.url, '_blank', 'noopener,noreferrer'),
              },
              {
                label: t('attachments.library.actions.edit', 'Edit metadata'),
                onSelect: () => openMetadataDialog(row),
              },
              {
                label: t('attachments.library.actions.copyUrl', 'Copy URL'),
                onSelect: () => {
                  navigator.clipboard
                    .writeText(row.url)
                    .then(() =>
                      flash(
                        'attachments.library.actions.copied',
                        t('attachments.library.actions.copied', 'Link copied.'),
                        'success',
                      ),
                    )
                    .catch(() =>
                      flash(
                        'attachments.library.actions.copyError',
                        t('attachments.library.actions.copyError', 'Unable to copy link.'),
                        'error',
                      ),
                    )
                },
              },
            ]}
          />
        )}
        onRowClick={(row) => openMetadataDialog(row)}
        isLoading={isLoading}
        error={error?.message}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('attachments.library.table.empty', 'No attachments found.')}
          </div>
        }
        searchValue={search}
        onSearchChange={(value) => {
          setPage(1)
          setSearch(value)
        }}
        searchPlaceholder={t('attachments.library.table.search', 'Search files…')}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: (next) => setPage(next),
        }}
      />
      <AttachmentMetadataDialog
        open={metadataDialogOpen}
        onOpenChange={setMetadataDialogOpen}
        item={selectedRow}
        availableTags={availableTags}
        onSave={handleMetadataSave}
      />
      <AttachmentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        partitions={partitions}
        availableTags={availableTags}
        onUploaded={handleUploadCompleted}
      />
    </>
  )
}
