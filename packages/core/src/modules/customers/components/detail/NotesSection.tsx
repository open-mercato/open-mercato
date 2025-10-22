"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileCode, Loader2, Palette, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { formatDateTime, formatRelativeTime } from './utils'
import type { CommentSummary, Translator, SectionAction, TabEmptyState } from './types'
import { ICON_SUGGESTIONS } from '../../lib/dictionaries'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useT } from '@/lib/i18n/context'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../lib/markdownPreference'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { LoadingMessage } from './LoadingMessage'

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

const UiMarkdownEditor = dynamic<UiMarkdownEditorProps>(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <MarkdownEditorFallback />,
})

export type NotesSectionProps = {
  entityId: string | null
  emptyLabel: string
  viewerUserId: string | null
  viewerName?: string | null
  viewerEmail?: string | null
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
}

function sanitizeHexColor(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^#([0-9a-f]{6})$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

function mapComment(input: any): CommentSummary {
  const id = typeof input?.id === 'string' ? input.id : generateTempId()
  const body = typeof input?.body === 'string' ? input.body : ''
  const createdAt =
    typeof input?.createdAt === 'string'
      ? input.createdAt
      : typeof input?.created_at === 'string'
        ? input.created_at
        : new Date().toISOString()
  const authorUserId =
    typeof input?.authorUserId === 'string'
      ? input.authorUserId
      : typeof input?.author_user_id === 'string'
        ? input.author_user_id
        : null
  const authorName =
    typeof input?.authorName === 'string'
      ? input.authorName
      : typeof input?.author_name === 'string'
        ? input.author_name
        : null
  const authorEmail =
    typeof input?.authorEmail === 'string'
      ? input.authorEmail
      : typeof input?.author_email === 'string'
        ? input.author_email
        : null
  const dealId =
    typeof input?.dealId === 'string'
      ? input.dealId
      : typeof input?.deal_id === 'string'
        ? input.deal_id
        : null
  const appearanceIcon =
    typeof input?.appearanceIcon === 'string'
      ? input.appearanceIcon
      : typeof input?.appearance_icon === 'string'
        ? input.appearance_icon
        : null
  const appearanceColor =
    typeof input?.appearanceColor === 'string'
      ? input.appearanceColor
      : typeof input?.appearance_color === 'string'
        ? input.appearance_color
        : null
  return {
    id,
    body,
    createdAt,
    authorUserId,
    authorName,
    authorEmail,
    dealId,
    appearanceIcon,
    appearanceColor,
  }
}

export function NotesSection({
  entityId,
  emptyLabel,
  viewerUserId,
  viewerName,
  viewerEmail,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
  onLoadingChange,
}: NotesSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(
    () => (key, fallback) => {
      const value = tHook(key)
      return value === key && fallback ? fallback : value
    },
    [tHook]
  )
  const t = translator ?? fallbackTranslator

  const [notes, setNotes] = React.useState<CommentSummary[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
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

  const hasEntity = typeof entityId === 'string' && entityId.length > 0

  const [draftBody, setDraftBody] = React.useState('')
  const [draftIcon, setDraftIcon] = React.useState<string | null>(null)
  const [draftColor, setDraftColor] = React.useState<string | null>(null)
  const [showAppearance, setShowAppearance] = React.useState(false)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const focusComposer = React.useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    element.focus()
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])
  const [appearanceEditor, setAppearanceEditor] = React.useState<{ id: string; icon: string | null; color: string | null } | null>(null)
  const [appearanceSavingId, setAppearanceSavingId] = React.useState<string | null>(null)
  const [appearanceError, setAppearanceError] = React.useState<string | null>(null)
  const [contentEditor, setContentEditor] = React.useState<{ id: string; value: string }>({ id: '', value: '' })
  const [contentSavingId, setContentSavingId] = React.useState<string | null>(null)
  const [contentError, setContentError] = React.useState<string | null>(null)
  const contentTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [visibleCount, setVisibleCount] = React.useState(0)

  React.useEffect(() => {
    if (!hasEntity) {
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
        const res = await apiFetch(`/api/customers/comments?entityId=${encodeURIComponent(entityId!)}`)
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.notes.loadError', 'Failed to load notes.')
          throw new Error(message)
        }
        const payload = await res.json().catch(() => ({}))
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
  }, [entityId, hasEntity, popLoading, pushLoading, t])

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
  }, [adjustTextareaSize, draftBody, isMarkdownEnabled])

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

  const visibleNotes = React.useMemo(() => notes.slice(0, visibleCount), [notes, visibleCount])
  const hasVisibleNotes = React.useMemo(() => visibleCount > 0 && notes.length > 0, [visibleCount, notes.length])

  const loadMoreLabel = t('customers.people.detail.notes.loadMore')

  const handleCreateNote = React.useCallback(
    async (input: { body: string; appearanceIcon: string | null; appearanceColor: string | null }) => {
      if (!hasEntity || !entityId) {
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
      setIsSubmitting(true)
      pushLoading()
      try {
        const res = await apiFetch('/api/customers/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId,
            body,
            appearanceIcon: icon ?? undefined,
            appearanceColor: color ?? undefined,
          }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.error')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        const responseBody = await res.json().catch(() => ({}))
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
            dealId: null,
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
    [entityId, hasEntity, popLoading, pushLoading, viewerEmail, viewerName, viewerUserId, t, focusComposer],
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
        const res = await apiFetch('/api/customers/comments', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.updateError')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
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
        setShowAppearance(false)
      }
    },
    [draftBody, draftColor, draftIcon, handleCreateNote],
  )

  const markdownPreview = React.useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} className="break-words [&>*]:mb-2 [&>*:last-child]:mb-0">
        {draftBody || ''}
      </ReactMarkdown>
    ),
    [draftBody],
  )

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= notes.length) return prev
      return Math.min(prev + 5, notes.length)
    })
  }, [notes.length])

  const handleAppearanceSave = React.useCallback(async () => {
    if (!appearanceEditor) return
    setAppearanceSavingId(appearanceEditor.id)
    setAppearanceError(null)
    try {
      await handleUpdateNote(appearanceEditor.id, {
        appearanceIcon: appearanceEditor.icon,
        appearanceColor: appearanceEditor.color,
      })
      setAppearanceEditor(null)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.people.detail.notes.appearance.error', 'Failed to update appearance.')
      setAppearanceError(message)
    } finally {
      setAppearanceSavingId(null)
    }
  }, [appearanceEditor, handleUpdateNote, t])

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

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl bg-muted/10 py-4">
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-2 px-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t('customers.people.detail.notes.addLabel')}</h3>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={showAppearance ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setShowAppearance((prev) => !prev)}
                aria-pressed={showAppearance}
                disabled={isSubmitting || isLoading || !hasEntity}
              >
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
            </div>
          </div>
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
          {showAppearance ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2 py-1">
                {draftIcon ? renderDictionaryIcon(draftIcon, 'h-4 w-4') : null}
                {draftColor ? renderDictionaryColor(draftColor, 'h-3 w-3 rounded-full border border-border') : null}
                {!draftColor && !draftIcon ? (
                  <span>{t('customers.people.detail.notes.appearance.previewEmpty')}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setDraftColor(null)}
                  disabled={!draftColor || isSubmitting}
                >
                  {t('customers.people.detail.notes.appearance.clearColor')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setDraftIcon(null)}
                  disabled={!draftIcon || isSubmitting}
                >
                  {t('customers.people.detail.notes.appearance.iconClear')}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {showAppearance ? (
                <AppearanceSelector
                  icon={draftIcon}
                  color={draftColor}
                  onIconChange={(next) => setDraftIcon(next ?? null)}
                  onColorChange={(next) => setDraftColor(next)}
                  labels={noteAppearanceLabels}
                  iconSuggestions={ICON_SUGGESTIONS}
                  disabled={isSubmitting || isLoading || !hasEntity}
                />
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={isSubmitting || isLoading || !hasEntity}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('customers.people.detail.notes.submit')}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {loadError ? <p className="px-4 text-xs text-red-600">{loadError}</p> : null}

      {hasVisibleNotes ? (
        <div className="space-y-3">
          {visibleNotes.map((note) => {
            const author = noteAuthorLabel(note)
            const isAppearanceSaving = appearanceSavingId === note.id
            const isEditingAppearance = appearanceEditor?.id === note.id
            const isEditingContent = contentEditor.id === note.id
            return (
              <div key={note.id} className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{author}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(note.createdAt) ?? formatDateTime(note.createdAt) ?? emptyLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
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
                      onClick={() =>
                        setAppearanceEditor({ id: note.id, icon: note.appearanceIcon ?? null, color: note.appearanceColor ?? null })
                      }
                    >
                      <Palette className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => flash(t('customers.people.detail.notes.deleteNotImplemented', 'Delete via audit log'), 'info')}
                      disabled
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {isEditingContent ? (
                  <div className="space-y-2">
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
                          t('customers.people.detail.inline.save')
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
                {isEditingAppearance ? (
                  <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/30 p-3">
                    <AppearanceSelector
                      icon={appearanceEditor?.icon ?? null}
                      color={appearanceEditor?.color ?? null}
                      onIconChange={(value) => setAppearanceEditor((prev) => (prev ? { ...prev, icon: value ?? null } : prev))}
                      onColorChange={(value) => setAppearanceEditor((prev) => (prev ? { ...prev, color: value ?? null } : prev))}
                      labels={noteAppearanceLabels}
                      disabled={isAppearanceSaving}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleAppearanceSave()}
                        disabled={isAppearanceSaving}
                      >
                        {isAppearanceSaving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('customers.people.detail.notes.appearance.saving')}
                          </>
                        ) : (
                          t('customers.people.detail.notes.appearance.save')
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setAppearanceEditor((prev) => (prev ? { ...prev, icon: null, color: null } : prev))}
                        disabled={isAppearanceSaving}
                      >
                        {t('customers.people.detail.notes.appearance.reset')}
                      </Button>
                    </div>
                    {appearanceError ? <p className="text-xs text-red-600">{appearanceError}</p> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {visibleCount < notes.length ? (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={handleLoadMore}>
                {loadMoreLabel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : isLoading ? (
        <LoadingMessage
          label={t('customers.people.detail.notes.loading', 'Loading notes…')}
          className="min-h-[160px]"
        />
      ) : (
        <div className="rounded-xl bg-background p-6">
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: focusComposer,
              disabled: isSubmitting || !hasEntity,
            }}
          />
        </div>
      )}
    </div>
  )
}
