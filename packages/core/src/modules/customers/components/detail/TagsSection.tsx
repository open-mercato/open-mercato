"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { useT } from '@/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type TagOption = {
  id: string
  label: string
  color?: string | null
}

type TagsSectionProps = {
  tags: TagOption[]
  loadOptions: (query?: string) => Promise<TagOption[]>
  onAssign: (tagId: string) => Promise<void>
  onUnassign: (tagId: string) => Promise<void>
  onCreate: (input: { label: string }) => Promise<TagOption>
  onChange?: (next: TagOption[]) => void
  isSubmitting?: boolean
  title?: string
}

export function TagsSection({
  tags,
  loadOptions,
  onAssign,
  onUnassign,
  onCreate,
  onChange,
  isSubmitting = false,
  title,
}: TagsSectionProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [options, setOptions] = React.useState<Map<string, TagOption>>(new Map())
  const [loadingOptions, setLoadingOptions] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const startEditing = React.useCallback(async () => {
    if (editing || isSubmitting) return
    setError(null)
    setDraft(tags.map((tag) => tag.label))
    setEditing(true)
    setLoadingOptions(true)
    try {
      const fetched = await loadOptions()
      setOptions(
        fetched.reduce<Map<string, TagOption>>((acc, tag) => {
          acc.set(tag.label.toLowerCase(), tag)
          return acc
        }, new Map()),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.tags.loadError', 'Failed to load tags.')
      setError(message)
      flash(message, 'error')
    } finally {
      setLoadingOptions(false)
    }
  }, [editing, isSubmitting, tags, loadOptions, t])

  const cancelEditing = React.useCallback(() => {
    setEditing(false)
    setDraft([])
    setError(null)
  }, [])

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
        const created = await onCreate({ label: matchingLabel })
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
        await onAssign(id)
      }
      for (const id of toUnassign) {
        await onUnassign(id)
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
  }, [draft, onAssign, onChange, onCreate, onUnassign, options, saving, t, tags])

  const activeTags = editing
    ? draft
    : tags.map((tag) => tag.label)

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
          disabled={isSubmitting || saving}
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
            <TagsInput
              value={activeTags}
              onChange={(values) => setDraft(values)}
              placeholder={t('customers.people.detail.tags.placeholder', 'Type to add tags')}
              autoFocus
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={handleSave} disabled={saving || isSubmitting}>
                {saving ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border border-background border-t-primary" /> : null}
                {t('ui.forms.actions.save')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancelEditing} disabled={saving || isSubmitting}>
                {t('ui.forms.actions.cancel')}
              </Button>
            </div>
          </DataLoader>
        </div>
      ) : (
        <div
          className="rounded-lg border bg-muted/20 p-4 min-h-[64px] cursor-pointer"
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
