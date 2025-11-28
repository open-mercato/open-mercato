"use client"

import * as React from 'react'
import {
  TagsSection as SharedTagsSection,
  type TagsSectionLabels,
  type TagOption,
} from '@open-mercato/ui/backend/detail'
import { useT } from '@/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'

type TagsSectionProps = {
  entityId: string
  tags: TagOption[]
  onChange?: (next: TagOption[]) => void
  isSubmitting?: boolean
  title?: string
}

export function TagsSection({ entityId, tags, onChange, isSubmitting = false, title }: TagsSectionProps) {
  const t = useT()

  const fetchTags = React.useCallback(
    async (query?: string): Promise<TagOption[]> => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (query) params.set('search', query)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.tags.loadError', 'Failed to load tags.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .map((item: unknown): TagOption | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown; color?: unknown }
          const rawId =
            typeof raw.id === 'string'
              ? raw.id
              : typeof raw.tagId === 'string'
                ? raw.tagId
                : null
          if (!rawId) return null
          const labelValue =
            (typeof raw.label === 'string' && raw.label.trim().length && raw.label.trim()) ||
            (typeof raw.slug === 'string' && raw.slug.trim().length && raw.slug.trim()) ||
            rawId
          const color = typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null
          return { id: rawId, label: labelValue, color }
        })
        .filter((value: TagOption | null): value is TagOption => value !== null)
    },
    [t],
  )

  const createTag = React.useCallback(
    async (label: string) => {
      const trimmed = label.trim()
      if (!trimmed.length) {
        throw new Error(t('customers.people.detail.tags.labelRequired', 'Tag name is required.'))
      }
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/customers/tags',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: trimmed,
            slug: slugifyTagLabel(trimmed),
          }),
        },
        { errorMessage: t('customers.people.detail.tags.createError', 'Failed to create tag.') },
      )
      const payload = response.result ?? {}
      const id =
        typeof payload?.id === 'string' ? payload.id : typeof payload?.tagId === 'string' ? payload.tagId : ''
      if (!id) throw new Error(t('customers.people.detail.tags.createError', 'Failed to create tag.'))
      const color = typeof payload?.color === 'string' && payload.color.trim().length ? payload.color.trim() : null
      return { id, label: trimmed, color }
    },
    [t],
  )

  const assignTag = React.useCallback(
    async (tagId: string) => {
      if (!entityId) return
      await apiCallOrThrow(
        '/api/customers/tags/assign',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tagId, entityId }),
        },
        { errorMessage: t('customers.people.detail.tags.assignError', 'Failed to assign tag.') },
      )
    },
    [entityId, t],
  )

  const unassignTag = React.useCallback(
    async (tagId: string) => {
      if (!entityId) return
      await apiCallOrThrow(
        '/api/customers/tags/unassign',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tagId, entityId }),
        },
        { errorMessage: t('customers.people.detail.tags.unassignError', 'Failed to remove tag.') },
      )
    },
    [entityId, t],
  )

  const handlePersist = React.useCallback(
    async ({ added, removed }: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => {
      for (const tag of added) {
        await assignTag(tag.id)
      }
      for (const tag of removed) {
        await unassignTag(tag.id)
      }
      flash(t('customers.people.detail.tags.success', 'Tags updated.'), 'success')
    },
    [assignTag, t, unassignTag],
  )

  const labels = React.useMemo<TagsSectionLabels>(
    () => ({
      loading: t('customers.people.detail.tags.loading', 'Loading tags…'),
      placeholder: t('customers.people.detail.tags.placeholder', 'Type to add tags'),
      empty: t('customers.people.detail.empty.tags'),
      loadError: t('customers.people.detail.tags.loadError', 'Failed to load tags.'),
      createError: t('customers.people.detail.tags.createError', 'Failed to create tag.'),
      updateError: t('customers.people.detail.tags.error', 'Failed to update tags.'),
      labelRequired: t('customers.people.detail.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('customers.people.detail.tags.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter'),
      cancelShortcut: t('customers.people.detail.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit'),
      cancel: t('ui.forms.actions.cancel'),
      success: t('customers.people.detail.tags.success', 'Tags updated.'),
    }),
    [t],
  )

  return (
    <SharedTagsSection
      title={title ?? t('customers.people.detail.sections.tags')}
      tags={tags}
      onChange={onChange}
      isSubmitting={isSubmitting}
      canEdit={!!entityId}
      loadOptions={fetchTags}
      createTag={createTag}
      onSave={handlePersist}
      labels={labels}
    />
  )
}

export type { TagOption }
export default TagsSection
