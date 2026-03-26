"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '../injection/useRegisteredComponent'

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
  saving?: string
  autoSaveHint?: string
}

export type TagsSectionController = {
  flush: () => Promise<void>
}

export type TagsSectionProps = {
  title: string
  tags: TagOption[]
  onChange?: (next: TagOption[]) => void
  isSubmitting?: boolean
  canEdit?: boolean
  autoSave?: boolean
  controllerRef?: React.MutableRefObject<TagsSectionController | null>
  loadOptions: (query?: string) => Promise<TagOption[]>
  createTag: (label: string) => Promise<TagOption>
  onSave: (params: {
    next: TagOption[]
    added: TagOption[]
    removed: TagOption[]
  }) => Promise<void>
  labels: TagsSectionLabels
}

function normalizeTagLabels(labels: string[]): string[] {
  return Array.from(
    new Set(
      labels
        .map((label) => label.trim().toLowerCase())
        .filter((label) => label.length > 0),
    ),
  ).sort()
}

function buildTagLabelKey(labels: string[]): string {
  return normalizeTagLabels(labels).join('\0')
}

function TagsSectionImpl({
  title,
  tags,
  onChange,
  isSubmitting = false,
  canEdit = true,
  autoSave = false,
  loadOptions,
  createTag,
  onSave,
  labels,
  controllerRef,
}: TagsSectionProps) {
  const [editing, setEditing] = React.useState(autoSave)
  const [draft, setDraft] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [, setOptions] = React.useState<Map<string, TagOption>>(() => new Map())
  const [loadingOptions, setLoadingOptions] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const draftRef = React.useRef<string[]>([])
  const savedTagsRef = React.useRef<TagOption[]>(tags)
  const optionsRef = React.useRef<Map<string, TagOption>>(new Map())
  const saveTaskRef = React.useRef<Promise<void> | null>(null)
  React.useEffect(() => {
    savedTagsRef.current = tags
    setOptions((prev) => {
      const next = new Map(prev)
      for (const tag of tags) {
        next.set(tag.label.toLowerCase(), tag)
      }
      optionsRef.current = next
      return next
    })
  }, [tags])

  React.useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const syncFetchedOptions = React.useCallback((fetched: TagOption[]) => {
    if (!fetched.length) return
    setOptions((prev) => {
      const next = new Map(prev)
      for (const tag of fetched) {
        next.set(tag.label.toLowerCase(), tag)
      }
      optionsRef.current = next
      return next
    })
  }, [])

  const hasPendingDraftChanges = React.useCallback(() => {
    if (!autoSave || !autoSaveUserEditedRef.current) return false
    const draftLabels = normalizeTagLabels(draftRef.current)
    const savedLabels = normalizeTagLabels(savedTagsRef.current.map((tag) => tag.label))
    if (draftLabels.length !== savedLabels.length) return true
    return draftLabels.some((label, index) => label !== savedLabels[index])
  }, [autoSave])

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
      const existing = optionsRef.current.get(normalized.toLowerCase())
      if (existing) return existing
      try {
        const created = await createTag(normalized)
        setOptions((prev) => {
          const next = new Map(prev)
          next.set(created.label.toLowerCase(), created)
          optionsRef.current = next
          return next
        })
        return created
      } catch (err) {
        const message = err instanceof Error ? err.message : labels.createError
        throw new Error(message)
      }
    },
    [createTag, labels.createError, labels.labelRequired],
  )

  const handleSave = React.useCallback(async () => {
    if (saveTaskRef.current) {
      await saveTaskRef.current
      if (!autoSave || !hasPendingDraftChanges()) return
    }
    if (autoSave && !hasPendingDraftChanges()) {
      autoSaveUserEditedRef.current = false
      return
    }

    const trimmed = draftRef.current.map((label) => label.trim()).filter((label) => label.length > 0)
    const uniqueLabels = Array.from(new Set(trimmed.map((label) => label.toLowerCase())))

    let shouldContinueAutoSave = false

    const task = (async () => {
      const currentTags = savedTagsRef.current
      const currentIds = new Set(currentTags.map((tag) => tag.id))
      const finalTagOptions: TagOption[] = []
      const submittedDraftKey = buildTagLabelKey(trimmed)

      setSaving(true)
      setError(null)
      try {
        for (const normalized of uniqueLabels) {
          const existing = optionsRef.current.get(normalized)
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
        const removed = currentTags.filter((tag) => !finalIds.has(tag.id))

        if (added.length > 0 || removed.length > 0) {
          await onSave({ next: finalTagOptions, added, removed })
        }

        savedTagsRef.current = finalTagOptions
        onChange?.(finalTagOptions)
        if (autoSave) {
          const latestDraftKey = buildTagLabelKey(draftRef.current)
          if (latestDraftKey === submittedDraftKey) {
            autoSaveUserEditedRef.current = false
            setDraft(finalTagOptions.map((tag) => tag.label))
          } else {
            shouldContinueAutoSave = true
          }
        } else {
          setEditing(false)
          setDraft([])
        }
        if (labels.success && (added.length > 0 || removed.length > 0)) flash(labels.success, 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : labels.updateError
        setError(message)
        flash(message, 'error')
      } finally {
        setSaving(false)
      }
    })()

    saveTaskRef.current = task
    try {
      await task
    } finally {
      saveTaskRef.current = null
    }
    if (shouldContinueAutoSave) {
      void handleSave()
    }
  }, [autoSave, ensureTagOption, hasPendingDraftChanges, labels.success, labels.updateError, onChange, onSave])

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

  const autoSaveInitializedRef = React.useRef(false)

  React.useEffect(() => {
    if (!autoSave || autoSaveInitializedRef.current) return
    autoSaveInitializedRef.current = true
    setEditing(true)
    setDraft(tags.map((tag) => tag.label))
    let cancelled = false
    loadOptions().then((fetched) => {
      if (cancelled) return
      syncFetchedOptions(fetched)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave])

  const autoSaveUserEditedRef = React.useRef(false)
  const originalOnChange = React.useCallback(
    (values: string[]) => {
      autoSaveUserEditedRef.current = true
      setDraft(values)
    },
    [],
  )

  React.useEffect(() => {
    if (!autoSave || !editing || !autoSaveUserEditedRef.current) return
    if (!hasPendingDraftChanges()) return
    void handleSave()
  }, [autoSave, draft, editing, handleSave, hasPendingDraftChanges])

  const flush = React.useCallback(async () => {
    if (saveTaskRef.current) {
      await saveTaskRef.current
      if (!autoSave || !editing || !hasPendingDraftChanges()) return
    }
    if (!autoSave || !editing || !hasPendingDraftChanges()) return
    await handleSave()
  }, [autoSave, editing, handleSave, hasPendingDraftChanges])

  React.useEffect(() => {
    if (!controllerRef) return
    controllerRef.current = { flush }
    return () => {
      if (controllerRef.current?.flush === flush) {
        controllerRef.current = null
      }
    }
  }, [controllerRef, flush])

  const disableInteraction = isSubmitting || !canEdit
  const autoSaveStatusLabel = saving
    ? (labels.saving ?? 'Saving…')
    : (labels.autoSaveHint ?? null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between group">
        <h2 className="text-sm font-semibold">
          {title}
        </h2>
        {autoSave ? (
          autoSaveStatusLabel ? <p className="text-xs text-muted-foreground">{autoSaveStatusLabel}</p> : null
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={editing ? cancelEditing : startEditing}
            disabled={disableInteraction || saving}
            className={
              editing
                ? 'opacity-100 transition-opacity duration-150'
                : 'opacity-100 md:opacity-0 transition-opacity duration-150 md:group-hover:opacity-100 focus-visible:opacity-100'
            }
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            <span className="sr-only">
              {editing ? labels.cancel ?? 'Cancel' : labels.edit ?? 'Edit'}
            </span>
          </Button>
        )}
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
                onChange={autoSave ? originalOnChange : (values) => setDraft(values)}
                placeholder={labels.placeholder}
                loadSuggestions={loadSuggestions}
                autoFocus={!autoSave}
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              {autoSave ? null : (
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
              )}
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

export function TagsSection(props: TagsSectionProps) {
  const handle = ComponentReplacementHandles.section('ui.detail', 'TagsSection')
  const Resolved = useRegisteredComponent<TagsSectionProps>(
    handle,
    TagsSectionImpl as React.ComponentType<TagsSectionProps>,
  )

  return (
    <div data-component-handle={handle}>
      <Resolved {...props} />
    </div>
  )
}

export default TagsSection
