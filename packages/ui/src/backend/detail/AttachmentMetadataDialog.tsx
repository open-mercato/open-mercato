"use client"

import * as React from 'react'
import { z } from 'zod'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Copy, Download, Trash2 } from 'lucide-react'
import { AttachmentContentPreview } from '@open-mercato/core/modules/attachments/components/AttachmentContentPreview'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { E } from '@open-mercato/core/generated-shims/entities.ids.generated'

export type AttachmentAssignment = {
  type: string
  id: string
  href?: string | null
  label?: string | null
}

export type AttachmentItem = {
  id: string
  fileName: string
  fileSize: number
  mimeType?: string | null
  partitionCode?: string | null
  partitionTitle?: string | null
  url?: string | null
  createdAt?: string | null
  tags?: string[]
  assignments?: AttachmentAssignment[]
  thumbnailUrl?: string
  content?: string | null
}

export type AssignmentDraft = {
  type: string
  id: string
  href?: string
  label?: string
}

export type AttachmentMetadataSavePayload = {
  tags: string[]
  assignments: AssignmentDraft[]
  customFields?: Record<string, unknown>
}

type AttachmentMetadataResponse = {
  item: {
    id: string
    fileName?: string
    fileSize?: number
    mimeType?: string | null
    partitionCode?: string
    partitionTitle?: string | null
    tags?: string[]
    content?: string | null
    assignments?: AttachmentAssignment[]
    customFields?: Record<string, unknown>
  }
  error?: string
}

type AttachmentMetadataFormValues = {
  id: string
  tags?: string[]
  assignments?: AssignmentDraft[]
} & Record<string, unknown>

type AssignmentEditorLabels = {
  title: string
  description: string
  type: string
  id: string
  href: string
  label: string
  add: string
  remove: string
}

type AttachmentMetadataDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  item: AttachmentItem | null
  availableTags: string[]
  onSave: (id: string, payload: AttachmentMetadataSavePayload) => Promise<void>
}

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

const ENV_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

function resolveAbsoluteUrl(path: string): string {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  const base =
    ENV_APP_URL ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '')
  if (!base) return path
  const normalizedBase = base.replace(/\/$/, '')
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeCustomFieldSubmitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}

function prepareAssignmentsForForm(assignments?: AttachmentAssignment[] | null): AssignmentDraft[] {
  return (assignments ?? []).map((assignment) => ({
    type: assignment.type,
    id: assignment.id,
    href: assignment.href ?? '',
    label: assignment.label ?? '',
  }))
}

function prefixCustomFieldValues(values?: Record<string, unknown> | null): Record<string, unknown> {
  if (!values) return {}
  const prefixed: Record<string, unknown> = {}
  Object.entries(values).forEach(([key, value]) => {
    if (!key) return
    if (key.startsWith('cf_')) {
      prefixed[key] = value
    } else if (key.startsWith('cf:')) {
      const normalized = key.slice(3)
      if (normalized) prefixed[`cf_${normalized}`] = value
    } else {
      prefixed[`cf_${key}`] = value
    }
  })
  return prefixed
}

function AssignmentInputRow({
  value,
  onChange,
  labels,
  disabled,
  onRemove,
}: {
  value: AssignmentDraft
  onChange: (next: AssignmentDraft) => void
  labels: AssignmentEditorLabels
  disabled?: boolean
  onRemove: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border/70 bg-background p-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1.6fr_1fr_auto]">
      <div className="space-y-1">
        <label className="text-xs font-medium">{labels.type}</label>
        <Input
          value={value.type}
          onChange={(event) => onChange({ ...value, type: event.target.value })}
          placeholder="catalog.product"
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{labels.id}</label>
        <Input
          value={value.id}
          onChange={(event) => onChange({ ...value, id: event.target.value })}
          placeholder="Record ID"
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{labels.href}</label>
        <Input
          value={value.href ?? ''}
          onChange={(event) => onChange({ ...value, href: event.target.value })}
          placeholder="https://"
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{labels.label}</label>
        <Input
          value={value.label ?? ''}
          onChange={(event) => onChange({ ...value, label: event.target.value })}
          placeholder="Optional label"
          disabled={disabled}
        />
      </div>
      <div className="flex items-end">
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={disabled}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function AttachmentAssignmentsEditor({
  value,
  onChange,
  labels,
  disabled,
}: {
  value: AssignmentDraft[]
  onChange: (next: AssignmentDraft[]) => void
  labels: AssignmentEditorLabels
  disabled?: boolean
}) {
  const handleAdd = React.useCallback(() => {
    onChange([...value, { type: '', id: '', href: '', label: '' }])
  }, [onChange, value])

  const handleChange = React.useCallback(
    (index: number, next: AssignmentDraft) => {
      const draft = [...value]
      draft[index] = next
      onChange(draft)
    },
    [onChange, value],
  )

  const handleRemove = React.useCallback(
    (index: number) => {
      const next = value.filter((_, idx) => idx !== index)
      onChange(next)
    },
    [onChange, value],
  )

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="text-sm font-medium">{labels.title}</div>
        <p className="text-xs text-muted-foreground">{labels.description}</p>
      </div>
      <div className="space-y-2">
        {value.length ? value.map((entry, idx) => (
          <AssignmentInputRow
            key={`${entry.type}-${entry.id}-${idx}`}
            value={entry}
            labels={labels}
            disabled={disabled}
            onChange={(next) => handleChange(idx, next)}
            onRemove={() => handleRemove(idx)}
          />
        )) : (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
            {labels.description}
          </div>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleAdd} disabled={disabled}>
        {labels.add}
      </Button>
    </div>
  )
}

export function AttachmentMetadataDialog({ open, onOpenChange, item, availableTags, onSave }: AttachmentMetadataDialogProps) {
  const t = useT()
  const [sizeWidth, setSizeWidth] = React.useState<string>('')
  const [sizeHeight, setSizeHeight] = React.useState<string>('')
  const [imageTab, setImageTab] = React.useState<'preview' | 'resize'>('preview')
  const [initialValues, setInitialValues] = React.useState<Partial<AttachmentMetadataFormValues> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [extractedContent, setExtractedContent] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !item) {
      setInitialValues(null)
      setLoadError(null)
      setLoading(false)
      setImageTab('preview')
      setExtractedContent(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setSizeWidth('')
    setSizeHeight('')
    setImageTab('preview')
    setInitialValues({
      id: item.id,
      tags: item.tags ?? [],
      assignments: prepareAssignmentsForForm(item.assignments),
    })
    setExtractedContent(item.content ?? null)
    const loadDetails = async () => {
      try {
        const call = await apiCall<AttachmentMetadataResponse>(`/api/attachments/library/${encodeURIComponent(item.id)}`)
        if (!call.ok || !call.result?.item) {
          const message = call.result?.error || t('attachments.library.metadata.error', 'Failed to update metadata.')
          throw new Error(message)
        }
        const payload = call.result.item
        const prefixedCustom = prefixCustomFieldValues(payload.customFields)
        if (!cancelled) {
          setInitialValues({
            id: payload.id,
            tags: Array.isArray(payload.tags) ? payload.tags : [],
            assignments: prepareAssignmentsForForm(payload.assignments ?? item.assignments),
            ...prefixedCustom,
          })
          const nextContent = typeof payload.content === 'string' ? payload.content : null
          setExtractedContent(nextContent)
        }
      } catch (err: any) {
        if (!cancelled) {
          const message =
            err?.message || t('attachments.library.metadata.loadError', 'Failed to load attachment metadata.')
          setLoadError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadDetails()
    return () => {
      cancelled = true
    }
  }, [item, open, t])

  const isImage = React.useMemo(() => Boolean(item?.mimeType?.toLowerCase().startsWith('image/')), [item])
  const previewUrl = React.useMemo(() => {
    if (!item) return null
    return (
      item.thumbnailUrl ??
      buildAttachmentImageUrl(item.id, {
        width: 320,
        height: 320,
        slug: slugifyAttachmentFileName(item.fileName),
      })
    )
  }, [item])
  const downloadUrl = React.useMemo(() => {
    if (!item) return null
    const original = buildAttachmentFileUrl(item.id, { download: true })
    return resolveAbsoluteUrl(original)
  }, [item])

  const assignmentLabels = React.useMemo(
    () => ({
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
    }),
    [t],
  )

  const metadataFields = React.useMemo<CrudField[]>(() => {
    return [
      {
        id: 'tags',
        label: t('attachments.library.table.tags', 'Tags'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <TagsInput
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(next) => setValue(next)}
            suggestions={availableTags}
            placeholder={t('attachments.library.metadata.tagsPlaceholder', 'Add tags')}
            disabled={Boolean(disabled) || loading}
          />
        ),
      },
      {
        id: 'assignments',
        label: '',
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <AttachmentAssignmentsEditor
            value={Array.isArray(value) ? (value as AssignmentDraft[]) : []}
            onChange={(next) => setValue(next)}
            labels={assignmentLabels}
            disabled={Boolean(disabled) || loading}
          />
        ),
      },
    ]
  }, [assignmentLabels, availableTags, loading, t])

  const metadataGroups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      {
        id: 'details',
        title: t('attachments.library.metadata.details', 'Details'),
        column: 1,
        fields: ['tags', 'assignments'],
      },
      {
        id: 'customFields',
        title: t('entities.customFields.title', 'Custom attributes'),
        column: 2,
        kind: 'customFields',
      },
    ]
  }, [t])

  const metadataSchema = React.useMemo(
    () =>
      z
        .object({
          id: z.string().min(1),
          tags: z.array(z.string()).optional(),
          assignments: z
            .array(
              z.object({
                type: z.string().min(1),
                id: z.string().min(1),
                href: z.string().optional(),
                label: z.string().optional(),
              }),
            )
            .optional(),
        })
        .passthrough(),
    [],
  )

  const handleSubmit = React.useCallback(
    async (values: AttachmentMetadataFormValues) => {
      if (!item) return
      const tags = Array.isArray(values.tags)
        ? values.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter((tag) => tag.length > 0)
        : []
      const assignments = Array.isArray(values.assignments)
        ? values.assignments
            .map((assignment) => ({
              type: assignment.type?.trim() ?? '',
              id: assignment.id?.trim() ?? '',
              href: assignment.href?.trim() || undefined,
              label: assignment.label?.trim() || undefined,
            }))
            .filter((assignment) => assignment.type && assignment.id)
        : []
      const customFields = collectCustomFieldValues(values, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
      })
      const payload: AttachmentMetadataSavePayload = {
        tags,
        assignments,
      }
      if (Object.keys(customFields).length) {
        payload.customFields = customFields
      }
      await onSave(item.id, payload)
    },
    [item, onSave],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [onOpenChange],
  )

  const handleCopyResizedUrl = React.useCallback(async () => {
    if (!item) return
    const width = sizeWidth ? Number(sizeWidth) : undefined
    const height = sizeHeight ? Number(sizeHeight) : undefined
    if (!width && !height) {
      flash(
        t('attachments.library.metadata.resizeTool.missing', 'Enter width or height to generate the URL.'),
        'error',
      )
      return
    }
    const url = buildAttachmentImageUrl(item.id, {
      width: width && width > 0 ? width : undefined,
      height: height && height > 0 ? height : undefined,
      slug: slugifyAttachmentFileName(item.fileName),
    })
    const absolute = resolveAbsoluteUrl(url)
    try {
      await navigator.clipboard.writeText(absolute)
      flash(
        t('attachments.library.metadata.resizeTool.copied', 'Image URL copied.'),
        'success',
      )
    } catch {
      flash(
        t('attachments.library.metadata.resizeTool.copyError', 'Unable to copy URL.'),
        'error',
      )
    }
  }, [item, sizeHeight, sizeWidth, t])

  const loadMessage = t('attachments.library.metadata.loading', 'Loading attachment details…')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('attachments.library.metadata.title', 'Edit attachment metadata')}</DialogTitle>
        </DialogHeader>
        {item ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="truncate text-sm font-medium" title={item.fileName}>
                  {item.fileName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatFileSize(item.fileSize)} • {item.partitionTitle ?? item.partitionCode}
                </div>
              </div>
              {downloadUrl ? (
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <a href={downloadUrl} download>
                    <Download className="mr-2 h-4 w-4" />
                    {t('attachments.library.metadata.download', 'Download')}
                  </a>
                </Button>
              ) : null}
            </div>
            {isImage ? (
              <div className="rounded border">
                <div className="flex flex-wrap gap-4 border-b px-3 py-2 text-sm font-medium" role="tablist">
                  {(['preview', 'resize'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={imageTab === tab}
                      onClick={() => setImageTab(tab)}
                      className={cn(
                        'border-b-2 px-0 py-1 transition-colors',
                        imageTab === tab
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {tab === 'preview'
                        ? t('attachments.library.metadata.preview', 'Preview')
                        : t('attachments.library.metadata.resizeTool.title', 'Generate resized URL')}
                    </button>
                  ))}
                </div>
                <div className="space-y-3 p-3">
                  {imageTab === 'preview' ? (
                    previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={item.fileName}
                        className="h-48 w-full rounded-md bg-muted object-contain"
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        {t('attachments.library.metadata.previewUnavailable', 'Preview unavailable.')}
                      </div>
                    )
                  ) : (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium" htmlFor="resize-width">
                            {t('attachments.library.metadata.resizeTool.width', 'Width (px)')}
                          </label>
                          <Input
                            id="resize-width"
                            type="number"
                            min={0}
                            value={sizeWidth}
                            onChange={(event) => setSizeWidth(event.target.value)}
                            disabled={loading}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium" htmlFor="resize-height">
                            {t('attachments.library.metadata.resizeTool.height', 'Height (px)')}
                          </label>
                          <Input
                            id="resize-height"
                            type="number"
                            min={0}
                            value={sizeHeight}
                            onChange={(event) => setSizeHeight(event.target.value)}
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="inline-flex items-center gap-2"
                        onClick={() => void handleCopyResizedUrl()}
                        disabled={loading}
                      >
                        <Copy className="h-4 w-4" />
                        {t('attachments.library.metadata.resizeTool.copy', 'Copy URL')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            {loadError ? (
              <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {loadError}
              </div>
            ) : null}
            <div className="rounded border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-xs font-semibold text-muted-foreground">
                {t('attachments.library.metadata.extractedTitle', 'Extracted text')}
              </div>
              <AttachmentContentPreview
                content={extractedContent}
                emptyLabel={t('attachments.library.metadata.noContent', 'No text extracted')}
                showMoreLabel={t('attachments.library.metadata.showMore', 'Show more')}
                showLessLabel={t('attachments.library.metadata.showLess', 'Show less')}
              />
            </div>
            <CrudForm<AttachmentMetadataFormValues>
              embedded
              schema={metadataSchema}
              entityId={E.attachments.attachment}
              fields={metadataFields}
              groups={metadataGroups}
              initialValues={initialValues ?? undefined}
              isLoading={!initialValues || loading}
              loadingMessage={loadMessage}
              submitLabel={t('attachments.library.metadata.save', 'Save')}
              extraActions={
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('attachments.library.metadata.cancel', 'Cancel')}
                </Button>
              }
              onSubmit={handleSubmit}
            />
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('attachments.library.metadata.noSelection', 'Select an attachment to edit.')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
