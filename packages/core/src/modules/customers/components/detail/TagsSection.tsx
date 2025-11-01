"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { useT } from '@/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { slugifyTagLabel } from '../../lib/detailHelpers'

export type TagOption = {
  id: string
  label: string
  color?: string | null
}

type TagsSectionProps = {
  entityId: string
  tags: TagOption[]
  onChange?: (next: TagOption[]) => void
  isSubmitting?: boolean
  title?: string
}

export function TagsSection({ entityId, tags, onChange, isSubmitting = false, title }: TagsSectionProps) {
  const t = useT()
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

  const fetchTags = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams({ pageSize: '100' })
    if (query) params.set('search', query)
    const res = await apiFetch(`/api/customers/tags?${params.toString()}`)
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : t('customers.people.detail.tags.loadError', 'Failed to load tags.')
      throw new Error(message)
    }
    const items = Array.isArray(payload?.items) ? payload.items : []
    return items
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null
        const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown; color?: unknown }
        const rawId = typeof raw.id === 'string'
          ? raw.id
          : typeof raw.tagId === 'string'
            ? raw.tagId
            : null
        if (!rawId) return null
        const labelValue = typeof raw.label === 'string' && raw.label.trim().length
          ? raw.label.trim()
          : typeof raw.slug === 'string' && raw.slug.trim().length
            ? raw.slug.trim()
            : rawId
        const color = typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null
        return { id: rawId, label: labelValue, color }
      })
      .filter((value: TagOption | null): value is TagOption => value !== null)
  }, [t])

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

  const loadSuggestions = React.useCallback(async (query?: string) => {
    try {
      const fetched = await fetchTags(query)
      syncFetchedOptions(fetched)
      return fetched.map((tag: TagOption) => tag.label)
    } catch (err) {
      console.error('customers.people.detail.tags.suggest', err)
      return []
    }
  }, [fetchTags, syncFetchedOptions])

  const startEditing = React.useCallback(async () => {
    if (editing || isSubmitting || !entityId) return
    setError(null)
    setDraft(tags.map((tag) => tag.label))
    setEditing(true)
    setLoadingOptions(true)
    try {
      const fetched = await fetchTags()
      syncFetchedOptions(fetched)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.tags.loadError', 'Failed to load tags.')
      setError(message)
      flash(message, 'error')
    } finally {
      setLoadingOptions(false)
    }
  }, [editing, entityId, fetchTags, isSubmitting, syncFetchedOptions, tags, t])

  const cancelEditing = React.useCallback(() => {
    setEditing(false)
    setDraft([])
    setError(null)
  }, [])

  const createTag = React.useCallback(async (label: string) => {
    const trimmed = label.trim()
    if (!trimmed.length) {
      throw new Error(t('customers.people.detail.tags.labelRequired', 'Tag name is required.'))
    }
    const res = await apiFetch('/api/customers/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: trimmed,
        slug: slugifyTagLabel(trimmed),
      }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : t('customers.people.detail.tags.createError', 'Failed to create tag.')
      throw new Error(message)
    }
    const id = typeof payload?.id === 'string' ? payload.id : typeof payload?.tagId === 'string' ? payload.tagId : ''
    if (!id) throw new Error(t('customers.people.detail.tags.createError', 'Failed to create tag.'))
    const color = typeof payload?.color === 'string' && payload.color.trim().length ? payload.color.trim() : null
    return { id, label: trimmed, color }
  }, [t])

  const assignTag = React.useCallback(async (tagId: string) => {
    if (!entityId) return
    const res = await apiFetch('/api/customers/tags/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagId, entityId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      const message = typeof payload?.error === 'string'
        ? payload.error
        : t('customers.people.detail.tags.assignError', 'Failed to assign tag.')
      throw new Error(message)
    }
  }, [entityId, t])

  const unassignTag = React.useCallback(async (tagId: string) => {
    if (!entityId) return
    const res = await apiFetch('/api/customers/tags/unassign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagId, entityId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      const message = typeof payload?.error === 'string'
        ? payload.error
        : t('customers.people.detail.tags.unassignError', 'Failed to remove tag.')
      throw new Error(message)
    }
  }, [entityId, t])

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
        const created = await createTag(matchingLabel)
        setOptions((prev) => {
          const next = new Map(prev)
          next.set(created.label.toLowerCase(), created)
          return next
        })
        finalTagOptions.push(created)
      }

      const finalIds = new Set(finalTagOptions.map((tag) => tag.id))
      const toAssign = Array.from(finalIds).filter((id) => !currentIds.has(id))
      const toUnassign = Array.from(currentIds).filter((id) => !finalIds.has(id))

      for (const id of toAssign) {
        await assignTag(id)
      }
      for (const id of toUnassign) {
        await unassignTag(id)
      }

      onChange?.(finalTagOptions)
      setEditing(false)
      setDraft([])
      flash(t('customers.people.detail.tags.success', 'Tags updated.'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.tags.error', 'Failed to update tags.')
      setError(message)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [assignTag, createTag, draft, onChange, options, saving, t, tags, unassignTag])

  const activeTags = editing
    ? draft
    : tags.map((tag) => tag.label)

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between group">
        <h2 className="text-sm font-semibold">
          {title ?? t('customers.people.detail.sections.tags')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={editing ? cancelEditing : startEditing}
          disabled={isSubmitting || saving || !entityId}
          className={
            editing
              ? 'opacity-100 transition-opacity duration-150'
              : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100'
          }
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">
            {editing ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}
          </span>
        </Button>
      </div>

      {editing ? (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <DataLoader
            isLoading={loadingOptions}
            loadingMessage={t('customers.people.detail.tags.loading', 'Loading tags…')}
            spinnerSize="sm"
          >
            <div className="space-y-3" onKeyDown={handleEditingKeyDown}>
              <TagsInput
                value={activeTags}
                onChange={(values) => setDraft(values)}
                placeholder={t('customers.people.detail.tags.placeholder', 'Type to add tags')}
                loadSuggestions={loadSuggestions}
                autoFocus
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <div className="flex items-center gap-2 mt-3 mb-2">
                <Button type="button" size="sm" onClick={handleSave} disabled={saving || isSubmitting}>
                  {saving ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border border-background border-t-primary" /> : null}
                  {t('customers.people.detail.tags.saveShortcut', 'Save (⌘/Ctrl + Enter)')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEditing} disabled={saving || isSubmitting}>
                  {t('customers.people.detail.tags.cancelShortcut', 'Cancel (Esc)')}
                </Button>
              </div>
            </div>
          </DataLoader>
        </div>
      ) : (
        <div
          className="group/tags relative rounded-lg border bg-muted/20 p-4 cursor-pointer transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none"
          role="button"
          tabIndex={isSubmitting ? -1 : 0}
          onClick={startEditing}
          onKeyDown={(event) => {
            if (isSubmitting) return
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
              {t('customers.people.detail.empty.tags')}
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
