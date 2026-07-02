"use client"

import * as React from 'react'
import { FileText, Save, Send } from 'lucide-react'
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
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
  const [pendingAction, setPendingAction] = React.useState<'save' | 'publish' | 'start' | null>(null)
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
        <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
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

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title={t('incidents.postmortem.title', 'Postmortem')} />
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
          {canManage ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveDraft(form, 'save')}
                disabled={pendingAction !== null}
              >
                <Save className="size-4" aria-hidden="true" />
                {t('incidents.postmortem.actions.save', 'Save')}
              </Button>
              <Button
                type="button"
                onClick={() => void handlePublish()}
                disabled={pendingAction !== null}
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
