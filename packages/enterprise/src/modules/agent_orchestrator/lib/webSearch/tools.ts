import { z } from 'zod'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  chargeAdapterCalls,
  chargeWebFetchBudget,
  enforceWebSearchRateLimit,
  resolveRunId,
  resolveSpentAdapterBudgets,
} from './guardrails'
import { hostnameOf, isHostAllowed, resolveWebSearchSettings } from './policy'
import { buildWebSearchEngine } from './registry'
import { createStepEmitter } from './steps'

export const WEB_SEARCH_TOOL_ID = 'agent_orchestrator.web_search'
export const WEB_FETCH_TOOL_ID = 'agent_orchestrator.web_fetch'

/**
 * Split so a tenant can be granted discovery without arbitrary URL retrieval.
 * `web_fetch` keeps the original feature id as a second requirement, so every
 * existing grant keeps working while the new one can be withheld.
 */
const WEB_SEARCH_FEATURE = 'agent_orchestrator.web_search'
const WEB_FETCH_FEATURE = 'agent_orchestrator.web_fetch'

const webSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('Search query. Use for discovery - finding pages and sources on the public web.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max results to return; the server caps this to its configured maximum.'),
  site: z.string().max(253).optional().describe('Restrict results to a single domain, e.g. "example.com".'),
  freshness: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Prefer sources published within this window.'),
  includeContent: z
    .boolean()
    .optional()
    .describe(
      'Also read the top results and return their page text inline. Prefer this over calling web_fetch per result.',
    ),
})

const webFetchInput = z.object({
  url: z.url().max(2048).describe('Absolute http(s) URL to retrieve as readable text.'),
  render: z
    .enum(['auto', 'never', 'always'])
    .optional()
    .describe('auto (default) renders in a browser only when the plain read looks like a JavaScript shell.'),
})

/**
 * Resolves the run this call belongs to and wires the live step feed to it.
 * Steps are broadcast, never returned to the model: `diagnostics` is the compact
 * summary it can act on, and a full narration would just spend context.
 */
async function loadContext(ctx: McpToolContext, query: string) {
  const settings = await resolveWebSearchSettings(ctx.container, ctx.tenantId ?? null)
  const runId = await resolveRunId(ctx.container, ctx.sessionId)
  const agentId = await resolveAgentId(ctx)
  // Checked before the engine is built, because the only way to not pay for an
  // adapter is to not enable it — the engine has no notion of cost.
  const spentBudgets = await resolveSpentAdapterBudgets(
    ctx.container,
    ctx.tenantId ?? null,
    settings.policy.adapters,
  )
  const built = buildWebSearchEngine({
    container: ctx.container,
    settings,
    tenantId: ctx.tenantId ?? null,
    spentBudgets,
    onStep: createStepEmitter({
      runId,
      agentId,
      tenantId: ctx.tenantId ?? null,
      organizationId: ctx.organizationId ?? null,
      query,
    }),
  })
  return { settings, runId, ...built }
}

/**
 * The engine is built per call, and adapters may own OS resources — the browser
 * tier holds a sidecar process and a Chromium. Without this every call that
 * touched that tier would leak one of each for the life of the server.
 */
async function disposeQuietly(engine: { dispose(): Promise<void> }): Promise<void> {
  try {
    await engine.dispose()
  } catch {
    // Teardown is best-effort; a disposal fault must not mask the tool's result.
  }
}

async function resolveAgentId(ctx: McpToolContext): Promise<string | null> {
  if (!ctx.sessionId) return null
  try {
    const store = ctx.container.resolve('agentRunSessionStore') as {
      resolveActiveAgentId(token: string): Promise<string | null>
    }
    return await store.resolveActiveAgentId(ctx.sessionId)
  } catch {
    return null
  }
}

/**
 * Read-only web search over the adapter engine. Errors are returned as data so a
 * failed lookup can never crash the agent loop, and `diagnostics` explains what
 * each adapter did - a thin answer should be legible to the model, not silent.
 */
export const webSearchTool: AiToolDefinition = {
  name: WEB_SEARCH_TOOL_ID,
  displayName: 'Web search',
  description:
    'Search the public web and return ranked results (title, url, snippet, confidence). Set includeContent to also read the top pages in one call. Read-only.',
  inputSchema: webSearchInput,
  requiredFeatures: [WEB_SEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'agent_orchestrator', 'web'],
  async handler(rawInput, ctx) {
    const input = webSearchInput.parse(rawInput)
    const { settings, engine, problems, runId } = await loadContext(ctx, input.query)

    try {
      const gate = await enforceWebSearchRateLimit(
        ctx.container,
        { runId, tenantId: ctx.tenantId ?? null, kind: 'search' },
        settings.guardrails,
      )
      if (!gate.ok) return { ok: false as const, code: 'rate_limited' as const, error: gate.error }

      const result = await engine.search({
        query: input.query,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.site === undefined ? {} : { site: input.site }),
        ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
        ...(input.includeContent === undefined ? {} : { includeContent: input.includeContent }),
      })

      // includeContent reads pages under a single search point, so the reads are
      // charged here or the fetch budget never engages on the path the tool
      // description recommends.
      await chargeWebFetchBudget(ctx.container, runId, settings.guardrails, result.diagnostics.pagesRead)

      // Charged from what actually ran, not from what was planned: quorum often
      // settles before the expensive adapter is ever reached, and billing for a
      // call that never happened would exhaust a ceiling that cost nothing.
      await chargeAdapterCalls(
        ctx.container,
        ctx.tenantId ?? null,
        settings.policy.adapters,
        result.diagnostics.adapters
          .filter((entry) => entry.status !== 'skipped' && entry.status !== 'cancelled')
          .map((entry) => entry.id),
      )

      const allowed = result.results.filter((hit) => {
        const host = hostnameOf(hit.url)
        return host ? isHostAllowed(host, settings.guardrails) : false
      })

      return {
        ok: true as const,
        results: allowed,
        answer: result.answer,
        diagnostics: {
          adapters: result.diagnostics.adapters,
          degraded: result.diagnostics.degraded || allowed.length !== result.results.length,
          cached: result.diagnostics.cached,
          escalated: result.diagnostics.escalated,
          elapsedMs: result.diagnostics.elapsedMs,
          ...(problems.length > 0 ? { problems } : {}),
        },
      }
    } finally {
      await disposeQuietly(engine)
    }
  },
}

/** Read-only single-URL retrieval, with automatic browser rendering for JS shells. */
export const webFetchTool: AiToolDefinition = {
  name: WEB_FETCH_TOOL_ID,
  displayName: 'Web fetch',
  description:
    'Retrieve a single public http(s) URL and return its readable text (size-capped). Read-only; prefer web_search with includeContent when you have not chosen a page yet.',
  inputSchema: webFetchInput,
  requiredFeatures: [WEB_SEARCH_FEATURE, WEB_FETCH_FEATURE],
  isMutation: false,
  tags: ['read', 'agent_orchestrator', 'web'],
  async handler(rawInput, ctx) {
    const input = webFetchInput.parse(rawInput)
    const { settings, engine, runId } = await loadContext(ctx, input.url)

    try {
      const host = hostnameOf(input.url)
      if (!host || !isHostAllowed(host, settings.guardrails)) {
        return {
          ok: false as const,
          code: 'domain_blocked' as const,
          error: `domain not allowed: ${host ?? input.url}`,
        }
      }

      const gate = await enforceWebSearchRateLimit(
        ctx.container,
        { runId, tenantId: ctx.tenantId ?? null, kind: 'fetch' },
        settings.guardrails,
      )
      if (!gate.ok) return { ok: false as const, code: 'rate_limited' as const, error: gate.error }

      const outcome = await engine.fetch({
        url: input.url,
        maxBytes: settings.guardrails.maxFetchBytes,
        ...(input.render === undefined ? {} : { render: input.render }),
      })

      if (outcome.status !== 'ok') {
        return { ok: false as const, code: outcome.status, error: outcome.reason ?? outcome.status }
      }
      // The engine follows redirects, so the host that actually answered may not
      // be the one the guardrail cleared above.
      const finalHost = hostnameOf(outcome.page.url)
      if (!finalHost || !isHostAllowed(finalHost, settings.guardrails)) {
        return {
          ok: false as const,
          code: 'domain_blocked' as const,
          error: `domain not allowed after redirect: ${finalHost ?? outcome.page.url}`,
        }
      }
      return { ok: true as const, ...outcome.page }
    } finally {
      await disposeQuietly(engine)
    }
  },
}
