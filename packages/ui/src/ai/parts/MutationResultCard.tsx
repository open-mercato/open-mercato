"use client"

import * as React from 'react'
import { AlertTriangle, CheckCircle2, Wand2, XCircle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '../../primitives/alert'
import { Button } from '../../primitives/button'
import type { AiUiPartProps } from '../ui-part-registry'
import { useAiPendingActionPolling } from './useAiPendingActionPolling'
import type { AiPendingActionCardAction, AiPendingActionCardStatus } from './types'

/** Custom DOM event the failure card dispatches when the operator clicks
 * "Fix with AI". `<AiChat>` listens for this and sends a follow-up user
 * message asking the agent to diagnose and retry the failed call. */
export const AI_CHAT_FIX_REQUEST_EVENT = 'om-ai-chat-fix-request'

export interface AiChatFixRequestDetail {
  message: string
  toolName?: string
  pendingActionId?: string
}

function dispatchFixRequest(detail: AiChatFixRequestDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AiChatFixRequestDetail>(AI_CHAT_FIX_REQUEST_EVENT, { detail }))
}

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
        <div className="text-sm leading-relaxed">
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
        </div>
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
        <div className="text-sm leading-relaxed">
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
        </div>
      </Alert>
    )
  }

  // Render the failure alert when the action is in a failure status OR when
  // the dispatcher already captured an `executionResult.error` (the row may
  // not yet have transitioned out of `executing` in the polling snapshot,
  // but the handler error is authoritative — surface it immediately so the
  // operator never sees a stuck "applying…" state silently masking a real
  // failure).
  if (isFailureStatus(status) || result?.error) {
    const code = result?.error?.code ?? status ?? 'failed'
    const message =
      result?.error?.message ??
      t(
        'ai_assistant.chat.mutation_cards.result.failureBody',
        'The mutation could not be applied.',
      )
    const errorObj = result?.error
    const errorDetails = errorObj?.details
    const errorInput = errorObj?.input
    const errorName = errorObj?.name
    const onFixWithAi = () => {
      // Build a structured prompt that gives the agent enough context to
      // diagnose and retry without copy/paste from the operator. Keeping
      // it explicit ("retry with corrected arguments") nudges the model
      // away from re-issuing the same args (which would just hit the
      // same error). The repository's idempotency check only dedupes
      // active `pending` rows, so a fresh prepareMutation call after a
      // terminal failure always produces a new pending action — the
      // retry is never silently collapsed.
      //
      // The prompt now embeds the full structured failure context the
      // server captured (Zod issues / fieldErrors, original arguments,
      // failedRecords for batch tools, error name + cause). Without this
      // the operator routinely saw "Invalid input" with no field path —
      // the model literally could not fix what it could not see.
      const promptLines: string[] = [
        `The previous call to tool "${action.toolName}" failed.`,
        `Error: ${code} — ${message}.`,
      ]
      if (errorName && errorName !== 'Error') {
        promptLines.push(`Error class: ${errorName}.`)
      }
      if (action.targetEntityType || action.targetRecordId) {
        promptLines.push(
          `Target: ${action.targetEntityType ?? '?'}${action.targetRecordId ? ' / ' + action.targetRecordId : ''}.`,
        )
      }

      // Field-level validation issues (Zod, custom). Render as a bulleted
      // list of `path: message` so the model can locate the offender by
      // schema path instead of guessing from a generic message.
      const issues = errorDetails?.issues ?? []
      if (Array.isArray(issues) && issues.length > 0) {
        promptLines.push('', 'Validation issues:')
        for (const issue of issues) {
          const path = Array.isArray(issue?.path) && issue.path.length > 0
            ? issue.path.join('.')
            : '(root)'
          const msg = issue?.message ?? '(no message)'
          const codeHint = issue?.code ? ` [${issue.code}]` : ''
          const expHint =
            issue?.expected || issue?.received
              ? ` (expected ${issue?.expected ?? '?'}, got ${issue?.received ?? '?'})`
              : ''
          promptLines.push(`- ${path}: ${msg}${codeHint}${expHint}`)
        }
      } else if (errorDetails?.fieldErrors && typeof errorDetails.fieldErrors === 'object') {
        const entries = Object.entries(errorDetails.fieldErrors)
        if (entries.length > 0) {
          promptLines.push('', 'Field errors:')
          for (const [path, msgs] of entries) {
            const list = Array.isArray(msgs) ? msgs.join('; ') : String(msgs)
            promptLines.push(`- ${path}: ${list}`)
          }
        }
      }

      // Echo the arguments the handler was invoked with so the model can
      // see exactly what it sent and change at least one parameter on
      // retry. JSON-stringified inline for compactness; non-serializable
      // values are dropped on the server side already.
      if (errorInput !== undefined) {
        try {
          const json = JSON.stringify(errorInput, null, 2)
          if (json && json !== '{}' && json.length <= 4000) {
            promptLines.push('', 'Arguments you sent:', '```json', json, '```')
          } else if (json && json.length > 4000) {
            promptLines.push(
              '',
              'Arguments you sent (truncated):',
              '```json',
              json.slice(0, 4000) + '\n… [truncated]',
              '```',
            )
          }
        } catch {
          // ignore
        }
      }

      // Surface root-cause when the handler nested another error inside.
      if (errorDetails?.cause !== undefined) {
        try {
          const causeJson = JSON.stringify(errorDetails.cause, null, 2)
          if (causeJson && causeJson !== '{}' && causeJson.length <= 1500) {
            promptLines.push('', 'Underlying cause:', '```json', causeJson, '```')
          }
        } catch {
          // ignore
        }
      }

      // Per-record failures from batch tools (Step 5.14). These usually
      // carry the most actionable information for partial-success cases.
      if (failedRecords && failedRecords.length > 0) {
        promptLines.push('', 'Records that failed:')
        for (const rec of failedRecords) {
          promptLines.push(
            `- ${rec.recordId} → ${rec.error.code}: ${rec.error.message}`,
          )
        }
      }

      promptLines.push(
        '',
        'Diagnose what went wrong using the validation issues / cause / arguments above, correct the arguments, and call the tool again. If the failure indicates missing prerequisites (e.g. a deal needs a linked person/company before commenting), tell me what to fix on the platform side instead of retrying blindly. Do not repeat the exact same arguments — you must change at least one parameter or stop and explain.',
      )
      dispatchFixRequest({
        message: promptLines.join('\n'),
        toolName: action.toolName,
        pendingActionId: action.id,
      })
    }
    const visibleIssues = Array.isArray(errorDetails?.issues)
      ? errorDetails!.issues!.filter((entry) => entry && (entry.message || entry.path))
      : []
    return (
      <Alert variant="destructive" data-ai-mutation-result="failure">
        <XCircle className="size-4" aria-hidden />
        <AlertTitle>
          {t(
            'ai_assistant.chat.mutation_cards.result.failureTitle',
            'Action failed',
          )}
        </AlertTitle>
        <div className="text-sm leading-relaxed">
          <div>
            <span className="mr-2 font-mono text-xs" data-ai-mutation-result-code>
              {code}
            </span>
            <span>{message}</span>
          </div>
          {visibleIssues.length > 0 ? (
            <ul
              className="mt-2 list-disc space-y-0.5 pl-5 text-xs"
              data-ai-mutation-result-issues
            >
              {visibleIssues.map((issue, index) => {
                const path =
                  Array.isArray(issue?.path) && issue.path.length > 0
                    ? issue.path.join('.')
                    : null
                return (
                  <li key={index}>
                    {path ? (
                      <span className="font-mono">{path}</span>
                    ) : null}
                    {path && issue?.message ? <span className="mx-1">—</span> : null}
                    {issue?.message ? <span>{issue.message}</span> : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onFixWithAi}
              data-ai-mutation-result-fix
            >
              <Wand2 className="size-4" aria-hidden />
              <span>
                {t(
                  'ai_assistant.chat.mutation_cards.result.fixWithAi',
                  'Fix with AI',
                )}
              </span>
            </Button>
          </div>
        </div>
      </Alert>
    )
  }

  return null
}

export default MutationResultCard
