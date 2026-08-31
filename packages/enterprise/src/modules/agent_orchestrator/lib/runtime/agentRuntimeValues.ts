/**
 * Runtime labels that execute on the business harness. `'opencode'` is the
 * historical label the file-agent loader stamped before the harness replaced
 * that runtime; persisted `agent_runs.runtime` rows and third-party registry
 * entries still carry it, so filters, rollups and dispatch MUST treat the two
 * labels as ONE cohort (Migration & BC section of the business-harness spec).
 *
 * Leaf module with no imports so both the server registry (`lib/sdk/defineAgent`)
 * and the client view mappers (`components/types`) can share one definition.
 *
 * @deprecated `'opencode'` — register with `'business-harness'` instead.
 */
export const BUSINESS_HARNESS_RUNTIME_VALUES = ['business-harness', 'opencode'] as const

export function isBusinessHarnessRuntime(runtime: string | null | undefined): boolean {
  return (BUSINESS_HARNESS_RUNTIME_VALUES as readonly string[]).includes(runtime ?? '')
}
