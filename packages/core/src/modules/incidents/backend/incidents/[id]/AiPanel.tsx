"use client"

import * as React from 'react'
import { MessageSquare, Send, Sparkles } from 'lucide-react'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { extractIncidentAiFailure, resolveIncidentAiErrorMessage } from '../../../lib/aiErrors'
import { AiUnavailableNotice } from '../components/AiUnavailableNotice'
import { useIncidentAiAvailability } from '../components/useAiAvailability'

type SummaryResponse = {
  summary?: string
  keyEvents?: string[]
}

type TimelineMutationResponse = {
  entryId?: string | null
  incidentId?: string | null
  updatedAt?: string | null
}

type TimelineEntryResponse = {
  id?: string | null
  body?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: string | null
}

type TimelineListResponse = {
  items?: TimelineEntryResponse[]
}

type AiMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type AiPanelProps = {
  incidentId: string
  number: string
  title: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

const AI_SUMMARY_SOURCE = 'ai_summary'

function summaryNote(summary: SummaryResponse): string {
  return typeof summary.summary === 'string' ? summary.summary.trim() : ''
}

function summaryKeyEvents(summary: SummaryResponse): string[] {
  if (!Array.isArray(summary.keyEvents)) return []
  return summary.keyEvents.filter((event): event is string => typeof event === 'string' && event.trim().length > 0)
}

function timelineEntryToSummary(entry: TimelineEntryResponse): SummaryResponse | null {
  if (entry.metadata?.source !== AI_SUMMARY_SOURCE) return null
  const body = typeof entry.body === 'string' ? entry.body.trim() : ''
  if (!body) return null
  const rawEvents = entry.metadata.keyEvents
  const keyEvents = Array.isArray(rawEvents)
    ? rawEvents.filter((event): event is string => typeof event === 'string' && event.trim().length > 0)
    : []
  return { summary: body, keyEvents }
}

export function AiPanel({
  incidentId,
  number,
  title,
  updatedAt,
  canManage,
  onChanged,
}: AiPanelProps) {
  const t = useT()
  const { available, reason } = useIncidentAiAvailability()
  const [summary, setSummary] = React.useState<SummaryResponse | null>(null)
  const [summaryPersisted, setSummaryPersisted] = React.useState(false)
  const [loadingSummary, setLoadingSummary] = React.useState(false)
  const [posting, setPosting] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const contextId = React.useMemo(() => `incident-ai:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<AiMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<AiMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  React.useEffect(() => {
    let cancelled = false
    async function loadPersistedSummary() {
      const params = new URLSearchParams({
        kinds: 'note',
        visibility: 'internal',
        pageSize: '25',
      })
      try {
        const result = await apiCall<TimelineListResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/timeline?${params.toString()}`,
        )
        if (cancelled || !result.ok) return
        const restored = result.result?.items
          ?.map(timelineEntryToSummary)
          .find((item): item is SummaryResponse => item !== null)
        if (!restored) return
        setSummary((current) => current ?? restored)
        setSummaryPersisted(true)
      } catch {
        // Loading the cached summary is best-effort; summary generation still works.
      }
    }
    void loadPersistedSummary()
    return () => {
      cancelled = true
    }
  }, [incidentId])

  const persistSummary = React.useCallback(async (nextSummary: SummaryResponse): Promise<boolean> => {
    const body = summaryNote(nextSummary)
    if (!body || !canManage || posting) return false
    setPosting(true)
    const payload = {
      kind: 'note',
      body,
      visibility: 'internal',
      metadata: {
        source: AI_SUMMARY_SOURCE,
        keyEvents: summaryKeyEvents(nextSummary),
      },
    } satisfies {
      kind: 'note'
      body: string
      visibility: 'internal'
      metadata: { source: typeof AI_SUMMARY_SOURCE; keyEvents: string[] }
    }
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<TimelineMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/timeline`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.ai.summary.postError', 'Failed to post the AI summary.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      const freshUpdatedAt = call.result?.updatedAt
      if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) setCurrentUpdatedAt(freshUpdatedAt)
      setSummaryPersisted(true)
      flash(t('incidents.ai.summary.postSuccess', 'AI summary posted as an internal note.'), 'success')
      await onChanged()
      return true
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: () => void onChanged() })) {
        flash(t('incidents.ai.summary.postError', 'Failed to post the AI summary.'), 'error')
      }
      return false
    } finally {
      setPosting(false)
    }
  }, [canManage, currentUpdatedAt, incidentId, mutationContext, onChanged, posting, runMutation, t])

  const handleSummarize = React.useCallback(async () => {
    setLoadingSummary(true)
    try {
      const call = await apiCall<SummaryResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/ai/summary`,
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
          'incidents.ai.summary.error',
          'Failed to summarize this incident.',
        ), 'error')
        return
      }
      const nextSummary = call.result ?? null
      setSummary(nextSummary)
      setSummaryPersisted(false)
      if (nextSummary && canManage) {
        void persistSummary(nextSummary)
      }
    } catch {
      flash(t('incidents.ai.summary.error', 'Failed to summarize this incident.'), 'error')
    } finally {
      setLoadingSummary(false)
    }
  }, [canManage, incidentId, persistSummary, t])

  const handlePostSummary = React.useCallback(async () => {
    if (!summary) return
    await persistSummary(summary)
  }, [persistSummary, summary])

  if (available !== true) {
    if (available === false && reason) {
      return (
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <SectionHeader title={t('incidents.ai.panel.title', 'AI')} />
            <div className="sm:max-w-md">
              <AiUnavailableNotice reason={reason} />
            </div>
          </div>
        </section>
      )
    }
    return null
  }

  const note = summary ? summaryNote(summary) : ''

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader title={t('incidents.ai.panel.title', 'AI')} />
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSummarize()}
            disabled={loadingSummary}
            className="whitespace-nowrap"
          >
            {loadingSummary ? <Spinner size="sm" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {loadingSummary
              ? t('incidents.ai.summary.loading', 'Summarizing')
              : t('incidents.ai.summary.action', 'Summarize')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAssistantOpen(true)}
            className="whitespace-nowrap"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            {t('incidents.ai.assistant.open', 'Open assistant')}
          </Button>
        </div>
      </div>
      {summary ? (
        <div className="mt-4 space-y-3 rounded-md border border-border bg-background p-3">
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{note}</p>
          {Array.isArray(summary.keyEvents) && summary.keyEvents.length > 0 ? (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {summary.keyEvents.map((event, index) => (
                <li key={`${event}:${index}`} className="flex gap-2">
                  <span aria-hidden="true">-</span>
                  <span className="min-w-0 flex-1">{event}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {canManage && !summaryPersisted ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handlePostSummary()}
                disabled={posting || !note}
                className="whitespace-nowrap"
              >
                <Send className="size-4" aria-hidden="true" />
                {posting
                  ? t('incidents.ai.summary.posting', 'Posting')
                  : t('incidents.ai.summary.postInternal', 'Post as internal note')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('incidents.ai.panel.description', 'Generate a living summary or open the incident assistant.')}
        </p>
      )}
      <Dialog open={assistantOpen} onOpenChange={setAssistantOpen}>
        <DialogContent
          className={cn(
            'top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-screen h-svh max-h-svh rounded-none',
            'sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:max-w-xl sm:w-[36rem] sm:rounded-l-xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4',
          )}
        >
          <DialogHeader>
            <DialogTitle>{t('incidents.ai.assistant.title', 'Incident assistant')}</DialogTitle>
            <DialogDescription>
              {t('incidents.ai.assistant.description', 'Ask about the current incident, timeline, impacts, and next steps.')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <AiChat
              agent="incidents.assistant"
              pageContext={{
                view: 'incidents.detail',
                recordType: 'incidents.incident',
                recordId: incidentId,
                extra: { number, title },
              }}
              className="h-full"
              placeholder={t('incidents.ai.assistant.placeholder', 'Ask about this incident...')}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
