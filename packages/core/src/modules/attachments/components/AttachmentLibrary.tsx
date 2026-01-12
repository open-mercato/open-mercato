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
import { Input } from '@open-mercato/ui/primitives/input'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { z } from 'zod'
import { E } from '#generated/entities.ids.generated'
import type { LucideIcon } from 'lucide-react'
import { Download, Plus, Upload, Trash2, Copy, File, FileText, FileSpreadsheet, FileArchive, FileAudio, FileVideo, FileCode } from 'lucide-react'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { cn } from '@open-mercato/shared/lib/utils'
import { AttachmentContentPreview } from './AttachmentContentPreview'

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
  partitionTitle?: string | null
  url: string
  createdAt: string
  tags: string[]
  assignments: AttachmentAssignment[]
  thumbnailUrl?: string
  content?: string | null
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

type AssignmentDraft = {
  type: string
  id: string
  href?: string
  label?: string
}

type AttachmentMetadataFormValues = {
  id: string
  tags?: string[]
  assignments?: AssignmentDraft[]
} & Record<string, unknown>

const PAGE_SIZE = 25
const ENV_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
const LIBRARY_ENTITY_ID = 'attachments:library'

function filterLibraryAssignments(assignments?: AttachmentAssignment[] | null): AttachmentAssignment[] {
  return (assignments ?? []).filter((assignment) => assignment.type !== LIBRARY_ENTITY_ID)
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

function humanDate(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale ?? undefined)
}

function buildFilterSignature(values: FilterValues): string {
  return JSON.stringify(values, Object.keys(values).sort())
}

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

function resolveFileExtension(fileName?: string | null): string {
  if (!fileName) return ''
  const normalized = fileName.trim()
  if (!normalized) return ''
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot === -1 || lastDot === normalized.length - 1) return ''
  return normalized.slice(lastDot + 1).toLowerCase()
}

const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  md: FileText,
  rtf: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ods: FileSpreadsheet,
  ppt: FileText,
  pptx: FileText,
  zip: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  tgz: FileArchive,
  '7z': FileArchive,
  tar: FileArchive,
  json: FileCode,
  js: FileCode,
  ts: FileCode,
  jsx: FileCode,
  tsx: FileCode,
  html: FileCode,
  css: FileCode,
  xml: FileCode,
  yaml: FileCode,
  yml: FileCode,
  mp3: FileAudio,
  wav: FileAudio,
  flac: FileAudio,
  ogg: FileAudio,
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  webm: FileVideo,
}

const MIME_FALLBACK_ICONS: Record<string, LucideIcon> = {
  audio: FileAudio,
  video: FileVideo,
  text: FileText,
  application: FileText,
}

function resolveAttachmentPlaceholder(mimeType?: string | null, fileName?: string | null): { icon: LucideIcon; label: string } {
  const extension = resolveFileExtension(fileName)
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (extension && EXTENSION_ICON_MAP[extension]) {
    return { icon: EXTENSION_ICON_MAP[extension], label: extension.toUpperCase() }
  }
  if (!extension && normalizedMime.includes('pdf')) {
    return { icon: FileText, label: 'PDF' }
  }
  if (!extension && normalizedMime.includes('zip')) {
    return { icon: FileArchive, label: 'ZIP' }
  }
  if (!extension && normalizedMime.includes('json')) {
    return { icon: FileCode, label: 'JSON' }
  }
  const mimeRoot = normalizedMime.split('/')[0] || ''
  if (mimeRoot && MIME_FALLBACK_ICONS[mimeRoot]) {
    return { icon: MIME_FALLBACK_ICONS[mimeRoot], label: mimeRoot.toUpperCase() }
  }
  const fallbackSource = extension || mimeRoot || 'file'
  const fallbackLabel = fallbackSource.slice(0, 6).toUpperCase()
  return { icon: File, label: fallbackLabel }
}

function normalizeCustomFieldSubmitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}

function prepareAssignmentsForForm(assignments?: AttachmentAssignment[] | null): AssignmentDraft[] {
  return filterLibraryAssignments(assignments).map((assignment) => ({
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

type AttachmentUploadFormValues = {
  files: File[]
  partitionCode?: string
  tags?: string[]
  assignments?: AssignmentDraft[]
} & Record<string, unknown>

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
                  variant="outline"
                  disabled={disabled}
                  onClick={() => handleRemove(index)}
                  className="inline-flex items-center gap-1 text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                  {labels.remove}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleAdd} className="inline-flex items-center gap-1">
        <Plus className="h-4 w-4" />
        {labels.add}
      </Button>
    </div>
  )
}

type AttachmentFilesFieldProps = CrudCustomFieldRenderProps & {
  labels: {
    dropHint: string
    choose: string
    uploading: string
    empty: string
  }
  uploading: boolean
}

function AttachmentFilesField({
  value,
  setValue,
  disabled,
  error,
  labels,
  uploading,
}: AttachmentFilesFieldProps) {
  const files = React.useMemo(() => (Array.isArray(value) ? (value as File[]) : []), [value])
  const [isDragOver, setDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const acceptFiles = React.useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const dedupe = new Map<string, File>(files.map((file) => [`${file.name}:${file.size}`, file]))
      Array.from(list).forEach((file) => {
        dedupe.set(`${file.name}:${file.size}`, file)
      })
      setValue(Array.from(dedupe.values()))
    },
    [files, setValue],
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (disabled || uploading) return
      event.preventDefault()
      event.stopPropagation()
      setDragOver(false)
      acceptFiles(event.dataTransfer?.files ?? null)
    },
    [acceptFiles, disabled, uploading],
  )

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (disabled || uploading) return
      event.preventDefault()
      event.stopPropagation()
      setDragOver(true)
    },
    [disabled, uploading],
  )

  const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
  }, [])

  const removeFile = React.useCallback(
    (name: string, size: number) => {
      if (disabled || uploading) return
      setValue(files.filter((file) => !(file.name === name && file.size === size)))
    },
    [disabled, files, setValue, uploading],
  )

  const pickFiles = React.useCallback(() => {
    if (disabled || uploading) return
    fileInputRef.current?.click()
  }, [disabled, uploading])

  const renderFileList = () => {
    if (!files.length) {
      return <p className="text-xs text-muted-foreground">{labels.empty}</p>
    }
    return (
      <div className="space-y-2">
        {files.map((candidate) => (
          <div key={`${candidate.name}-${candidate.size}`} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <div>
              <div className="font-medium">{candidate.name}</div>
              <div className="text-xs text-muted-foreground">{formatFileSize(candidate.size)}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeFile(candidate.name, candidate.size)}
              disabled={disabled || uploading}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors',
          isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
          disabled || uploading ? 'opacity-70' : '',
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="presentation"
      >
        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">{labels.dropHint}</p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={pickFiles} disabled={disabled || uploading}>
          {uploading ? labels.uploading : labels.choose}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            acceptFiles(event.target.files)
            event.currentTarget.value = ''
          }}
          disabled={disabled || uploading}
        />
      </div>
      {renderFileList()}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

type AttachmentUploadFormProps = {
  partitions: Array<{ code: string; title: string }>
  availableTags: string[]
  onUploaded: () => void
  onCancel: () => void
}

function AttachmentUploadForm({ partitions, availableTags, onUploaded, onCancel }: AttachmentUploadFormProps) {
  const t = useT()
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState<{ completed: number; total: number }>({ completed: 0, total: 0 })

  const partitionOptions = React.useMemo(
    () =>
      partitions.map((entry) => ({
        value: entry.code,
        label: entry.title || entry.code,
      })),
    [partitions],
  )

  const assignmentLabels = React.useMemo(
    () => ({
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
    }),
    [t],
  )

  const formSchema = React.useMemo(
    () =>
      z
        .object({
          files: z.array(z.any()).min(1, { message: t('attachments.library.upload.fileRequired', 'Select at least one file to upload.') }),
          partitionCode: z.string().optional(),
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
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => {
    return [
      {
        id: 'files',
        label: t('attachments.library.upload.file', 'Files'),
        type: 'custom',
        component: (props) => (
          <AttachmentFilesField
            {...props}
            uploading={isUploading}
            labels={{
              dropHint: t('attachments.library.upload.dropHint', 'Drag and drop files here or click to upload.'),
              choose: t('attachments.library.upload.choose', 'Choose files'),
              uploading: t('attachments.library.upload.submitting', 'Uploading…'),
              empty: t('attachments.library.upload.noFiles', 'No files selected yet.'),
            }}
          />
        ),
      },
      {
        id: 'partitionCode',
        label: t('attachments.library.upload.partition', 'Partition'),
        type: 'select',
        options: [
          { value: '', label: t('attachments.library.upload.partitionDefault', 'Default (private)') },
          ...partitionOptions,
        ],
      },
      {
        id: 'tags',
        label: t('attachments.library.table.tags', 'Tags'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <TagsInput
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(next) => setValue(next)}
            suggestions={availableTags}
            placeholder={t('attachments.library.upload.tagsPlaceholder', 'Add tags')}
            disabled={Boolean(disabled) || isUploading}
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
            disabled={Boolean(disabled) || isUploading}
          />
        ),
      },
    ]
  }, [assignmentLabels, availableTags, isUploading, partitionOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      {
        id: 'details',
        title: t('attachments.library.upload.title', 'Upload attachment'),
        column: 1,
        fields: ['files', 'partitionCode', 'tags', 'assignments'],
      },
      {
        id: 'customFields',
        title: t('entities.customFields.title', 'Custom attributes'),
        column: 2,
        kind: 'customFields',
      },
    ]
  }, [t])

  const uploadPercentage = uploadProgress.total
    ? Math.min(100, Math.round((uploadProgress.completed / uploadProgress.total) * 100))
    : 0

  const handleSubmit = React.useCallback(
    async (values: AttachmentUploadFormValues) => {
      const files = Array.isArray(values.files) ? values.files : []
      if (!files.length) {
        throw new Error(t('attachments.library.upload.fileRequired', 'Select at least one file to upload.'))
      }
      setUploadProgress({ completed: 0, total: files.length })
      setIsUploading(true)
      try {
        const tags = Array.isArray(values.tags)
          ? values.tags
              .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
              .filter((tag) => tag.length > 0)
          : []
        const cleanedAssignments =
          Array.isArray(values.assignments) && values.assignments.length
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
        let completed = 0
        for (const file of files) {
          const fd = new FormData()
          fd.set('entityId', LIBRARY_ENTITY_ID)
          fd.set(
            'recordId',
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()),
          )
          fd.set('file', file)
          if (typeof values.partitionCode === 'string' && values.partitionCode.trim().length) {
            fd.set('partitionCode', values.partitionCode.trim())
          }
          if (tags.length) fd.set('tags', JSON.stringify(tags))
          if (cleanedAssignments.length) fd.set('assignments', JSON.stringify(cleanedAssignments))
          if (Object.keys(customFields).length) fd.set('customFields', JSON.stringify(customFields))
          const call = await apiCall<{ error?: string }>('/api/attachments', {
            method: 'POST',
            body: fd,
          })
          if (!call.ok) {
            const message = call.result?.error || t('attachments.library.upload.failed', 'Upload failed.')
            throw new Error(message)
          }
          completed += 1
          setUploadProgress({ completed, total: files.length })
        }
        flash(t('attachments.library.upload.success', 'Attachment uploaded.'), 'success')
        onUploaded()
        onCancel()
      } catch (err: any) {
        const message = err?.message || t('attachments.library.upload.failed', 'Upload failed.')
        flash(message, 'error')
        throw new Error(message)
      } finally {
        setIsUploading(false)
      }
    },
    [onCancel, onUploaded, t],
  )

  return (
    <div className="relative">
      <CrudForm<AttachmentUploadFormValues>
        embedded
        schema={formSchema}
        entityId={E.attachments.attachment}
        fields={fields}
        groups={groups}
        initialValues={{ files: [], tags: [], assignments: [], partitionCode: '' }}
        submitLabel={
          isUploading
            ? t('attachments.library.upload.submitting', 'Uploading…')
            : t('attachments.library.upload.submit', 'Upload')
        }
        extraActions={
          <Button type="button" variant="outline" onClick={onCancel} disabled={isUploading}>
            {t('attachments.library.upload.cancel', 'Cancel')}
          </Button>
        }
        onSubmit={handleSubmit}
      />
      {isUploading ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6 text-center backdrop-blur">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border/50 bg-card/95 px-6 py-8 shadow-2xl">
            <Spinner size="lg" className="border-primary/50 border-t-primary" />
            <div className="w-full space-y-3">
              <p className="text-base font-semibold">
                {t('attachments.library.upload.progressLabel', 'Uploading files')}
              </p>
              {uploadProgress.total > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {uploadProgress.completed}/{uploadProgress.total}
                  </p>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary transition-all"
                      style={{
                        width: `${uploadPercentage}%`,
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type MetadataDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  item: AttachmentRow | null
  availableTags: string[]
  onSave: (
    id: string,
    payload: { tags: string[]; assignments: AssignmentDraft[]; customFields?: Record<string, unknown> },
  ) => Promise<void>
}

export function AttachmentMetadataDialog({ open, onOpenChange, item, availableTags, onSave }: MetadataDialogProps) {
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
      const payload: { tags: string[]; assignments: AssignmentDraft[]; customFields?: Record<string, unknown> } = {
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

type UploadDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  partitions: Array<{ code: string; title: string }>
  availableTags: string[]
  onUploaded: () => void
}

function AttachmentUploadDialog({ open, onOpenChange, partitions, availableTags, onUploaded }: UploadDialogProps) {
  const t = useT()
  const [formResetKey, setFormResetKey] = React.useState(0)
  const previousOpen = React.useRef(open)

  React.useEffect(() => {
    if (previousOpen.current && !open) {
      setFormResetKey((prev) => prev + 1)
    }
    previousOpen.current = open
  }, [open])

  const handleDialogChange = React.useCallback(
    (next: boolean) => {
      onOpenChange(next)
    },
    [onOpenChange],
  )

  const handleUploaded = React.useCallback(() => {
    onUploaded()
  }, [onUploaded])

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-[54.6rem]">
        <DialogHeader>
          <DialogTitle>{t('attachments.library.upload.title', 'Upload attachment')}</DialogTitle>
        </DialogHeader>
        <AttachmentUploadForm
          key={formResetKey}
          partitions={partitions}
          availableTags={availableTags}
          onUploaded={handleUploaded}
          onCancel={() => handleDialogChange(false)}
        />
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
          const placeholder = resolveAttachmentPlaceholder(value.mimeType, value.fileName)
          const PlaceholderIcon = placeholder.icon
          return (
            <div className="flex h-16 w-16 flex-col items-center justify-center rounded border bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
              <PlaceholderIcon className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              {placeholder.label}
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
            <div className="space-y-1 min-w-0 max-w-[280px]">
              <div className="font-medium truncate" title={value.fileName}>
                {value.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatFileSize(value.fileSize)} • {value.mimeType || 'application/octet-stream'}
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2">
                {value.content?.trim()
                  ? value.content
                  : t('attachments.library.metadata.noContent', 'No text extracted')}
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
          const assignments = filterLibraryAssignments(row.original.assignments)
          if (!assignments.length) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex flex-col gap-1">
              {assignments.map((assignment) => {
                const label = assignment.label?.trim() || assignment.id
                const hideType =
                  assignment.type === E.catalog.catalog_product ||
                  assignment.type === E.catalog.catalog_product_variant
                const content = hideType ? label : `${assignment.type}: ${label}`
                return assignment.href ? (
                  <a
                    key={`${assignment.type}-${assignment.id}-${assignment.href}`}
                    href={assignment.href}
                    className="text-sm text-blue-600 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {content}
                  </a>
                ) : (
                  <div key={`${assignment.type}-${assignment.id}`} className="text-sm">
                    {content}
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
          <div className="text-sm text-muted-foreground">
            {row.original.partitionTitle ?? row.original.partitionCode}
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
      {
        id: 'download',
        header: t('attachments.library.table.download', 'Download'),
        enableSorting: false,
        cell: ({ row }) => {
          const downloadPath = buildAttachmentFileUrl(row.original.id, { download: true })
          const absolute = resolveAbsoluteUrl(downloadPath)
          return (
            <Button variant="ghost" size="icon" asChild>
              <a href={absolute} download aria-label={t('attachments.library.table.download', 'Download')}>
                <Download className="h-4 w-4" />
              </a>
            </Button>
          )
        },
      },
    ]
  }, [t])

  const openMetadataDialog = React.useCallback((row: AttachmentRow) => {
    setSelectedRow(row)
    setMetadataDialogOpen(true)
  }, [])

  const handleMetadataSave = React.useCallback(
    async (id: string, payload: { tags: string[]; assignments: AssignmentDraft[]; customFields?: Record<string, unknown> }) => {
      try {
        const body: Record<string, unknown> = {
          tags: payload.tags,
          assignments: payload.assignments,
        }
        if (payload.customFields && Object.keys(payload.customFields).length) {
          body.customFields = payload.customFields
        }
        const call = await apiCall<{ error?: string }>(`/api/attachments/library/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!call.ok) {
          const message =
            call.result?.error || t('attachments.library.metadata.error', 'Failed to update metadata.')
          flash(message, 'error')
          return
        }
        flash(t('attachments.library.metadata.success', 'Attachment updated.'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['attachments-library'], exact: false })
        setMetadataDialogOpen(false)
      } catch (err: any) {
        flash(err?.message || t('attachments.library.metadata.error', 'Failed to update metadata.'), 'error')
      }
    },
    [queryClient, t],
  )

  const handleUploadCompleted = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['attachments-library'], exact: false })
  }, [queryClient])

  const handleDelete = React.useCallback(
    async (row: AttachmentRow) => {
      const confirmMessage = t(
        'attachments.library.confirm.delete',
        'Delete attachment "{{name}}"? This action cannot be undone.',
      ).replace('{{name}}', row.fileName || row.id)
      if (!window.confirm(confirmMessage)) return
      try {
        const call = await apiCall<{ error?: string }>(
          `/api/attachments/library/${encodeURIComponent(row.id)}`,
          { method: 'DELETE' },
        )
        if (!call.ok) {
          const message =
            call.result?.error || t('attachments.library.errors.delete', 'Failed to delete attachment.')
          flash(message, 'error')
          return
        }
        flash(t('attachments.library.messages.deleted', 'Attachment removed.'), 'success')
        if (selectedRow?.id === row.id) {
          setSelectedRow(null)
          setMetadataDialogOpen(false)
        }
        await queryClient.invalidateQueries({ queryKey: ['attachments-library'], exact: false })
      } catch (err: any) {
        flash(err?.message || t('attachments.library.errors.delete', 'Failed to delete attachment.'), 'error')
      }
    },
    [queryClient, selectedRow, t],
  )

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
                  const absolute = resolveAbsoluteUrl(row.url)
                  navigator.clipboard
                    .writeText(absolute)
                    .then(() =>
                      flash(
                        t('attachments.library.actions.copied', 'Link copied.'),
                        'success',
                      ),
                    )
                    .catch(() =>
                      flash(
                        t('attachments.library.actions.copyError', 'Unable to copy link.'),
                        'error',
                      ),
                    )
                },
              },
              {
                label: t('attachments.library.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => { void handleDelete(row) },
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
