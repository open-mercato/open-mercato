"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUpRightSquare, FileCode, Loader2, Palette, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatDateTime } from './utils'
import type { CommentSummary, Translator, SectionAction, TabEmptyState } from './types'
import { ICON_SUGGESTIONS } from '../../lib/dictionaries'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useT } from '@/lib/i18n/context'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../lib/markdownPreference'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { LoadingMessage } from './LoadingMessage'
import { TimelineItemHeader } from './TimelineItemHeader'
import { AppearanceDialog } from './AppearanceDialog'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

function MarkdownEditorFallback() {
  const t = useT()
  return (
    <LoadingMessage
      label={t('customers.people.detail.notes.editorLoading', 'Loading editor…')}
      className="min-h-[220px]"
    />
  )
}

const UiMarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <MarkdownEditorFallback />,
}) as unknown as React.ComponentType<UiMarkdownEditorProps>

type AppearanceDialogState =
  | { mode: 'create'; icon: string | null; color: string | null }
  | { mode: 'edit'; noteId: string; icon: string | null; color: string | null }

export type NotesSectionProps = {
  entityId: string | null
  dealId?: string | null
  emptyLabel: string
  viewerUserId: string | null
  viewerName?: string | null
  viewerEmail?: string | null
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
}

function sanitizeHexColor(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^#([0-9a-f]{6})$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

function mapComment(input: unknown): CommentSummary {
  const data = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : generateTempId()
  const body = typeof data.body === 'string' ? data.body : ''
  const createdAt =
    typeof data.createdAt === 'string'
      ? data.createdAt
      : typeof data.created_at === 'string'
        ? data.created_at
        : new Date().toISOString()
  const authorUserId =
    typeof data.authorUserId === 'string'
      ? data.authorUserId
      : typeof data.author_user_id === 'string'
        ? data.author_user_id
        : null
  const authorName =
    typeof data.authorName === 'string'
      ? data.authorName
      : typeof data.author_name === 'string'
        ? data.author_name
        : null
  const authorEmail =
    typeof data.authorEmail === 'string'
      ? data.authorEmail
      : typeof data.author_email === 'string'
        ? data.author_email
        : null
  const dealId =
    typeof data.dealId === 'string'
      ? data.dealId
      : typeof data.deal_id === 'string'
        ? data.deal_id
        : null
  const dealTitle =
    typeof data.dealTitle === 'string'
      ? data.dealTitle
      : typeof data.deal_title === 'string'
        ? data.deal_title
        : null
  const appearanceIcon =
    typeof data.appearanceIcon === 'string'
      ? data.appearanceIcon
      : typeof data.appearance_icon === 'string'
        ? data.appearance_icon
        : null
  const appearanceColor =
    typeof data.appearanceColor === 'string'
      ? data.appearanceColor
      : typeof data.appearance_color === 'string'
        ? data.appearance_color
        : null
  return {
    id,
    body,
    createdAt,
    authorUserId,
    authorName,
    authorEmail,
    dealId,
    dealTitle,
    appearanceIcon,
    appearanceColor,
  }
}

export function NotesSection({
  entityId,
  dealId,
  emptyLabel,
  viewerUserId,
  viewerName,
  viewerEmail,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
  onLoadingChange,
  dealOptions,
  entityOptions,
}: NotesSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const t = translator ?? fallbackTranslator

  const normalizedDealOptions = React.useMemo(() => {
    if (!Array.isArray(dealOptions)) return []
    const seen = new Set<string>()
    return dealOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [dealOptions])

  const dealLabelMap = React.useMemo(() => {
    const map = new Map<string, string>()
    normalizedDealOptions.forEach((option) => {
      map.set(option.id, option.label)
    })
    return map
  }, [normalizedDealOptions])

  const normalizedEntityOptions = React.useMemo(() => {
    if (!Array.isArray(entityOptions)) return []
    const seen = new Set<string>()
    return entityOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [entityOptions])

  const [selectedDealId, setSelectedDealId] = React.useState<string>(() => {
    const initial = typeof dealId === 'string' ? dealId.trim() : ''
    return initial
  })
  React.useEffect(() => {
    const initial = typeof dealId === 'string' ? dealId.trim() : ''
    if (initial !== selectedDealId) {
      setSelectedDealId(initial)
    }
  }, [dealId, selectedDealId])

  const [selectedEntityId, setSelectedEntityId] = React.useState<string>(() => {
    if (normalizedEntityOptions.length) return normalizedEntityOptions[0].id
    return typeof entityId === 'string' ? entityId : ''
  })
  React.useEffect(() => {
    if (normalizedEntityOptions.length) {
      if (!normalizedEntityOptions.some((option) => option.id === selectedEntityId)) {
        setSelectedEntityId(normalizedEntityOptions[0].id)
      }
    } else {
      const initial = typeof entityId === 'string' ? entityId : ''
      if (initial !== selectedEntityId) {
        setSelectedEntityId(initial)
      }
    }
  }, [entityId, normalizedEntityOptions, selectedEntityId])

  const resolvedEntityId = React.useMemo(() => {
    if (normalizedEntityOptions.length) return selectedEntityId
    return typeof entityId === 'string' ? entityId : ''
  }, [entityId, normalizedEntityOptions, selectedEntityId])

  const resolvedDealId = React.useMemo(() => {
    const trimmed = typeof selectedDealId === 'string' ? selectedDealId.trim() : ''
    return trimmed
  }, [selectedDealId])

  const hasEntity = resolvedEntityId.length > 0

  const [notes, setNotes] = React.useState<CommentSummary[]>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(() => Boolean(entityId || dealId))
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const pendingCounterRef = React.useRef(0)

  const pushLoading = React.useCallback(() => {
    pendingCounterRef.current += 1
    if (pendingCounterRef.current === 1) {
      onLoadingChange?.(true)
    }
  }, [onLoadingChange])

  const popLoading = React.useCallback(() => {
    pendingCounterRef.current = Math.max(0, pendingCounterRef.current - 1)
    if (pendingCounterRef.current === 0) {
      onLoadingChange?.(false)
    }
  }, [onLoadingChange])

  const [composerOpen, setComposerOpen] = React.useState(false)
  const [draftBody, setDraftBody] = React.useState('')
  const [draftIcon, setDraftIcon] = React.useState<string | null>(null)
  const [draftColor, setDraftColor] = React.useState<string | null>(null)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const focusComposer = React.useCallback(() => {
    if (!hasEntity) return
    setComposerOpen(true)
    window.requestAnimationFrame(() => {
      if (isMarkdownEnabled) {
        const markdownTextarea = formRef.current?.querySelector('textarea')
        if (markdownTextarea instanceof HTMLTextAreaElement) {
          markdownTextarea.focus()
          markdownTextarea.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }
      }
      const element = textareaRef.current
      if (!element) return
      element.focus()
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [formRef, hasEntity, isMarkdownEnabled])
  const [appearanceDialogState, setAppearanceDialogState] = React.useState<AppearanceDialogState | null>(null)
  const [appearanceDialogSaving, setAppearanceDialogSaving] = React.useState(false)
  const [appearanceDialogError, setAppearanceDialogError] = React.useState<string | null>(null)
  const [contentEditor, setContentEditor] = React.useState<{ id: string; value: string }>({ id: '', value: '' })
  const [contentSavingId, setContentSavingId] = React.useState<string | null>(null)
  const [contentError, setContentError] = React.useState<string | null>(null)
  const contentTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [visibleCount, setVisibleCount] = React.useState(0)
  const [deletingNoteId, setDeletingNoteId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const queryEntityId = typeof entityId === 'string' ? entityId : ''
    const queryDealId = typeof dealId === 'string' ? dealId : ''
    if (!queryEntityId && !queryDealId) {
      setNotes([])
      setLoadError(null)
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    pushLoading()
    async function loadNotes() {
      try {
        const params = new URLSearchParams()
        if (queryEntityId) params.set('entityId', queryEntityId)
        if (queryDealId) params.set('dealId', queryDealId)
        const payload = await readApiResultOrThrow<Record<string, unknown>>(
          `/api/customers/comments?${params.toString()}`,
          undefined,
          { errorMessage: t('customers.people.detail.notes.loadError', 'Failed to load notes.') },
        )
        if (cancelled) return
        const items = Array.isArray(payload?.items) ? payload.items : []
        const mapped = items.map(mapComment)
        setNotes(mapped)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.notes.loadError', 'Failed to load notes.')
        setNotes([])
        setLoadError(message)
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
        popLoading()
      }
    }
    loadNotes().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dealId, entityId, popLoading, pushLoading, t])

  const viewerLabel = React.useMemo(() => viewerName ?? viewerEmail ?? null, [viewerEmail, viewerName])

  const handleMarkdownToggle = React.useCallback(() => {
    setIsMarkdownEnabled((prev) => {
      const next = !prev
      writeMarkdownPreferenceCookie(next)
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: focusComposer,
      disabled: isSubmitting || isLoading || !hasEntity,
    })
    return () => onActionChange(null)
  }, [onActionChange, addActionLabel, focusComposer, hasEntity, isLoading, isSubmitting])

  const adjustTextareaSize = React.useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  React.useEffect(() => {
    adjustTextareaSize(textareaRef.current)
  }, [adjustTextareaSize, draftBody, isMarkdownEnabled, composerOpen])

  React.useEffect(() => {
    const preference = readMarkdownPreferenceCookie()
    if (preference !== null) {
      setIsMarkdownEnabled(preference)
    }
  }, [])

  React.useEffect(() => {
    if (!notes.length) {
      setVisibleCount(0)
      return
    }
    const baseline = Math.min(5, notes.length)
    setVisibleCount((prev) => {
      if (prev >= notes.length) return prev
      return Math.min(Math.max(prev, baseline), notes.length)
    })
  }, [notes.length])

  React.useEffect(() => {
    if (hasEntity) return
    setComposerOpen(false)
    setDraftBody('')
    setDraftIcon(null)
    setDraftColor(null)
  }, [hasEntity])

  const visibleNotes = React.useMemo(() => notes.slice(0, visibleCount), [notes, visibleCount])
  const hasVisibleNotes = React.useMemo(() => visibleCount > 0, [visibleCount])

  const loadMoreLabel = t('customers.people.detail.notes.loadMore')

  const handleCreateNote = React.useCallback(
    async (input: { body: string; appearanceIcon: string | null; appearanceColor: string | null }) => {
      if (!hasEntity || !resolvedEntityId) {
        flash(t('customers.people.detail.notes.entityMissing', 'Unable to determine current person.'), 'error')
        return false
      }
      const body = input.body.trim()
      if (!body) {
        focusComposer()
        return false
      }
      const icon = input.appearanceIcon && input.appearanceIcon.trim().length ? input.appearanceIcon.trim() : null
      const color = sanitizeHexColor(input.appearanceColor)
      const targetDealId = resolvedDealId.length ? resolvedDealId : null
      const dealLabel = targetDealId ? dealLabelMap.get(targetDealId) ?? null : null
      setIsSubmitting(true)
      pushLoading()
      try {
        const response = await apiCallOrThrow<Record<string, unknown>>(
          '/api/customers/comments',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              entityId: resolvedEntityId,
              body,
              appearanceIcon: icon ?? undefined,
              appearanceColor: color ?? undefined,
              dealId: targetDealId ?? undefined,
            }),
          },
          { errorMessage: t('customers.people.detail.notes.error') },
        )
        const responseBody = response.result ?? {}
        setNotes((prev) => {
          const viewerId = viewerUserId ?? null
          const resolvedAuthorId =
            typeof responseBody?.authorUserId === 'string' ? responseBody.authorUserId : viewerId ?? null
          const resolvedAuthorName = (() => {
            if (resolvedAuthorId && viewerId && resolvedAuthorId === viewerId) {
              return viewerName ?? viewerEmail ?? null
            }
            return typeof responseBody?.authorName === 'string' ? responseBody.authorName : null
          })()
          const resolvedAuthorEmail = (() => {
            if (resolvedAuthorId && viewerId && resolvedAuthorId === viewerId) {
              return viewerEmail ?? null
            }
            return typeof responseBody?.authorEmail === 'string' ? responseBody.authorEmail : null
          })()
          const newNote: CommentSummary = {
            id: typeof responseBody?.id === 'string' ? responseBody.id : generateTempId(),
            body,
            createdAt: new Date().toISOString(),
            authorUserId: resolvedAuthorId,
            authorName: resolvedAuthorName,
            authorEmail: resolvedAuthorEmail,
            dealId: targetDealId,
            dealTitle: dealLabel,
            appearanceIcon: icon,
            appearanceColor: color,
          }
          return [newNote, ...prev]
        })
        flash(t('customers.people.detail.notes.success'), 'success')
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.notes.error')
        flash(message, 'error')
        return false
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [dealLabelMap, focusComposer, hasEntity, popLoading, pushLoading, resolvedDealId, resolvedEntityId, t, viewerEmail, viewerName, viewerUserId],
  )

  const handleUpdateNote = React.useCallback(
    async (noteId: string, patch: { body?: string; appearanceIcon?: string | null; appearanceColor?: string | null }) => {
      const sanitizedBody = patch.body
      const sanitizedIcon =
        patch.appearanceIcon !== undefined && patch.appearanceIcon !== null && patch.appearanceIcon.trim().length
          ? patch.appearanceIcon.trim()
          : patch.appearanceIcon === null
            ? null
            : undefined
      const sanitizedColor =
        patch.appearanceColor !== undefined ? sanitizeHexColor(patch.appearanceColor ?? null) : undefined
      try {
        const payload: Record<string, unknown> = { id: noteId }
        if (sanitizedBody !== undefined) payload.body = sanitizedBody
        if (sanitizedIcon !== undefined) payload.appearanceIcon = sanitizedIcon
        if (sanitizedColor !== undefined) payload.appearanceColor = sanitizedColor
        await apiCallOrThrow(
          '/api/customers/comments',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('customers.people.detail.notes.updateError') },
        )
        setNotes((prev) => {
          const nextComments = prev.map((comment) => {
            if (comment.id !== noteId) return comment
            const next = { ...comment }
            if (sanitizedBody !== undefined) next.body = sanitizedBody
            if (sanitizedIcon !== undefined) next.appearanceIcon = sanitizedIcon ?? null
            if (sanitizedColor !== undefined) next.appearanceColor = sanitizedColor ?? null
            return next
          })
          return nextComments
        })
        flash(t('customers.people.detail.notes.updateSuccess'), 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : t('customers.people.detail.notes.updateError')
        flash(message, 'error')
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [t],
  )

  const handleDeleteNote = React.useCallback(
    async (note: CommentSummary) => {
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(t('customers.people.detail.notes.deleteConfirm', 'Delete this note? This action cannot be undone.'))
      if (!confirmed) return
      setDeletingNoteId(note.id)
      pushLoading()
      try {
        await apiCallOrThrow(
          `/api/customers/comments?id=${encodeURIComponent(note.id)}`,
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
          },
          { errorMessage: t('customers.people.detail.notes.deleteError', 'Failed to delete note') },
        )
        setNotes((prev) => prev.filter((existing) => existing.id !== note.id))
        flash(t('customers.people.detail.notes.deleteSuccess', 'Note deleted'), 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.notes.deleteError', 'Failed to delete note')
        flash(message, 'error')
      } finally {
        setDeletingNoteId(null)
        popLoading()
      }
    },
    [popLoading, pushLoading, t],
  )

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const created = await handleCreateNote({
        body: draftBody,
        appearanceIcon: draftIcon,
        appearanceColor: draftColor,
      })
      if (created) {
        setDraftBody('')
        setDraftIcon(null)
        setDraftColor(null)
      }
    },
    [draftBody, draftColor, draftIcon, handleCreateNote],
  )

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= notes.length) return prev
      return Math.min(prev + 5, notes.length)
    })
  }, [notes.length])

  const handleAppearanceDialogSubmit = React.useCallback(async () => {
    if (!appearanceDialogState) return
    setAppearanceDialogError(null)
    const sanitizedIcon =
      appearanceDialogState.icon && appearanceDialogState.icon.trim().length
        ? appearanceDialogState.icon.trim()
        : null
    const sanitizedColor = sanitizeHexColor(appearanceDialogState.color ?? null)
    if (appearanceDialogState.mode === 'create') {
      setDraftIcon(sanitizedIcon)
      setDraftColor(sanitizedColor)
      setAppearanceDialogState(null)
      return
    }
    setAppearanceDialogSaving(true)
    try {
      await handleUpdateNote(appearanceDialogState.noteId, {
        appearanceIcon: sanitizedIcon,
        appearanceColor: sanitizedColor,
      })
      setAppearanceDialogState(null)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.people.detail.notes.appearance.error', 'Failed to update appearance.')
      setAppearanceDialogError(message)
    } finally {
      setAppearanceDialogSaving(false)
    }
  }, [appearanceDialogState, handleUpdateNote, t])

  const handleAppearanceDialogClose = React.useCallback(() => {
    if (appearanceDialogSaving) return
    setAppearanceDialogState(null)
    setAppearanceDialogError(null)
  }, [appearanceDialogSaving])

  const handleContentSave = React.useCallback(async () => {
    if (!contentEditor.id) return
    const trimmed = contentEditor.value.trim()
    if (!trimmed) {
      setContentError(t('customers.people.detail.notes.updateError', 'Failed to update note'))
      return
    }
    setContentSavingId(contentEditor.id)
    setContentError(null)
    try {
      await handleUpdateNote(contentEditor.id, { body: trimmed })
      setContentEditor({ id: '', value: '' })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('customers.people.detail.notes.updateError', 'Failed to update note')
      setContentError(message)
    } finally {
      setContentSavingId(null)
    }
  }, [contentEditor, handleUpdateNote, t])

  const handleContentEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!contentEditor.id) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!contentSavingId) void handleContentSave()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setContentEditor({ id: '', value: '' })
        setContentError(null)
      }
    },
    [contentEditor.id, contentSavingId, handleContentSave],
  )

  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    },
    [],
  )

  const handleContentKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, note: CommentSummary) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setContentEditor({ id: note.id, value: note.body })
      }
    },
    [],
  )

  const noteAuthorLabel = React.useCallback(
    (note: CommentSummary) => {
      if (note.authorUserId && viewerUserId && note.authorUserId === viewerUserId) {
        return viewerLabel ?? t('customers.people.detail.notes.you')
      }
      return note.authorName ?? note.authorEmail ?? t('customers.people.detail.notes.unknownAuthor', 'Unknown author')
    },
    [t, viewerLabel, viewerUserId],
  )

  const noteAppearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('customers.people.detail.notes.appearance.colorLabel'),
      colorHelp: t('customers.people.detail.notes.appearance.colorHelp'),
      colorClearLabel: t('customers.people.detail.notes.appearance.clearColor'),
      iconLabel: t('customers.people.detail.notes.appearance.iconLabel'),
      iconPlaceholder: t('customers.people.detail.notes.appearance.iconPlaceholder'),
      iconPickerTriggerLabel: t('customers.people.detail.notes.appearance.iconPicker'),
      iconSearchPlaceholder: t('customers.people.detail.notes.appearance.iconSearchPlaceholder'),
      iconSearchEmptyLabel: t('customers.people.detail.notes.appearance.iconSearchEmpty'),
      iconSuggestionsLabel: t('customers.people.detail.notes.appearance.iconSuggestions'),
      iconClearLabel: t('customers.people.detail.notes.appearance.iconClear'),
      previewEmptyLabel: t('customers.people.detail.notes.appearance.previewEmpty'),
    }),
    [t],
  )

  const composerAuthor = React.useMemo(
    () => viewerLabel ?? t('customers.people.detail.notes.you'),
    [t, viewerLabel],
  )
  const composerHasAppearance = Boolean(draftIcon) || Boolean(draftColor)
  const appearanceDialogOpen = appearanceDialogState !== null
  const editingAppearanceNoteId =
    appearanceDialogState?.mode === 'edit' ? appearanceDialogState.noteId : null
  const addNoteShortcutLabel = t('customers.people.detail.notes.addShortcut', 'Add note ⌘⏎ / Ctrl+Enter')
  const saveAppearanceShortcutLabel = t(
    'customers.people.detail.notes.appearance.saveShortcut',
    'Save appearance ⌘⏎ / Ctrl+Enter',
  )
  const composerSubmitLabel = addNoteShortcutLabel
  const appearanceDialogPrimaryLabel = saveAppearanceShortcutLabel
  const appearanceDialogSavingLabel =
    appearanceDialogState?.mode === 'edit'
      ? t('customers.people.detail.notes.appearance.saving')
      : t('customers.people.detail.notes.saving', 'Saving note…')

  return (
    <div className="mt-0 space-y-2">
      <div
        className={[
          'overflow-hidden rounded-xl transition-all duration-300 ease-out',
          composerOpen ? 'max-h-[1200px] bg-muted/10 p-4 opacity-100' : 'pointer-events-none max-h-0 p-0 opacity-0',
        ].join(' ')}
        aria-hidden={!composerOpen}
      >
        {composerOpen ? (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            onKeyDown={handleComposerKeyDown}
            className="space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t('customers.people.detail.notes.addLabel')}</h3>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setAppearanceDialogError(null)
                    setAppearanceDialogState({ mode: 'create', icon: draftIcon, color: draftColor })
                  }}
                  disabled={isSubmitting || isLoading || !hasEntity}
                >
                  <span className="sr-only">{t('customers.people.detail.notes.appearance.toggleOpen', 'Customize appearance')}</span>
                  <Palette className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={isMarkdownEnabled ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={handleMarkdownToggle}
                  aria-pressed={isMarkdownEnabled}
                  disabled={isSubmitting || isLoading}
                >
                  <FileCode className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setComposerOpen(false)
                    setDraftBody('')
                    setDraftIcon(null)
                    setDraftColor(null)
                  }}
                  disabled={isSubmitting || isLoading}
                >
                  {t('customers.people.detail.inline.cancel')}
                </Button>
              </div>
            </div>
            {(normalizedEntityOptions.length || normalizedDealOptions.length) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {normalizedEntityOptions.length ? (
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="note-entity-select"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t('customers.people.detail.notes.fields.entity', 'Assign to customer')}
                    </label>
                    <select
                      id="note-entity-select"
                      className="h-9 rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={selectedEntityId}
                      onChange={(event) => setSelectedEntityId(event.target.value)}
                      disabled={isSubmitting || isLoading || !normalizedEntityOptions.length}
                    >
                      {normalizedEntityOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {normalizedDealOptions.length ? (
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="note-deal-select"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t('customers.people.detail.notes.fields.deal', 'Link to deal (optional)')}
                    </label>
                    <select
                      id="note-deal-select"
                      className="h-9 rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={selectedDealId}
                      onChange={(event) => setSelectedDealId(event.target.value)}
                      disabled={isSubmitting || isLoading}
                    >
                      <option value="">
                        {t('customers.people.detail.notes.fields.dealPlaceholder', 'No linked deal')}
                      </option>
                      {normalizedDealOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
            {isMarkdownEnabled ? (
              <div className="w-full rounded-lg border border-muted-foreground/20 bg-background p-2">
                <div data-color-mode="light" className="w-full">
                  <UiMarkdownEditor
                    value={draftBody}
                    height={220}
                    onChange={(value) => setDraftBody(typeof value === 'string' ? value : '')}
                    previewOptions={{ remarkPlugins: [remarkGfm] }}
                  />
                </div>
              </div>
            ) : (
              <textarea
                id="new-note"
                ref={textareaRef}
                rows={1}
                className="w-full resize-none overflow-hidden rounded-lg border border-muted-foreground/20 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                placeholder={t('customers.people.detail.notes.placeholder')}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                onInput={(event) => adjustTextareaSize(event.currentTarget)}
                disabled={isSubmitting || isLoading || !hasEntity}
              />
            )}
            {composerHasAppearance ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-muted-foreground/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {draftIcon ? (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-muted/40">
                      {renderDictionaryIcon(draftIcon, 'h-4 w-4')}
                    </span>
                  ) : null}
                  <span className="font-semibold text-foreground">{composerAuthor}</span>
                  {draftColor ? (
                    <span className="flex items-center gap-2">
                      {renderDictionaryColor(draftColor, 'h-3.5 w-3.5 rounded-full border border-border')}
                      <span className="text-xs font-medium uppercase text-muted-foreground">{draftColor}</span>
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraftIcon(null)
                    setDraftColor(null)
                  }}
                  disabled={isSubmitting}
                >
                  {t('customers.people.detail.notes.appearance.clearAll', 'Clear')}
                </Button>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || isLoading || !hasEntity}
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {composerSubmitLabel}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {loadError ? <p className="mt-3 text-xs text-red-600">{loadError}</p> : null}

      <div className="space-y-3">
        {isLoading ? (
          <LoadingMessage
            label={t('customers.people.detail.notes.loading', 'Loading notes…')}
            className="border-0 bg-transparent p-0 py-8"
          />
        ) : hasVisibleNotes ? (
          visibleNotes.map((note) => {
            const author = noteAuthorLabel(note)
            const isAppearanceSaving = appearanceDialogSaving && editingAppearanceNoteId === note.id
            const isEditingContent = contentEditor.id === note.id
            const displayIcon = note.appearanceIcon ?? null
            const displayColor = note.appearanceColor ?? null
            const timestampValue = note.createdAt
            const fallbackTimestampLabel = formatDateTime(note.createdAt) ?? emptyLabel
            return (
              <div key={note.id} className="group space-y-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <TimelineItemHeader
                      title={author}
                      timestamp={timestampValue}
                      fallbackTimestampLabel={fallbackTimestampLabel}
                      icon={displayIcon}
                      color={displayColor}
                    />
                    {note.dealId ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ArrowUpRightSquare className="h-3.5 w-3.5" />
                        <Link
                          href={`/backend/customers/deals/${encodeURIComponent(note.dealId)}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {note.dealTitle && note.dealTitle.length
                            ? note.dealTitle
                            : t('customers.people.detail.notes.linkedDeal', 'Linked deal')}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={`flex items-center gap-2 transition-opacity ${
                      isEditingContent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                    }`}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setContentEditor({ id: note.id, value: note.body })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.stopPropagation()
                        setAppearanceDialogError(null)
                        setAppearanceDialogState({
                          mode: 'edit',
                          noteId: note.id,
                          icon: note.appearanceIcon ?? null,
                          color: note.appearanceColor ?? null,
                        })
                      }}
                      disabled={appearanceDialogSaving && editingAppearanceNoteId === note.id}
                    >
                      {isAppearanceSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleDeleteNote(note)
                      }}
                      disabled={deletingNoteId === note.id}
                    >
                      {deletingNoteId === note.id ? (
                        <span className="relative flex h-4 w-4 items-center justify-center text-destructive">
                          <span className="absolute h-4 w-4 animate-spin rounded-full border border-destructive border-t-transparent" />
                        </span>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {isEditingContent ? (
                  <div className="space-y-2" onKeyDown={handleContentEditorKeyDown}>
                    {isMarkdownEnabled ? (
                      <div className="w-full rounded-md border border-muted-foreground/20 bg-background p-2">
                        <div data-color-mode="light" className="w-full">
                          <UiMarkdownEditor
                            value={contentEditor.value}
                            height={220}
                            onChange={(value) =>
                              setContentEditor((prev) => ({ ...prev, value: typeof value === 'string' ? value : '' }))
                            }
                            previewOptions={{ remarkPlugins: [remarkGfm] }}
                          />
                        </div>
                      </div>
                    ) : (
                      <textarea
                        ref={contentTextareaRef}
                        value={contentEditor.value}
                        onChange={(event) => {
                          setContentEditor((prev) => ({ ...prev, value: event.target.value }))
                          adjustTextareaSize(event.currentTarget)
                        }}
                        rows={3}
                        className="w-full resize-none overflow-hidden rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    )}
                    {contentError ? <p className="text-xs text-red-600">{contentError}</p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" onClick={handleContentSave} disabled={contentSavingId === note.id}>
                        {contentSavingId === note.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('customers.people.detail.notes.saving')}
                          </>
                        ) : (
                          t('customers.people.detail.inline.saveShortcut')
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleMarkdownToggle}
                        aria-pressed={isMarkdownEnabled}
                        className={isMarkdownEnabled ? 'text-primary' : undefined}
                        disabled={contentSavingId === note.id}
                      >
                        <FileCode className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setContentEditor({ id: '', value: '' })}
                        disabled={contentSavingId === note.id}
                      >
                        {t('customers.people.detail.inline.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer text-sm"
                    onClick={() => setContentEditor({ id: note.id, value: note.body })}
                    onKeyDown={(event) => handleContentKeyDown(event, note)}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      className="break-words text-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
                    >
                      {note.body}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: focusComposer,
              disabled: isSubmitting || !hasEntity,
            }}
          />
        )}
        {isLoading || visibleCount >= notes.length ? null : (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={handleLoadMore}>
              {loadMoreLabel}
            </Button>
          </div>
        )}
      </div>
      <AppearanceDialog
        open={appearanceDialogOpen}
        title={
          appearanceDialogState?.mode === 'edit'
            ? t('customers.people.detail.notes.appearance.edit')
            : t('customers.people.detail.notes.appearance.toggleOpen', 'Customize appearance')
        }
        icon={appearanceDialogState?.icon ?? null}
        color={appearanceDialogState?.color ?? null}
        labels={noteAppearanceLabels}
        iconSuggestions={ICON_SUGGESTIONS}
        onIconChange={(value) => setAppearanceDialogState((prev) => (prev ? { ...prev, icon: value ?? null } : prev))}
        onColorChange={(value) => setAppearanceDialogState((prev) => (prev ? { ...prev, color: value ?? null } : prev))}
        onSubmit={() => {
          void handleAppearanceDialogSubmit()
        }}
        onClose={handleAppearanceDialogClose}
        isSaving={appearanceDialogSaving}
        errorMessage={appearanceDialogError}
        primaryLabel={appearanceDialogPrimaryLabel}
        savingLabel={appearanceDialogSavingLabel}
        cancelLabel={t('customers.people.detail.notes.appearance.cancel')}
      />
    </div>
  )
}
