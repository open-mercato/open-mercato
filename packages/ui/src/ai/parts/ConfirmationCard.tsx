"use client"

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '../../primitives/alert'
import { Button } from '../../primitives/button'
import { Spinner } from '../../primitives/spinner'
import { useAiShortcuts } from '../useAiShortcuts'
import type { AiUiPartProps } from '../ui-part-registry'
import { cancelPendingAction } from './pending-action-api'
import { useAiPendingActionPolling } from './useAiPendingActionPolling'
import { MutationResultCard } from './MutationResultCard'
import type { AiPendingActionCardAction } from './types'

/**
 * Confirmation / in-flight card rendered after the user clicks `Confirm` on
 * the preview card. Shows a spinner + the side-effects summary while the
 * server runs the re-check contract and executes the wrapped tool.
 *
 * The user can race the confirm by clicking Cancel — but only while the
 * server has not yet flipped the row to `executing`. The polling hook
 * drives the disable logic.
 *
 * Surfaces structured error envelopes from the confirm route: 412
 * `stale_version` (records changed since preview) and 412 `schema_drift`
 * (tool input schema changed) render targeted alerts with the specific
 * recovery copy. Keyboard: `Escape` triggers Cancel; `Cmd/Ctrl+Enter` is
 * intentionally inert (the user already confirmed).
 *
 * Terminal states flip this card into a {@link MutationResultCard} render
 * so the chat transcript does not need two separate cards for confirmed
 * vs pending.
 */
export interface ConfirmationCardPayload {
  sideEffectsSummary?: string | null
  pendingAction?: AiPendingActionCardAction
  confirmError?: {
    status: number
    code?: string
    message: string
    extra?: Record<string, unknown>
  }
}

export interface ConfirmationCardProps extends AiUiPartProps {
  /** Optional override for tests — bypasses the polling fetch. */
  initialAction?: AiPendingActionCardAction
  /** Endpoint override (tests). */
  endpoint?: string
  /** Optional cancel handler override (tests). */
  onCancel?: () => Promise<void> | void
}

export function ConfirmationCard(props: ConfirmationCardProps) {
  const t = useT()
  const pendingActionId = props.pendingActionId ?? ''
  const payload = (props.payload as ConfirmationCardPayload | undefined) ?? {}
  const injected = props.initialAction ?? payload.pendingAction ?? null

  const { action, status, refresh } = useAiPendingActionPolling({
    pendingActionId,
    endpoint: props.endpoint,
    disabled: !pendingActionId,
  })

  const effectiveAction = action ?? injected ?? null
  const effectiveStatus = effectiveAction?.status ?? status

  const [isCancelling, setIsCancelling] = React.useState(false)
  const [localError, setLocalError] = React.useState<{
    code?: string
    message: string
    extra?: Record<string, unknown>
  } | null>(
    payload.confirmError
      ? { code: payload.confirmError.code, message: payload.confirmError.message, extra: payload.confirmError.extra }
      : null,
  )

  const canCancel =
    !isCancelling &&
    (effectiveStatus === 'pending' || effectiveStatus === 'confirmed' || effectiveStatus == null)

  const handleCancel = React.useCallback(async () => {
    if (!canCancel) return
    if (props.onCancel) {
      await props.onCancel()
      return
    }
    if (!pendingActionId) return
    setIsCancelling(true)
    try {
      const result = await cancelPendingAction(pendingActionId, {
        endpoint: props.endpoint,
      })
      if (!result.ok) {
        setLocalError({
          code: result.error.code,
          message: result.error.message,
          extra: result.error.extra,
        })
      }
      await refresh()
    } finally {
      setIsCancelling(false)
    }
  }, [canCancel, pendingActionId, props, refresh])

  const { handleKeyDown } = useAiShortcuts({
    onCancel: () => {
      void handleCancel()
    },
    enabled: canCancel,
  })

  // Terminal states — hand off to the result card renderer. Also short-
  // circuit when the dispatcher has already populated an
  // `executionResult.error`: the row may not have transitioned out of
  // `executing` in the latest polling snapshot, but the handler error is
  // authoritative, and leaving the spinner up while a known error is
  // available is exactly the "stalled at processing" symptom the user
  // reported. Surface the error card immediately.
  const executionError = effectiveAction?.executionResult?.error
  if (
    effectiveStatus === 'confirmed' ||
    effectiveStatus === 'failed' ||
    effectiveStatus === 'cancelled' ||
    effectiveStatus === 'expired' ||
    executionError
  ) {
    return (
      <MutationResultCard
        componentId="mutation-result-card"
        pendingActionId={pendingActionId}
        initialAction={effectiveAction ?? undefined}
        endpoint={props.endpoint}
      />
    )
  }

  const summary =
    effectiveAction?.sideEffectsSummary ??
    payload.sideEffectsSummary ??
    t(
      'ai_assistant.chat.mutation_cards.confirmation.defaultSummary',
      'Applying the requested changes...',
    )

  return (
    <section
      className="rounded-md border border-border bg-muted/30 p-4 text-sm outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-ai-confirmation-card
      data-ai-confirmation-status={effectiveStatus ?? 'pending'}
      aria-busy
    >
      <div className="flex items-start gap-3">
        <Spinner size="sm" className="mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold">
            {t(
              'ai_assistant.chat.mutation_cards.confirmation.title',
              'Applying action...',
            )}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
      </div>

      {localError ? (
        <ConfirmationErrorAlert error={localError} />
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void handleCancel()
          }}
          disabled={!canCancel}
          data-ai-confirmation-cancel
        >
          {isCancelling ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          <span>
            {t('ai_assistant.chat.mutation_cards.confirmation.cancel', 'Cancel')}
          </span>
        </Button>
      </div>
    </section>
  )
}

function ConfirmationErrorAlert({
  error,
}: {
  error: { code?: string; message: string; extra?: Record<string, unknown> }
}) {
  const t = useT()
  const code = error.code ?? 'unknown'

  if (code === 'stale_version') {
    const failedRecords = Array.isArray(error.extra?.failedRecords)
      ? (error.extra?.failedRecords as Array<{ recordId?: string }>)
      : []
    return (
      <Alert
        variant="warning"
        className="mt-3"
        data-ai-confirmation-error="stale_version"
      >
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.confirmation.staleVersionTitle',
            'Re-propose required',
          )}
        </AlertTitle>
        <AlertDescription>
          <p>
            {t(
              'ai_assistant.chat.mutation_cards.confirmation.staleVersionBody',
              'One or more records changed since this preview was generated. Ask the assistant to re-propose the change.',
            )}
          </p>
          {failedRecords.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {failedRecords.map((record, idx) => (
                <li
                  key={`${record.recordId ?? idx}`}
                  data-ai-confirmation-stale-record={record.recordId ?? ''}
                >
                  <span className="font-mono">{record.recordId ?? '—'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (code === 'schema_drift') {
    return (
      <Alert
        variant="warning"
        className="mt-3"
        data-ai-confirmation-error="schema_drift"
      >
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.confirmation.schemaDriftTitle',
            'Schema changed',
          )}
        </AlertTitle>
        <AlertDescription>
          {t(
            'ai_assistant.chat.mutation_cards.confirmation.schemaDriftBody',
            'The tool signature changed since this preview was generated. Ask the assistant to re-propose the change.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (code === 'invalid_status') {
    return (
      <Alert
        variant="warning"
        className="mt-3"
        data-ai-confirmation-error="invalid_status"
      >
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.confirmation.invalidStatusTitle',
            'Action already resolved',
          )}
        </AlertTitle>
        <AlertDescription>
          {t(
            'ai_assistant.chat.mutation_cards.confirmation.invalidStatusBody',
            'This action has already been confirmed, cancelled, or executed.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="destructive" className="mt-3" data-ai-confirmation-error={code}>
      <AlertTitle>
        {t('ai_assistant.chat.mutation_cards.confirmation.errorTitle', 'Confirm failed')}
      </AlertTitle>
      <AlertDescription>
        <span className="mr-2 font-mono text-xs">{code}</span>
        <span>{error.message}</span>
      </AlertDescription>
    </Alert>
  )
}

export default ConfirmationCard
