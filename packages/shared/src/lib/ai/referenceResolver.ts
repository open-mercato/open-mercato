/**
 * The reference resolver contract behind the agent orchestrator's
 * `reference_exists` output-integrity rule (spec
 * `2026-10-21-output-integrity-guardrails` → Rule kinds → `reference_exists`).
 *
 * The type lives in `shared` so OSS and app modules can register resolvers
 * without depending on the enterprise package; the orchestrator resolves them
 * soft-optionally from DI under `agentReferenceResolver:<resolverId>`.
 *
 * A resolver MUST be read-only, filter every lookup by the given scope, read
 * through `findWithDecryption`, and answer the whole batch in one indexed
 * lookup. Ids are compared exactly; a resolver that canonicalises ids (case,
 * prefixes) MUST document it. The returned map is keyed by `ReferenceLookup.id`.
 */
export type ReferenceResolverScope = { tenantId: string; organizationId: string }

export type ReferenceLookup = { id: string; version?: string | null }

export type ReferenceResolution =
  | { status: 'exists'; version?: string | null }
  | { status: 'not_found' }
  | { status: 'version_mismatch'; currentVersion?: string | null }

export type AgentReferenceResolver = {
  id: string
  contractVersion: 1
  resolve(refs: ReferenceLookup[], scope: ReferenceResolverScope): Promise<Map<string, ReferenceResolution>>
}

export const AGENT_REFERENCE_RESOLVER_DI_PREFIX = 'agentReferenceResolver:'

export function agentReferenceResolverDiKey(resolverId: string): string {
  return `${AGENT_REFERENCE_RESOLVER_DI_PREFIX}${resolverId}`
}
