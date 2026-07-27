import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { WebSearchProvider } from '@open-mercato/web-search'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveWebSearchConfig, type WebSearchProviderId } from '../../../lib/webSearch/config'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Read-only diagnostics for the agent web-search tool (`agent_orchestrator.web_search`).
 * The provider is chosen by `OM_AGENT_WEB_SEARCH_PROVIDER` (default `model`, i.e. the
 * agent's own LLM native web_search) and resolved through DI as `webSearchProvider`,
 * which is `null` when the selection needs config that is absent. This route reports:
 *   - `ok`             — a provider resolved and its `healthCheck()` passed
 *   - `degraded`       — a provider resolved but `healthCheck()` reported not-ok (e.g.
 *                        `model` selected but the configured LLM provider has no native
 *                        web search, or a keyed backend is unreachable)
 *   - `not_configured` — no provider resolved (keyed provider without a key, SearXNG
 *                        without a base URL, `brave`/`exa` not yet implemented, or `none`)
 * `web_fetch` does NOT depend on the search provider — it always uses the built-in fetch
 * path — so it is reported separately as always available.
 * Gated by `agent_orchestrator.proposals.view` (same as the Overview page that renders it).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.proposals.view'] },
}

type WebSearchHealthStatus = 'ok' | 'degraded' | 'not_configured'

type WebSearchHealthResponse = {
  status: WebSearchHealthStatus
  /** Configured provider selection from `OM_AGENT_WEB_SEARCH_PROVIDER`. */
  provider: WebSearchProviderId
  /** Resolved adapter id (e.g. `model-native`, `tavily`, `searxng`); null when unresolved. */
  providerImplId: string | null
  /** Human-readable reason / health detail; null when healthy. */
  detail: string | null
  /** `web_fetch` uses the built-in fetch path regardless of the search provider. */
  webFetch: 'available'
  checkedAt: string
}

/** Why the DI factory returned null for the configured selection. */
function notConfiguredReason(config: ReturnType<typeof resolveWebSearchConfig>): string {
  switch (config.provider) {
    case 'tavily':
      return 'Provider "tavily" is selected but OM_AGENT_WEB_SEARCH_TAVILY_API_KEY is not set.'
    case 'searxng':
      return 'Provider "searxng" is selected but OM_AGENT_WEB_SEARCH_BASE_URL is not set.'
    case 'brave':
    case 'exa':
      return `Provider "${config.provider}" is not implemented yet — configure a keyed provider (tavily / searxng) or use "model".`
    case 'none':
      return 'Web search is disabled (OM_AGENT_WEB_SEARCH_PROVIDER=none).'
    default:
      return 'Web search provider is not configured.'
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = resolveWebSearchConfig()
  const checkedAt = new Date().toISOString()

  const container = await createRequestContainer()
  const provider = container.resolve('webSearchProvider') as WebSearchProvider | null

  if (!provider) {
    const body: WebSearchHealthResponse = {
      status: 'not_configured',
      provider: config.provider,
      providerImplId: null,
      detail: notConfiguredReason(config),
      webFetch: 'available',
      checkedAt,
    }
    return NextResponse.json(body)
  }

  let status: WebSearchHealthStatus = 'ok'
  let detail: string | null = null
  try {
    const health = await provider.healthCheck()
    if (!health.ok) {
      status = 'degraded'
      detail = health.detail ?? 'Web search provider reported an unhealthy state.'
    }
  } catch (err) {
    status = 'degraded'
    detail = err instanceof Error ? err.message : 'Web search health check failed.'
  }

  const body: WebSearchHealthResponse = {
    status,
    provider: config.provider,
    providerImplId: provider.id,
    detail,
    webFetch: 'available',
    checkedAt,
  }
  return NextResponse.json(body)
}

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'not_configured']),
  provider: z.enum(['model', 'tavily', 'brave', 'exa', 'searxng', 'none']),
  providerImplId: z.string().nullable(),
  detail: z.string().nullable(),
  webFetch: z.literal('available'),
  checkedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent web-search provider health',
  methods: {
    GET: {
      summary: 'Report the configured web-search provider and its health',
      description:
        'Resolves the DI `webSearchProvider` (selected by OM_AGENT_WEB_SEARCH_PROVIDER) and calls its healthCheck(). Returns ok / degraded / not_configured plus a human-readable detail. Gated by agent_orchestrator.proposals.view.',
      responses: [
        { status: 200, description: 'Web-search provider health', schema: healthSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing agent_orchestrator.proposals.view', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
