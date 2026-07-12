import { z } from 'zod'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { isWebSearchProviderError, type WebSearchProvider } from '@open-mercato/search-provider-searxng'
import { getCurrentRunId } from '../runtime/runContext'
import { hostnameOf, isHostAllowed, resolveWebSearchConfig } from './config'
import { enforceWebSearchRateLimit } from './guardrails'

/** Tool id of the ACL-gated web-search (discovery) tool. */
export const WEB_SEARCH_TOOL_ID = 'agent_orchestrator.web_search'

/** Tool id of the ACL-gated web-fetch (single-URL retrieval) tool. */
export const WEB_FETCH_TOOL_ID = 'agent_orchestrator.web_fetch'

/**
 * Web egress is gated behind a DEDICATED, default-off ACL feature (a deliberate
 * divergence from the file-agent-path `agents.run` reuse) so a tenant/agent must
 * be explicitly authorized for the network before either tool is callable. The
 * MCP HTTP server re-checks this on every call against the per-run session
 * token's ACL (`requiredFeatures`) — no handler-side assertion needed.
 */
const WEB_SEARCH_FEATURE = 'agent_orchestrator.web_search'

const webSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('Search query. Use for discovery — finding pages/sources on the public web.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max results to return; the server caps this to its configured maximum.'),
})

const webFetchInput = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .describe('Absolute http(s) URL to retrieve as readable text. Use after web_search to read a page.'),
})

function resolveProvider(ctx: McpToolContext): WebSearchProvider | null {
  try {
    const resolved = ctx.container.resolve('webSearchProvider') as WebSearchProvider | null
    return resolved ?? null
  } catch {
    return null
  }
}

function toToolError(err: unknown) {
  if (isWebSearchProviderError(err)) {
    return { ok: false as const, code: err.code, error: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { ok: false as const, code: 'error' as const, error: message }
}

/**
 * Read-only web search. Egress runs server-side through the DI-resolved provider
 * (SearXNG by default) — never the isolated-vm sandbox and never OpenCode's
 * native web tools. Errors are returned as data (never thrown) so one failed
 * lookup cannot crash the agent loop; propose-only holds (`isMutation: false`).
 */
export const webSearchTool: AiToolDefinition = {
  name: WEB_SEARCH_TOOL_ID,
  displayName: 'Web search',
  description:
    'Search the public web for current information and return ranked results (title, url, snippet). Read-only discovery; use web_fetch to read a specific result.',
  inputSchema: webSearchInput,
  requiredFeatures: [WEB_SEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'agent_orchestrator', 'web'],
  async handler(rawInput, ctx) {
    const { query, limit } = webSearchInput.parse(rawInput)
    const provider = resolveProvider(ctx)
    if (!provider) {
      return { ok: false as const, code: 'not_configured' as const, error: 'web search provider is not configured' }
    }
    const config = resolveWebSearchConfig()
    const gate = await enforceWebSearchRateLimit(
      ctx.container,
      { runId: getCurrentRunId() ?? null, tenantId: ctx.tenantId },
      config,
    )
    if (!gate.ok) {
      return { ok: false as const, code: 'rate_limited' as const, error: gate.error }
    }
    try {
      const results = await provider.search(query, {
        limit: limit ?? config.maxResults,
        timeoutMs: config.timeoutMs,
      })
      const filtered = results.filter((result) => {
        const host = hostnameOf(result.url)
        return host ? isHostAllowed(host, config) : false
      })
      return { ok: true as const, results: filtered }
    } catch (err) {
      return toToolError(err)
    }
  },
}

/**
 * Read-only single-URL retrieval → readable text. Layered guardrails: the
 * always-on SSRF guard in the provider blocks private/metadata targets at the
 * socket boundary; this handler additionally enforces the domain allow/deny list
 * and the call budget before egress. `isMutation: false` — retrieval only.
 */
export const webFetchTool: AiToolDefinition = {
  name: WEB_FETCH_TOOL_ID,
  displayName: 'Web fetch',
  description:
    'Retrieve a single public http(s) URL and return its readable text (size-capped). Read-only; use after web_search to read a specific page.',
  inputSchema: webFetchInput,
  requiredFeatures: [WEB_SEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'agent_orchestrator', 'web'],
  async handler(rawInput, ctx) {
    const { url } = webFetchInput.parse(rawInput)
    const provider = resolveProvider(ctx)
    if (!provider) {
      return { ok: false as const, code: 'not_configured' as const, error: 'web fetch provider is not configured' }
    }
    const config = resolveWebSearchConfig()
    const host = hostnameOf(url)
    if (!host || !isHostAllowed(host, config)) {
      return { ok: false as const, code: 'domain_blocked' as const, error: `domain not allowed: ${host ?? url}` }
    }
    const gate = await enforceWebSearchRateLimit(
      ctx.container,
      { runId: getCurrentRunId() ?? null, tenantId: ctx.tenantId },
      config,
    )
    if (!gate.ok) {
      return { ok: false as const, code: 'rate_limited' as const, error: gate.error }
    }
    try {
      const result = await provider.fetch(url, { maxBytes: config.maxBytes, timeoutMs: config.timeoutMs })
      return { ok: true as const, ...result }
    } catch (err) {
      return toToolError(err)
    }
  },
}
