"use client"

import * as React from 'react'
import { CheckCircle2, FileText, Plus, Save, Send, Sparkles } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractIncidentAiFailure, resolveIncidentAiErrorMessage } from '../../../lib/aiErrors'
import { AiUnavailableNotice } from '../components/AiUnavailableNotice'
import { useIncidentAiAvailability } from '../components/useAiAvailability'

type PostmortemStatus = 'draft' | 'published'
type PostmortemField = 'summary' | 'rootCause' | 'impact' | 'contributingFactors' | 'lessons'

type PostmortemItem = {
  id: string
  incidentId: string
  summary: string | null
  rootCause: string | null
  impact: string | null
  contributingFactors: string | null
  lessons: string | null
  status: PostmortemStatus | string
  publishedAt: string | null
  updatedAt: string
}

type PostmortemResponse = {
  item?: PostmortemItem | null
  error?: string
}

type PostmortemMutationResponse = {
  ok?: boolean
  postmortemId?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
}

type ActionItemMutationResponse = {
  ok?: boolean
  actionItemId?: string | null
  updatedAt?: string | null
}

type PostmortemDraftActionItem = {
  title?: string | null
  description?: string | null
}

type PostmortemDraftResponse = Partial<Record<PostmortemField, string | null>> & {
  actionItems?: PostmortemDraftActionItem[]
}

type PostmortemMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type PostmortemPanelProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

type PostmortemFormState = Record<PostmortemField, string>

type SuggestedActionItem = {
  id: string
  title: string
  description: string
  selected: boolean
  added: boolean
}

const postmortemFields: Array<{ key: PostmortemField; labelKey: string; fallback: string }> = [
  { key: 'summary', labelKey: 'incidents.postmortem.fields.summary', fallback: 'Summary' },
  { key: 'rootCause', labelKey: 'incidents.postmortem.fields.rootCause', fallback: 'Root cause' },
  { key: 'impact', labelKey: 'incidents.postmortem.fields.impact', fallback: 'Impact' },
  { key: 'contributingFactors', labelKey: 'incidents.postmortem.fields.contributingFactors', fallback: 'Contributing factors' },
  { key: 'lessons', labelKey: 'incidents.postmortem.fields.lessons', fallback: 'Lessons learned' },
]

const emptyForm: PostmortemFormState = {
  summary: '',
  rootCause: '',
  impact: '',
  contributingFactors: '',
  lessons: '',
}

function itemToForm(item: PostmortemItem | null): PostmortemFormState {
  if (!item) return emptyForm
  return {
    summary: item.summary ?? '',
    rootCause: item.rootCause ?? '',
    impact: item.impact ?? '',
    contributingFactors: item.contributingFactors ?? '',
    lessons: item.lessons ?? '',
  }
}

function draftToForm(draft: PostmortemDraftResponse): PostmortemFormState {
  return {
    summary: draft.summary?.trim() ?? '',
    rootCause: draft.rootCause?.trim() ?? '',
    impact: draft.impact?.trim() ?? '',
    contributingFactors: draft.contributingFactors?.trim() ?? '',
    lessons: draft.lessons?.trim() ?? '',
  }
}

function draftToItem(incidentId: string, draft: PostmortemDraftResponse, updatedAt: string | null): PostmortemItem {
  const form = draftToForm(draft)
  return {
    id: 'draft',
    incidentId,
    summary: form.summary,
    rootCause: form.rootCause,
    impact: form.impact,
    contributingFactors: form.contributingFactors,
    lessons: form.lessons,
    status: 'draft',
    publishedAt: null,
    updatedAt: updatedAt ?? '',
  }
}

function draftActionItemsToSuggestions(items: readonly PostmortemDraftActionItem[] | null | undefined): SuggestedActionItem[] {
  return (items ?? [])
    .map((item, index) => {
      const title = item.title?.trim() ?? ''
      if (!title) return null
      return {
        id: `suggested-action-${index}`,
        title,
        description: item.description?.trim() ?? '',
        selected: true,
        added: false,
      }
    })
    .filter((item): item is SuggestedActionItem => item !== null)
}

function formatDate(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  return date.toLocaleString()
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function errorMessage(result: PostmortemResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

export function PostmortemPanel({ incidentId, updatedAt, canManage, onChanged }: PostmortemPanelProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [item, setItem] = React.useState<PostmortemItem | null>(null)
  const [form, setForm] = React.useState<PostmortemFormState>(emptyForm)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [pendingAction, setPendingAction] = React.useState<'save' | 'publish' | 'start' | 'draft' | null>(null)
  const { available: aiAvailable, reason: aiUnavailableReason } = useIncidentAiAvailability()
  const [suggestions, setSuggestions] = React.useState<SuggestedActionItem[]>([])
  const [pendingSuggestionId, setPendingSuggestionId] = React.useState<string | null>(null)
  const contextId = React.useMemo(() => `incident-postmortem:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<PostmortemMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<PostmortemMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const loadItem = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const result = await apiCall<PostmortemResponse>(
      `/api/incidents/${encodeURIComponent(incidentId)}/postmortem`,
    )
    if (!result.ok) {
      throw new Error(errorMessage(result.result, t('incidents.postmortem.error.load', 'Failed to load the postmortem.')))
    }
    const nextItem = result.result?.item ?? null
    setItem(nextItem)
    setForm(itemToForm(nextItem))
    setSuggestions([])
    setIsLoading(false)
  }, [incidentId, t])

  React.useEffect(() => {
    let active = true
    loadItem().catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.postmortem.error.load', 'Failed to load the postmortem.'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadItem, t])

  useAppEvent('incidents.postmortem.*', (event) => {
    const eventIncidentId = readPayloadString(event.payload, 'incidentId')
    if (!eventIncidentId || eventIncidentId === incidentId) void loadItem()
  }, [incidentId, loadItem])

  useAppEvent('incidents.timeline_entry.added', (event) => {
    const eventIncidentId = readPayloadString(event.payload, 'incidentId')
    const kind = readPayloadString(event.payload, 'kind')
    if ((!eventIncidentId || eventIncidentId === incidentId) && kind?.startsWith('postmortem')) {
      void loadItem()
    }
  }, [incidentId, loadItem])

  const refreshAfterConflict = React.useCallback(() => {
    void loadItem()
    void onChanged()
  }, [loadItem, onChanged])

  const handleMutationSuccess = React.useCallback(async (
    response: PostmortemMutationResponse | null | undefined,
    message: string,
  ) => {
    const freshUpdatedAt = response?.updatedAt
    if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
      setCurrentUpdatedAt(freshUpdatedAt)
    }
    flash(message, 'success')
    await loadItem()
    await onChanged()
  }, [loadItem, onChanged])

  const handleMutationError = React.useCallback((err: unknown, fallback: string) => {
    if (!surfaceRecordConflict(err, t, { onRefresh: refreshAfterConflict })) {
      flash(fallback, 'error')
    }
  }, [refreshAfterConflict, t])

  const handleDraftFromTimeline = React.useCallback(async () => {
    if (!canManage || pendingAction || !aiAvailable) return
    setPendingAction('draft')
    try {
      const call = await apiCall<PostmortemDraftResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/ai/postmortem-draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      if (!call.ok) {
        flash(resolveIncidentAiErrorMessage(
          extractIncidentAiFailure(call.status, call.result),
          t,
          'incidents.ai.postmortem.error',
          'Failed to draft the postmortem.',
        ), 'error')
        return
      }
      const draft = call.result ?? {}
      const nextForm = draftToForm(draft)
      setForm(nextForm)
      setItem((prev) => prev ?? draftToItem(incidentId, draft, currentUpdatedAt))
      setSuggestions(draftActionItemsToSuggestions(draft.actionItems))
      flash(t('incidents.ai.postmortem.success', 'Postmortem draft ready for review.'), 'success')
    } catch {
      flash(t('incidents.ai.postmortem.error', 'Failed to draft the postmortem.'), 'error')
    } finally {
      setPendingAction(null)
    }
  }, [aiAvailable, canManage, currentUpdatedAt, incidentId, pendingAction, t])

  const createSuggestedActionItem = React.useCallback(async (
    suggestion: SuggestedActionItem,
    expectedUpdatedAt: string | null,
  ): Promise<string | null> => {
    const payload: { title: string; description?: string } = { title: suggestion.title }
    if (suggestion.description) payload.description = suggestion.description
    const call = await runMutation({
      operation: async () => apiCallOrThrow<ActionItemMutationResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/action-items`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildOptimisticLockHeader(expectedUpdatedAt),
          },
          body: JSON.stringify(payload),
        },
        { errorMessage: t('incidents.ai.postmortem.actionItems.error', 'Failed to add the suggested action item.') },
      ),
      context: mutationContext,
      mutationPayload: { incidentId, ...payload },
    })
    const freshUpdatedAt = call.result?.updatedAt
    return typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0 ? freshUpdatedAt : expectedUpdatedAt
  }, [incidentId, mutationContext, runMutation, t])

  const handleSuggestionToggle = React.useCallback((id: string, checked: boolean) => {
    setSuggestions((prev) => prev.map((suggestion) => (
      suggestion.id === id && !suggestion.added ? { ...suggestion, selected: checked } : suggestion
    )))
  }, [])

  const handleAddSuggestion = React.useCallback(async (suggestion: SuggestedActionItem) => {
    if (!canManage || pendingSuggestionId || suggestion.added) return
    setPendingSuggestionId(suggestion.id)
    try {
      const nextUpdatedAt = await createSuggestedActionItem(suggestion, currentUpdatedAt)
      setCurrentUpdatedAt(nextUpdatedAt)
      setSuggestions((prev) => prev.map((item) => (
        item.id === suggestion.id ? { ...item, added: true, selected: false } : item
      )))
      flash(t('incidents.ai.postmortem.actionItems.added', 'Suggested action item added.'), 'success')
      await onChanged()
    } catch (err) {
      handleMutationError(err, t('incidents.ai.postmortem.actionItems.error', 'Failed to add the suggested action item.'))
    } finally {
      setPendingSuggestionId(null)
    }
  }, [
    canManage,
    createSuggestedActionItem,
    currentUpdatedAt,
    handleMutationError,
    onChanged,
    pendingSuggestionId,
    t,
  ])

  const handleAddSuggestions = React.useCallback(async (selectedOnly: boolean) => {
    if (!canManage || pendingSuggestionId) return
    const pendingSuggestions = suggestions.filter((suggestion) => (
      !suggestion.added && (!selectedOnly || suggestion.selected)
    ))
    if (!pendingSuggestions.length) return
    setPendingSuggestionId(selectedOnly ? 'selected' : 'all')
    let lockValue = currentUpdatedAt
    try {
      for (const suggestion of pendingSuggestions) {
        lockValue = await createSuggestedActionItem(suggestion, lockValue)
        setCurrentUpdatedAt(lockValue)
        setSuggestions((prev) => prev.map((item) => (
          item.id === suggestion.id ? { ...item, added: true, selected: false } : item
        )))
      }
      flash(t('incidents.ai.postmortem.actionItems.addedAll', 'Suggested action items added.'), 'success')
      await onChanged()
    } catch (err) {
      handleMutationError(err, t('incidents.ai.postmortem.actionItems.error', 'Failed to add the suggested action item.'))
    } finally {
      setPendingSuggestionId(null)
    }
  }, [
    canManage,
    createSuggestedActionItem,
    currentUpdatedAt,
    handleMutationError,
    onChanged,
    pendingSuggestionId,
    suggestions,
    t,
  ])

  const saveDraft = React.useCallback(async (payload: Partial<PostmortemFormState>, action: 'save' | 'start') => {
    if (!canManage || pendingAction) return
    setPendingAction(action)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<PostmortemMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/postmortem`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.postmortem.error.save', 'Failed to save the postmortem.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      await handleMutationSuccess(
        call.result,
        action === 'start'
          ? t('incidents.postmortem.success.start', 'Postmortem draft started.')
          : t('incidents.postmortem.success.save', 'Postmortem saved.'),
      )
    } catch (err) {
      handleMutationError(err, t('incidents.postmortem.error.save', 'Failed to save the postmortem.'))
    } finally {
      setPendingAction(null)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  const handlePublish = React.useCallback(async () => {
    if (!canManage || pendingAction) return
    const approved = await confirm({
      title: t('incidents.postmortem.publish.title', 'Publish postmortem?'),
      description: t('incidents.postmortem.publish.description', 'Published postmortems become read-only.'),
      confirmText: t('incidents.postmortem.publish.confirm', 'Publish'),
      cancelText: t('incidents.common.cancel'),
    })
    if (!approved) return

    setPendingAction('publish')
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<PostmortemMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/postmortem/publish`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.postmortem.error.publish', 'Failed to publish the postmortem.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, action: 'publishPostmortem' },
      })
      await handleMutationSuccess(call.result, t('incidents.postmortem.success.publish', 'Postmortem published.'))
    } catch (err) {
      handleMutationError(err, t('incidents.postmortem.error.publish', 'Failed to publish the postmortem.'))
    } finally {
      setPendingAction(null)
    }
  }, [
    canManage,
    confirm,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
        <div className="mt-4 flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('incidents.postmortem.loading', 'Loading postmortem')}</span>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
        <div className="mt-4">
          <ErrorMessage label={error} />
        </div>
      </section>
    )
  }

  if (!item) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
          {canManage && aiAvailable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDraftFromTimeline()}
              disabled={pendingAction !== null}
              className="whitespace-nowrap"
            >
              {pendingAction === 'draft' ? <Spinner size="sm" /> : <Sparkles className="size-4" aria-hidden="true" />}
              {pendingAction === 'draft'
                ? t('incidents.ai.postmortem.drafting', 'Drafting')
                : t('incidents.ai.postmortem.action', 'Draft from timeline')}
            </Button>
          ) : canManage && aiAvailable === false && aiUnavailableReason ? (
            <div className="sm:max-w-md">
              <AiUnavailableNotice reason={aiUnavailableReason} />
            </div>
          ) : null}
        </div>
        <div className="mt-4">
          <EmptyState
            variant="subtle"
            icon={<FileText className="size-6" aria-hidden="true" />}
            title={t('incidents.postmortem.empty.title', 'No postmortem yet')}
            description={t('incidents.postmortem.empty.description', 'Resolving an incident with required fields creates a draft postmortem.')}
            actions={canManage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveDraft({}, 'start')}
                disabled={pendingAction !== null}
                className="whitespace-nowrap"
              >
                <FileText className="size-4" aria-hidden="true" />
                {t('incidents.postmortem.actions.startDraft', 'Start draft')}
              </Button>
            ) : undefined}
          />
        </div>
        {ConfirmDialogElement}
      </section>
    )
  }

  const isPublished = item.status === 'published'
  const selectedSuggestionCount = suggestions.filter((suggestion) => suggestion.selected && !suggestion.added).length
  const remainingSuggestionCount = suggestions.filter((suggestion) => !suggestion.added).length

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {canManage && !isPublished && aiAvailable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDraftFromTimeline()}
              disabled={pendingAction !== null}
              className="whitespace-nowrap"
            >
              {pendingAction === 'draft' ? <Spinner size="sm" /> : <Sparkles className="size-4" aria-hidden="true" />}
              {pendingAction === 'draft'
                ? t('incidents.ai.postmortem.drafting', 'Drafting')
                : t('incidents.ai.postmortem.action', 'Draft from timeline')}
            </Button>
          ) : canManage && !isPublished && aiAvailable === false && aiUnavailableReason ? (
            <div className="w-full sm:w-auto sm:max-w-md">
              <AiUnavailableNotice reason={aiUnavailableReason} />
            </div>
          ) : null}
          {isPublished ? (
            <StatusBadge variant="success" dot>
              {t('incidents.postmortem.publishedBadge', 'Published {date}', {
                date: formatDate(item.publishedAt, t),
              })}
            </StatusBadge>
          ) : (
            <StatusBadge variant="neutral" dot>
              {t('incidents.postmortem.status.draft', 'Draft')}
            </StatusBadge>
          )}
        </div>
      </div>

      {isPublished ? (
        <dl className="mt-4 space-y-4">
          {postmortemFields.map((field) => {
            const value = item[field.key]?.trim()
            return (
              <div key={field.key}>
                <dt className="text-sm font-medium text-foreground">{t(field.labelKey, field.fallback)}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {value || t('incidents.common.notSet')}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <div className="mt-4 space-y-4">
          {postmortemFields.map((field) => {
            const fieldId = `incident-postmortem-${field.key}`
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={fieldId}>{t(field.labelKey, field.fallback)}</Label>
                <Textarea
                  id={fieldId}
                  value={form[field.key]}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setForm((prev) => ({ ...prev, [field.key]: value }))
                  }}
                  disabled={!canManage || pendingAction !== null}
                  rows={4}
                />
              </div>
            )
          })}
          {canManage && suggestions.length > 0 ? (
            <div className="space-y-3 rounded-md border border-border bg-background p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t('incidents.ai.postmortem.actionItems.title', 'Suggested action items')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('incidents.ai.postmortem.actionItems.description', 'Review suggestions before adding them to the incident.')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddSuggestions(true)}
                    disabled={pendingSuggestionId !== null || selectedSuggestionCount === 0}
                    className="whitespace-nowrap"
                  >
                    {pendingSuggestionId === 'selected' ? <Spinner size="sm" /> : <Plus className="size-4" aria-hidden="true" />}
                    {t('incidents.ai.postmortem.actionItems.addSelected', 'Add selected')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddSuggestions(false)}
                    disabled={pendingSuggestionId !== null || remainingSuggestionCount === 0}
                    className="whitespace-nowrap"
                  >
                    {pendingSuggestionId === 'all' ? <Spinner size="sm" /> : <Plus className="size-4" aria-hidden="true" />}
                    {t('incidents.ai.postmortem.actionItems.addAll', 'Add all')}
                  </Button>
                </div>
              </div>
              <ul className="space-y-2">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.id} className="rounded-md border border-border bg-card p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <Checkbox
                          checked={suggestion.selected}
                          onCheckedChange={(checked) => handleSuggestionToggle(suggestion.id, checked === true)}
                          disabled={suggestion.added || pendingSuggestionId !== null}
                          aria-label={t('incidents.ai.postmortem.actionItems.select', 'Select suggested action item')}
                          className="mt-1"
                        />
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium text-foreground" title={suggestion.title}>
                            {suggestion.title}
                          </p>
                          {suggestion.description ? (
                            <p className="line-clamp-2 text-xs text-muted-foreground" title={suggestion.description}>
                              {suggestion.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {suggestion.added ? (
                        <StatusBadge variant="success" dot>
                          {t('incidents.ai.postmortem.actionItems.addedBadge', 'Added')}
                        </StatusBadge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleAddSuggestion(suggestion)}
                          disabled={pendingSuggestionId !== null}
                          className="whitespace-nowrap"
                        >
                          {pendingSuggestionId === suggestion.id
                            ? <Spinner size="sm" />
                            : <CheckCircle2 className="size-4" aria-hidden="true" />}
                          {t('incidents.ai.postmortem.actionItems.addOne', 'Add')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveDraft(form, 'save')}
                disabled={pendingAction !== null}
                className="whitespace-nowrap"
              >
                <Save className="size-4" aria-hidden="true" />
                {t('incidents.postmortem.actions.save', 'Save')}
              </Button>
              <Button
                type="button"
                onClick={() => void handlePublish()}
                disabled={pendingAction !== null}
                className="whitespace-nowrap"
              >
                <Send className="size-4" aria-hidden="true" />
                {t('incidents.postmortem.actions.publish', 'Publish')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {ConfirmDialogElement}
    </section>
  )
}
