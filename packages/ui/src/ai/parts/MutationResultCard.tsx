"use client"

import * as React from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '../../primitives/alert'
import type { AiUiPartProps } from '../ui-part-registry'
import { useAiPendingActionPolling } from './useAiPendingActionPolling'
import type { AiPendingActionCardAction, AiPendingActionCardStatus } from './types'

/**
 * Terminal-state card that renders the `executionResult` of a pending
 * action. Success → `Alert variant="success"` with a record link; partial
 * success (batch `failedRecords[]`) → `variant="warning"` with the list;
 * failure → `variant="destructive"` with the error code + message.
 *
 * Reads the pending action via the shared polling hook so page reloads
 * still recover state. The hook short-circuits once the row is terminal
 * (spec's reconnect behavior), which is always the case for this card.
 */
export interface MutationResultCardPayload {
  /** Server-serialized pending action snapshot (optional — the hook refetches). */
  pendingAction?: AiPendingActionCardAction
  /** Optional link target for the success record. */
  recordHref?: string
}

export interface MutationResultCardProps extends AiUiPartProps {
  /** Optional injected action for tests — bypasses the polling fetch. */
  initialAction?: AiPendingActionCardAction
  /** Poll endpoint override for tests. */
  endpoint?: string
}

function isSuccessStatus(status: AiPendingActionCardStatus | null): boolean {
  return status === 'confirmed'
}

function isFailureStatus(status: AiPendingActionCardStatus | null): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'expired'
}

export function MutationResultCard(props: MutationResultCardProps) {
  const t = useT()
  const pendingActionId = props.pendingActionId ?? ''
  const payload = (props.payload as MutationResultCardPayload | undefined) ?? {}
  const injected = props.initialAction ?? payload.pendingAction ?? null

  const { action: polled } = useAiPendingActionPolling({
    pendingActionId,
    endpoint: props.endpoint,
    disabled: !pendingActionId || Boolean(injected),
  })
  const action = injected ?? polled
  const status = action?.status ?? null
  const failedRecords = action?.failedRecords ?? null
  const result = action?.executionResult ?? null

  if (!action) {
    return null
  }

  if (isSuccessStatus(status) && failedRecords && failedRecords.length > 0) {
    return (
      <Alert variant="warning" data-ai-mutation-result="partial">
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.result.partialTitle',
            'Action applied with failures',
          )}
        </AlertTitle>
        <AlertDescription>
          <p>
            {t(
              'ai_assistant.chat.mutation_cards.result.partialBody',
              'Some records could not be updated.',
            )}
          </p>
          <ul
            className="mt-2 list-disc space-y-1 pl-5 text-xs"
            data-ai-mutation-failed-records
          >
            {failedRecords.map((record) => (
              <li key={record.recordId} data-ai-mutation-failed-record={record.recordId}>
                <span className="font-mono">{record.recordId}</span>
                <span className="mx-1 text-muted-foreground">•</span>
                <span className="font-mono">{record.error.code}</span>
                <span className="mx-1 text-muted-foreground">—</span>
                <span>{record.error.message}</span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    )
  }

  if (isSuccessStatus(status)) {
    const recordId = result?.recordId ?? action.targetRecordId ?? null
    const href = payload.recordHref ?? null
    return (
      <Alert variant="success" data-ai-mutation-result="success">
        <CheckCircle2 className="size-4" aria-hidden />
        <AlertTitle>
          {t('ai_assistant.chat.mutation_cards.result.successTitle', 'Action applied')}
        </AlertTitle>
        <AlertDescription>
          <p>
            {result?.commandName
              ? t(
                  'ai_assistant.chat.mutation_cards.result.successWithCommand',
                  'Completed',
                ) + `: ${result.commandName}`
              : t(
                  'ai_assistant.chat.mutation_cards.result.successBody',
                  'The mutation completed successfully.',
                )}
          </p>
          {recordId ? (
            <p className="mt-1 text-xs">
              {href ? (
                <a
                  className="font-mono text-primary underline"
                  href={href}
                  data-ai-mutation-result-link
                >
                  {t(
                    'ai_assistant.chat.mutation_cards.result.viewRecord',
                    'View record',
                  )}
                  : {recordId}
                </a>
              ) : (
                <span className="font-mono" data-ai-mutation-result-record-id>
                  {recordId}
                </span>
              )}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (isFailureStatus(status)) {
    const code = result?.error?.code ?? status ?? 'failed'
    const message =
      result?.error?.message ??
      t(
        'ai_assistant.chat.mutation_cards.result.failureBody',
        'The mutation could not be applied.',
      )
    return (
      <Alert variant="destructive" data-ai-mutation-result="failure">
        <XCircle className="size-4" aria-hidden />
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.result.failureTitle',
            'Action failed',
          )}
        </AlertTitle>
        <AlertDescription>
          <span className="mr-2 font-mono text-xs" data-ai-mutation-result-code>
            {code}
          </span>
          <span>{message}</span>
        </AlertDescription>
      </Alert>
    )
  }

  return null
}

export default MutationResultCard
