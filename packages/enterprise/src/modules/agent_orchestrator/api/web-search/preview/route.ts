import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  chargeAdapterCalls,
  enforceWebSearchRateLimit,
  resolveSpentAdapterBudgets,
} from '../../../lib/webSearch/guardrails'
import { hostnameOf, isHostAllowed, resolveWebSearchSettings } from '../../../lib/webSearch/policy'
import { buildWebSearchEngine } from '../../../lib/webSearch/registry'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Runs one search against the tenant's own configuration and returns what each
 * adapter produced, side by side.
 *
 * This is the operator's answer to "is the paid source earning its keep": the
 * fused list an agent sees is deliberately lossy — dedup, the per-domain cap and
 * the limit drop hits, and only the first prose answer survives — so comparing
 * sources from it is impossible. Agents never get this view: N raw lists cost a
 * lot of context and push fusion back onto the model, which is what the ranking
 * step exists to avoid.
 *
 * Gated on `agents.manage` rather than `agents.view` because it spends real
 * egress and, with a metered adapter enabled, real money.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.manage'] },
}

const previewInput = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).optional(),
  site: z.string().min(1).max(253).optional(),
  freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = previewInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  const tenantId = auth.tenantId ?? null
  const settings = await resolveWebSearchSettings(container, tenantId)

  // Same tenant ceiling the agent path obeys. Being behind `agents.manage` bounds
  // who can call this, not how often, and every call is real egress on every
  // enabled adapter — a held-down key would be the most expensive loop here.
  const gate = await enforceWebSearchRateLimit(
    container,
    { runId: null, tenantId, kind: 'search' },
    settings.guardrails,
  )
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 429 })

  // Exhaustive on purpose: under the tenant's own settle mode the scheduler
  // cancels adapters as soon as it has enough, which is right for a search and
  // useless for a comparison — the sources you wanted to weigh never run.
  const comparison = {
    ...settings,
    policy: { ...settings.policy, settleMode: 'exhaustive' as const },
  }
  // A comparison runs every enabled adapter on purpose, which is precisely when a
  // spent ceiling matters most.
  const spentBudgets = await resolveSpentAdapterBudgets(container, tenantId, settings.policy.adapters)
  const { engine, problems } = buildWebSearchEngine({
    container,
    settings: comparison,
    tenantId,
    spentBudgets,
  })

  try {
    const result = await engine.search(
      {
        query: parsed.data.query,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
        ...(parsed.data.site === undefined ? {} : { site: parsed.data.site }),
        ...(parsed.data.freshness === undefined ? {} : { freshness: parsed.data.freshness }),
      },
      { includeAdapterResults: true },
    )

    await chargeAdapterCalls(
      container,
      tenantId,
      settings.policy.adapters,
      result.diagnostics.adapters
        .filter((entry) => entry.status !== 'skipped' && entry.status !== 'cancelled')
        .map((entry) => entry.id),
    )

    const blockedByGuardrails = (url: string): boolean => {
      const host = hostnameOf(url)
      return host === null || !isHostAllowed(host, settings.guardrails)
    }

    return NextResponse.json({
      query: parsed.data.query,
      settleMode: settings.policy.settleMode,
      fused: result.results.filter((hit) => !blockedByGuardrails(hit.url)),
      answer: result.answer,
      diagnostics: result.diagnostics,
      // Guardrails are reported rather than applied here: an operator tuning a
      // deny list needs to see that a source returned a hit and that the list
      // removed it, which silent filtering would hide.
      byAdapter: (result.byAdapter ?? []).map((entry) => ({
        adapterId: entry.adapterId,
        weight: entry.weight,
        answer: entry.answer,
        results: entry.results.map((hit) => ({
          url: hit.url,
          title: hit.title ?? null,
          snippet: hit.snippet ?? null,
          blockedByGuardrails: blockedByGuardrails(hit.url),
        })),
      })),
      problems,
    })
  } finally {
    await engine.dispose().catch(() => undefined)
  }
}

const previewResponseSchema = z.object({
  query: z.string(),
  settleMode: z.string(),
  fused: z.array(z.object({}).passthrough()),
  answer: z.string().nullable(),
  diagnostics: z.object({}).passthrough(),
  byAdapter: z.array(
    z.object({
      adapterId: z.string(),
      weight: z.number(),
      answer: z.string().nullable(),
      results: z.array(
        z.object({
          url: z.string(),
          title: z.string().nullable(),
          snippet: z.string().nullable(),
          blockedByGuardrails: z.boolean(),
        }),
      ),
    }),
  ),
  problems: z.array(z.object({ id: z.string().nullable(), packageName: z.string(), reason: z.string() })),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Compare what each web-search adapter returns',
  methods: {
    POST: {
      summary: 'Run one search and return every adapter’s own results',
      description:
        'Runs the tenant’s configured adapters exhaustively and returns each one’s untouched result list and prose alongside the fused ranking, so an operator can weigh sources against each other. Never cached. Spends real egress and, with a metered adapter, real money — gated by agent_orchestrator.agents.manage.',
      responses: [{ status: 200, description: 'Per-adapter comparison', schema: previewResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing agent_orchestrator.agents.manage',
          schema: z.object({ error: z.string() }),
        },
        { status: 429, description: 'Tenant rate limit exceeded', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
