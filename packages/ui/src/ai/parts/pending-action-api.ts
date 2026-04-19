"use client"

import { apiCall } from '../../backend/utils/apiCall'
import type { AiPendingActionCardAction } from './types'

/**
 * Thin client wrappers over the pending-action confirm/cancel routes
 * (Steps 5.8 / 5.9). Kept here so the mutation-approval cards (Step 5.10)
 * can thread structured error envelopes — especially the 412 `stale_version`
 * / 412 `schema_drift` / 409 `invalid_status` shapes — back into the UI
 * without each card reimplementing the same fetch boilerplate.
 *
 * `apiCall` is used (not `apiCallOrThrow`) because the cards need the
 * non-2xx response body (`{ error, code, failedRecords?, issues? }`) to
 * surface a targeted alert, not a generic thrown error.
 */

export type PendingActionMutationOk = {
  ok: boolean
  pendingAction: AiPendingActionCardAction
  mutationResult?: AiPendingActionCardAction['executionResult']
}

export type PendingActionMutationError = {
  status: number
  code?: string
  message: string
  extra?: Record<string, unknown>
}

export type PendingActionMutationResult =
  | { ok: true; data: PendingActionMutationOk }
  | { ok: false; error: PendingActionMutationError }

async function postJson(
  url: string,
  body?: unknown,
): Promise<PendingActionMutationResult> {
  const call = await apiCall<Record<string, unknown>>(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (call.ok) {
    const data = call.result as PendingActionMutationOk
    return { ok: true, data }
  }
  const raw = (call.result ?? {}) as {
    error?: unknown
    code?: unknown
    [key: string]: unknown
  }
  const errorMessage =
    typeof raw.error === 'string' && raw.error.length > 0
      ? raw.error
      : `Request failed (${call.status}).`
  const code = typeof raw.code === 'string' ? raw.code : undefined
  const { error: _err, code: _code, ...extra } = raw
  return {
    ok: false,
    error: {
      status: call.status,
      code,
      message: errorMessage,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    },
  }
}

export async function confirmPendingAction(
  pendingActionId: string,
  options?: { endpoint?: string },
): Promise<PendingActionMutationResult> {
  const base = options?.endpoint ?? '/api/ai_assistant/ai/actions'
  const url = `${base}/${encodeURIComponent(pendingActionId)}/confirm`
  return postJson(url)
}

export async function cancelPendingAction(
  pendingActionId: string,
  options?: { endpoint?: string; reason?: string },
): Promise<PendingActionMutationResult> {
  const base = options?.endpoint ?? '/api/ai_assistant/ai/actions'
  const url = `${base}/${encodeURIComponent(pendingActionId)}/cancel`
  const body = options?.reason ? { reason: options.reason } : undefined
  return postJson(url, body)
}
