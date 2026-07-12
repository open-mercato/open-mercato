/**
 * Pure mapping from a failed playground run response to the error surface the
 * page renders. A `code: 'guardrail_blocked'` body (data-honesty spec §3.6) is
 * a policy verdict with a typed reason and gets its own alert; anything else
 * degrades to the generic run-failed message. Kept pure so the contract seam
 * is unit-testable without React (same pattern as `playgroundToolCalls.ts`).
 */

export type RunErrorState =
  | { kind: 'guardrail'; guardrailKind: string; phase: string }
  | { kind: 'generic'; message: string | null }

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
    if (typeof record.error === 'string' && record.error.trim()) {
      return { kind: 'generic', message: record.error }
    }
  }
  return { kind: 'generic', message: null }
}
