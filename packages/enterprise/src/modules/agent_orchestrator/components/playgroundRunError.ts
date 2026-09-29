/**
 * Pure mapping from a failed playground run response to the error surface the
 * page renders. A `code: 'guardrail_blocked'` body (data-honesty spec §3.6) is
 * a policy verdict with a typed reason and gets its own alert; anything else
 * degrades to the generic run-failed message. Kept pure so the contract seam
 * is unit-testable without React (same pattern as `playgroundToolCalls.ts`).
 *
 * The route answers in English — `error` is an API contract string a third
 * party integrates against, not UI copy — so the page must never render it
 * verbatim. `messageKey` is what it renders instead: the run route stamps a
 * stable `code` on every failure it classifies, and each code has a locale
 * entry. `message` survives only as the last-resort text for a body carrying a
 * code this build does not know, which is the honest reading of "something the
 * server named and we cannot".
 */

export type RunErrorState =
  | { kind: 'guardrail'; guardrailKind: string; phase: string }
  | { kind: 'generic'; messageKey: string | null; message: string | null }

/**
 * Every `code` the agent-run route classifies, mapped to its locale entry.
 *
 * The keys are the module's existing `agent_orchestrator.errors.*` block —
 * translated one-for-one against the route's English strings, and until now
 * referenced by nothing. A code missing here falls back to the route's English
 * `error` text, so adding a classified failure to the route means adding a row
 * here and an `errors.*` entry in all five locales.
 */
const RUN_ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  agent_not_found: 'agent_orchestrator.errors.agent_not_found',
  agent_output_invalid: 'agent_orchestrator.errors.agent_invalid_output',
  agent_run_timeout: 'agent_orchestrator.errors.timeout',
  agent_capacity_exhausted: 'agent_orchestrator.errors.capacity',
  no_provider_configured: 'agent_orchestrator.errors.no_provider_configured',
  api_key_missing: 'agent_orchestrator.errors.api_key_missing',
  provider_rejected: 'agent_orchestrator.errors.provider_rejected',
  agent_run_failed: 'agent_orchestrator.errors.agent_run_failed',
}

export function runErrorMessageKeyForCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  return RUN_ERROR_MESSAGE_KEYS[code] ?? null
}

export function runErrorStateFromBody(body: unknown): RunErrorState {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    if (record.code === 'guardrail_blocked') {
      return {
        kind: 'guardrail',
        guardrailKind: typeof record.kind === 'string' && record.kind ? record.kind : 'unknown',
        phase: typeof record.phase === 'string' && record.phase ? record.phase : 'unknown',
      }
    }
    const messageKey = runErrorMessageKeyForCode(record.code)
    if (messageKey) return { kind: 'generic', messageKey, message: null }
    if (typeof record.error === 'string' && record.error.trim()) {
      return { kind: 'generic', messageKey: null, message: record.error }
    }
  }
  return { kind: 'generic', messageKey: null, message: null }
}
