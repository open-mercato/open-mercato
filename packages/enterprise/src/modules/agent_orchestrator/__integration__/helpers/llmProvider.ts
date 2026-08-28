import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Does the app under test have a usable LLM provider?
 *
 * Specs that execute a REAL agent run cannot answer this from `process.env`:
 * the Playwright runner and the app are separate processes (and, on the
 * ephemeral CI environment, separate containers), so the runner's environment
 * says nothing about the app's. The `model-native` web-search adapter is the
 * one adapter whose readiness IS "an LLM provider resolved" — the same witness
 * TC-AGENT-HEALTH-002 already gates on — so it is asked over HTTP instead.
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
