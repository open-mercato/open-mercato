"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type TagOption = {
  id: string
  label: string
  color?: string | null
}

export type TagsSectionLabels = {
  loading: string
  placeholder: string
  empty: string
  loadError: string
  createError: string
  updateError: string
  labelRequired: string
  saveShortcut: string
  cancelShortcut: string
  edit?: string
  cancel?: string
  success?: string
}

export type TagsSectionProps = {
  title: string
  tags: TagOption[]
  onChange?: (next: TagOption[]) => void
  isSubmitting?: boolean
  canEdit?: boolean
  loadOptions: (query?: string) => Promise<TagOption[]>
  createTag: (label: string) => Promise<TagOption>
  onSave: (params: {
    next: TagOption[]
    added: TagOption[]
    removed: TagOption[]
  }) => Promise<void>
  labels: TagsSectionLabels
}

export function TagsSection({
  title,
  tags,
  onChange,
  isSubmitting = false,
  canEdit = true,
  loadOptions,
  createTag,
  onSave,
  labels,
}: TagsSectionProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [options, setOptions] = React.useState<Map<string, TagOption>>(() => new Map())
  const [loadingOptions, setLoadingOptions] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setOptions((prev) => {
      const next = new Map(prev)
      for (const tag of tags) {
        next.set(tag.label.toLowerCase(), tag)
      }
      return next
    })
  }, [tags])

  const syncFetchedOptions = React.useCallback((fetched: TagOption[]) => {
    if (!fetched.length) return
    setOptions((prev) => {
      const next = new Map(prev)
      for (const tag of fetched) {
        next.set(tag.label.toLowerCase(), tag)
      }
      return next
    })
  }, [])

  const loadSuggestions = React.useCallback(
    async (query?: string) => {
      try {
        const fetched = await loadOptions(query)
        syncFetchedOptions(fetched)
        return fetched.map((tag) => tag.label)
      } catch (err) {
        console.error('tags.section.loadSuggestions', err)
        return []
      }
    },
    [loadOptions, syncFetchedOptions],
  )

  const startEditing = React.useCallback(async () => {
    if (editing || isSubmitting || !canEdit) return
    setError(null)
    setDraft(tags.map((tag) => tag.label))
    setEditing(true)
    setLoadingOptions(true)
    try {
      const fetched = await loadOptions()
      syncFetchedOptions(fetched)
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.loadError
      setError(message)
      flash(message, 'error')
    } finally {
      setLoadingOptions(false)
    }
  }, [canEdit, editing, isSubmitting, labels.loadError, loadOptions, syncFetchedOptions, tags])

  const cancelEditing = React.useCallback(() => {
    setEditing(false)
    setDraft([])
    setError(null)
  }, [])

  const ensureTagOption = React.useCallback(
    async (label: string): Promise<TagOption> => {
      const normalized = label.trim()
      if (!normalized.length) {
        throw new Error(labels.labelRequired)
      }
      const existing = options.get(normalized.toLowerCase())
      if (existing) return existing
      try {
        const created = await createTag(normalized)
        setOptions((prev) => {
          const next = new Map(prev)
          next.set(created.label.toLowerCase(), created)
          return next
        })
        return created
      } catch (err) {
        const message = err instanceof Error ? err.message : labels.createError
        throw new Error(message)
      }
    },
    [createTag, labels.createError, labels.labelRequired, options],
  )

  const handleSave = React.useCallback(async () => {
    if (saving) return
    const trimmed = draft.map((label) => label.trim()).filter((label) => label.length > 0)
    const uniqueLabels = Array.from(new Set(trimmed.map((label) => label.toLowerCase())))

    const currentIds = new Set(tags.map((tag) => tag.id))
    const finalTagOptions: TagOption[] = []

    setSaving(true)
    setError(null)
    try {
      for (const normalized of uniqueLabels) {
        const existing = options.get(normalized)
        if (existing) {
          finalTagOptions.push(existing)
          continue
        }
        const matchingLabel = trimmed.find((label) => label.toLowerCase() === normalized) ?? normalized
        const created = await ensureTagOption(matchingLabel)
        finalTagOptions.push(created)
      }

      const finalIds = new Set(finalTagOptions.map((tag) => tag.id))
      const added = finalTagOptions.filter((tag) => !currentIds.has(tag.id))
      const removed = tags.filter((tag) => !finalIds.has(tag.id))

      await onSave({ next: finalTagOptions, added, removed })

      onChange?.(finalTagOptions)
      setEditing(false)
      setDraft([])
      if (labels.success) flash(labels.success, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.updateError
      setError(message)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, ensureTagOption, labels.success, labels.updateError, onChange, onSave, options, saving, tags])

  const activeTags = editing ? draft : tags.map((tag) => tag.label)

  const handleEditingKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelEditing()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (saving || isSubmitting) return
        void handleSave()
      }
    },
    [cancelEditing, editing, handleSave, isSubmitting, saving],
  )

  const disableInteraction = isSubmitting || !canEdit

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between group">
        <h2 className="text-sm font-semibold">
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={editing ? cancelEditing : startEditing}
          disabled={disableInteraction || saving}
          className={
            editing
              ? 'opacity-100 transition-opacity duration-150'
              : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100'
          }
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">
            {editing ? labels.cancel ?? 'Cancel' : labels.edit ?? 'Edit'}
          </span>
        </Button>
      </div>

      {editing ? (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <DataLoader
            isLoading={loadingOptions}
            loadingMessage={labels.loading}
            spinnerSize="sm"
          >
            <div className="space-y-3" onKeyDown={handleEditingKeyDown}>
              <TagsInput
                value={activeTags}
                onChange={(values) => setDraft(values)}
                placeholder={labels.placeholder}
                loadSuggestions={loadSuggestions}
                autoFocus
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <div className="flex items-center gap-2 mt-3 mb-2">
                <Button type="button" size="sm" onClick={handleSave} disabled={saving || isSubmitting}>
                  {saving ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border border-background border-t-primary" />
                  ) : null}
                  {labels.saveShortcut}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelEditing}
                  disabled={saving || isSubmitting}
                >
                  {labels.cancelShortcut}
                </Button>
              </div>
            </div>
          </DataLoader>
        </div>
      ) : (
        <div
          className="group/tags relative rounded-lg border bg-muted/20 p-4 transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none"
          role={disableInteraction ? undefined : 'button'}
          tabIndex={disableInteraction ? -1 : 0}
          onClick={disableInteraction ? undefined : startEditing}
          onKeyDown={(event) => {
            if (disableInteraction) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              void startEditing()
            }
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-3 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/tags:opacity-100 group-focus-within/tags:opacity-100"
          >
            <Pencil className="h-4 w-4" />
          </span>
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {labels.empty}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
                  style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TagsSection
