"use client"

import * as React from 'react'
import { ChevronDown, Eye, ShieldAlert } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { useAiShortcuts } from '../useAiShortcuts'
import type { AiUiPartProps } from '../ui-part-registry'
import { confirmPendingAction, cancelPendingAction } from './pending-action-api'
import { useAiPendingActionPolling } from './useAiPendingActionPolling'
import { FieldDiffCard } from './FieldDiffCard'
import { ConfirmationCard } from './ConfirmationCard'
import { MutationResultCard } from './MutationResultCard'
import type { AiPendingActionCardAction } from './types'

/**
 * Mutation-approval preview card. Rendered by the server-emitted
 * `mutation-preview-card` UI part (spec §9.2).
 *
 * Responsibilities:
 * - Fetch the current pending-action row via the shared polling hook so the
 *   card recovers state on page reload (reconnect behavior).
 * - Render the top-level `fieldDiff` OR a per-record `records[]` summary
 *   with a drill-in link.
 * - Provide `Confirm` / `Cancel` / `Review Details` actions with shared
 *   keyboard shortcuts (`Cmd/Ctrl+Enter` → confirm, `Escape` → cancel).
 * - Flip to the {@link ConfirmationCard} once the user confirms, and
 *   further to the {@link MutationResultCard} once the row becomes
 *   terminal.
 */
export interface MutationPreviewCardPayload {
  /** Optional server-serialized pending action snapshot for the initial render. */
  pendingAction?: AiPendingActionCardAction
}

export interface MutationPreviewCardProps extends AiUiPartProps {
  /** Optional injected action for tests — bypasses the polling fetch. */
  initialAction?: AiPendingActionCardAction
  /** Endpoint base override for tests. */
  endpoint?: string
}

function summarizeBatch(
  records: NonNullable<AiPendingActionCardAction['records']>,
): { count: number; labels: string[] } {
  const labels = records.slice(0, 3).map((record) => record.label)
  return { count: records.length, labels }
}

export function MutationPreviewCard(props: MutationPreviewCardProps) {
  const t = useT()
  const pendingActionId = props.pendingActionId ?? ''
  const payload = (props.payload as MutationPreviewCardPayload | undefined) ?? {}
  const injected = props.initialAction ?? payload.pendingAction ?? null

  const { action: polled, refresh } = useAiPendingActionPolling({
    pendingActionId,
    endpoint: props.endpoint,
    disabled: !pendingActionId,
  })
  const action = polled ?? injected

  const [expanded, setExpanded] = React.useState(false)
  const [phase, setPhase] = React.useState<'preview' | 'confirming'>('preview')
  const [confirmError, setConfirmError] = React.useState<{
    status: number
    code?: string
    message: string
    extra?: Record<string, unknown>
  } | null>(null)

  const handleConfirm = React.useCallback(async () => {
    if (!pendingActionId) return
    if (phase !== 'preview') return
    setPhase('confirming')
    setConfirmError(null)
    const result = await confirmPendingAction(pendingActionId, {
      endpoint: props.endpoint,
    })
    if (!result.ok) {
      // Network / timeout / 4xx / 5xx — surface the envelope and rewind the
      // card to the preview phase so the operator can read the error,
      // edit the proposal upstream, or retry.
      setConfirmError(result.error)
      setPhase('preview')
      await refresh()
      return
    }
    // HTTP 200 path. The dispatcher returns `ok: false` AND a populated
    // `mutationResult.error` when the wrapped tool handler failed inside
    // the confirm route — the row is already in a terminal state but the
    // overall HTTP call succeeded. Treat that as a confirm error too so
    // the alert renders inline instead of leaving the card on the
    // generic "applying…" spinner forever.
    const handlerError = result.data?.mutationResult?.error
    if (result.data?.ok === false || handlerError) {
      const mappedCode =
        typeof handlerError?.code === 'string' && handlerError.code.length > 0
          ? handlerError.code
          : 'execution_failed'
      setConfirmError({
        status: 200,
        code: mappedCode,
        message:
          handlerError?.message ??
          'The mutation handler reported an error. Review the details and re-propose if needed.',
      })
    }
    await refresh()
  }, [pendingActionId, phase, props.endpoint, refresh])

  const handleCancel = React.useCallback(async () => {
    if (!pendingActionId) return
    const result = await cancelPendingAction(pendingActionId, {
      endpoint: props.endpoint,
    })
    if (!result.ok) {
      setConfirmError(result.error)
    }
    await refresh()
  }, [pendingActionId, props.endpoint, refresh])

  const currentStatus = action?.status ?? null
  const isTerminal =
    currentStatus === 'confirmed' ||
    currentStatus === 'failed' ||
    currentStatus === 'cancelled' ||
    currentStatus === 'expired'

  const { handleKeyDown } = useAiShortcuts({
    onSubmit: () => {
      void handleConfirm()
    },
    onCancel: () => {
      void handleCancel()
    },
    enabled: phase === 'preview' && !isTerminal,
  })

  // Terminal — short-circuit into the result card.
  if (isTerminal && action) {
    return (
      <MutationResultCard
        componentId="mutation-result-card"
        pendingActionId={pendingActionId}
        initialAction={action}
        endpoint={props.endpoint}
      />
    )
  }

  // Confirming — flip to the spinner card. Propagate the confirmError so
  // the user sees the structured envelope even though the confirm call has
  // already resolved.
  if (phase === 'confirming') {
    return (
      <ConfirmationCard
        componentId="confirmation-card"
        pendingActionId={pendingActionId}
        initialAction={action ?? undefined}
        endpoint={props.endpoint}
        payload={{
          sideEffectsSummary: action?.sideEffectsSummary ?? null,
          pendingAction: action ?? undefined,
          confirmError: confirmError ?? undefined,
        }}
      />
    )
  }

  const batch = Array.isArray(action?.records) && action!.records!.length > 0 ? action!.records! : null
  const summary = batch ? summarizeBatch(batch) : null

  return (
    <section
      className="rounded-md border border-border bg-background p-4 text-sm outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-ai-mutation-preview
      data-ai-mutation-preview-mode={batch ? 'batch' : 'single'}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 text-status-warning-icon" aria-hidden />
          <div>
            <h4 className="text-sm font-semibold">
              {t(
                'ai_assistant.chat.mutation_cards.preview.title',
                'Review proposed changes',
              )}
            </h4>
            {action?.sideEffectsSummary ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {action.sideEffectsSummary}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mt-3" data-ai-mutation-preview-body>
        {summary ? (
          <div
            className="rounded-md border border-border bg-muted/30 p-3 text-sm"
            data-ai-mutation-preview-batch-summary
          >
            <p className="font-medium">
              {t(
                'ai_assistant.chat.mutation_cards.preview.batchSummary',
                'Batch update',
              )}
              {': '}
              <span data-ai-mutation-preview-count>{summary.count}</span>{' '}
              <span>
                {t(
                  'ai_assistant.chat.mutation_cards.preview.batchRecords',
                  'records',
                )}
              </span>
            </p>
            {summary.labels.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.labels.join(', ')}
                {summary.count > summary.labels.length
                  ? ` +${summary.count - summary.labels.length}`
                  : ''}
              </p>
            ) : null}
          </div>
        ) : (
          <FieldDiffCard fieldDiff={action?.fieldDiff ?? null} />
        )}
      </div>

      {expanded ? (
        <div className="mt-3 rounded-md border border-border bg-muted/20 p-3" data-ai-mutation-preview-details>
          <FieldDiffCard
            fieldDiff={action?.fieldDiff ?? null}
            records={action?.records ?? null}
          />
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          data-ai-mutation-preview-review
        >
          <Eye className="size-4" aria-hidden />
          <span>
            {t(
              'ai_assistant.chat.mutation_cards.preview.reviewDetails',
              'Review details',
            )}
          </span>
          <ChevronDown
            className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleCancel()
            }}
            data-ai-mutation-preview-cancel
          >
            {t('ai_assistant.chat.mutation_cards.preview.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm()
            }}
            data-ai-mutation-preview-confirm
          >
            {t('ai_assistant.chat.mutation_cards.preview.confirm', 'Confirm')}
          </Button>
        </div>
      </div>
    </section>
  )
}

export default MutationPreviewCard
