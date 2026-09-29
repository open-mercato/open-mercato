import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Does the app under test have a usable LLM provider?
 *
 * Specs that execute a REAL agent run cannot answer this from `process.env`:
 * the Playwright runner and the app are separate processes (and, on the
 * ephemeral CI environment, separate containers), so the runner's environment
 * says nothing about the app's. The `model-native` web-search adapter — the same
 * witness TC-AGENT-HEALTH-002 gates on — is asked over HTTP instead.
 *
 * This is a cheap PRE-FILTER, not a guarantee. That adapter reports ready once
 * the host wired it a model resolver, which says nothing about whether the
 * resolver can produce a model: a deployment carrying `OM_AI_PROVIDER=openai`
 * with an empty `OPENAI_API_KEY` (the shape `.env.example` ships, and what CI
 * runs with) passes this check and still cannot run anything. The run response
 * is the authoritative witness — see `isModelUnavailableResponse`.
 *
 * Fails CLOSED to `false`: an unreachable or unreadable health endpoint means
 * we cannot claim a provider exists, and a real agent run would then hang until
 * the route answered 503.
 */
export async function hasConfiguredLlmProvider(
  request: APIRequestContext,
  token: string,
): Promise<boolean> {
  try {
    const response = await apiRequest(
      request,
      'GET',
      '/api/agent_orchestrator/web-search/health?probe=auto',
      { token },
    )
    if (response.status() !== 200) return false
    const body = await readJsonSafe<{ adapters?: Array<{ id?: string; ready?: boolean }> }>(response)
    return (body?.adapters ?? []).some((adapter) => adapter.id === 'model-native' && adapter.ready === true)
  } catch {
    return false
  }
}

/** Skip reason shared by every spec that needs a live model call. */
export const NO_LLM_PROVIDER_SKIP_REASON =
  'no LLM provider is configured in this environment — this spec executes a real agent run'

/**
 * Is this run response the environment saying "I cannot run a model"?
 *
 * The readiness probe above is satisfied by a deployment that cannot resolve a
 * model at all, by one whose pinned provider has no key, and by one whose
 * provider then refuses every call — no credit, revoked key, exhausted quota.
 * The run route answers 503 for all of them, so the response is the only witness
 * that tells an unusable environment apart from a real defect, and a spec
 * covering the run CONTRACT has nothing to assert once the model never ran.
 * Anything else, 500 included, stays a failure.
 */
export function isModelUnavailableResponse(status: number): boolean {
  return status === 503
}
