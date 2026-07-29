import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveWebSearchSettings } from '../../../lib/webSearch/policy'
import { buildWebSearchEngine } from '../../../lib/webSearch/registry'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Per-adapter diagnostics for agent web search.
 *
 * Reports one row per installed adapter rather than a single verdict: with a
 * racing engine "web search is degraded" is not actionable, but "serp-html is
 * blocked, model-native is healthy, firecrawl has no key" tells an operator
 * exactly what to fix. `problems` carries adapters that failed to load at all.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.proposals.view'] },
}

type AdapterHealthRow = {
  id: string
  /** Enabled in the resolved policy for this tenant. */
  enabled: boolean
  /** Configured well enough to be callable. */
  ready: boolean
  ok: boolean
  detail: string | null
  latencyMs: number | null
  /** False when the row reports configuration only, with no call made. */
  probed: boolean
}

type WebSearchHealthResponse = {
  /** Worst case across enabled adapters, for an at-a-glance badge. */
  status: 'ok' | 'degraded' | 'not_configured'
  /** Where the policy came from: a tenant override or the deployment default. */
  source: 'tenant' | 'instance'
  adapters: AdapterHealthRow[]
  problems: Array<{ id: string | null; packageName: string; reason: string }>
  checkedAt: string
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Opening a settings screen must not spend money. A live probe calls the
  // adapter — a metered source burns a real search credit and the browser tier
  // spawns a process — so it happens only when an operator asks for it. Without
  // it the rows still report readiness, which is what "is this configured"
  // actually needs and is synchronous and free.
  const probe = new URL(req.url).searchParams.get('probe') === '1'

  const container = await createRequestContainer()
  const tenantId = auth.tenantId ?? null
  const settings = await resolveWebSearchSettings(container, tenantId)
  const { engine, problems } = buildWebSearchEngine({ container, settings, tenantId })

  const enabledIds = new Set(
    settings.policy.adapters.filter((entry) => entry.enabled).map((entry) => entry.id),
  )
  // The engine is per-request and adapters may hold OS resources (the browser
  // tier spawns a sidecar to answer `ping`), so every probe must hand them back.
  let reports
  try {
    reports = await engine.health({ probe })
  } finally {
    await engine.dispose().catch(() => undefined)
  }
  const adapters: AdapterHealthRow[] = reports.map((report) => ({
    id: report.id,
    enabled: enabledIds.has(report.id),
    ready: report.ready,
    ok: report.ok,
    detail: report.detail ?? null,
    latencyMs: report.latencyMs ?? null,
    probed: probe && report.ready,
  }))

  const enabled = adapters.filter((row) => row.enabled)
  const status: WebSearchHealthResponse['status'] =
    enabled.length === 0
      ? 'not_configured'
      : enabled.some((row) => row.ok)
        ? enabled.every((row) => row.ok)
          ? 'ok'
          : 'degraded'
        : 'degraded'

  const body: WebSearchHealthResponse = {
    status,
    source: settings.source,
    adapters,
    problems: problems.map((problem) => ({ ...problem })),
    checkedAt: new Date().toISOString(),
  }
  return NextResponse.json(body)
}

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'not_configured']),
  source: z.enum(['tenant', 'instance']),
  adapters: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      ready: z.boolean(),
      ok: z.boolean(),
      detail: z.string().nullable(),
      latencyMs: z.number().nullable(),
      probed: z.boolean(),
    }),
  ),
  problems: z.array(
    z.object({ id: z.string().nullable(), packageName: z.string(), reason: z.string() }),
  ),
  checkedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent web-search adapter health',
  methods: {
    GET: {
      summary: 'Report every installed web-search adapter and its health',
      description:
        'Builds the tenant-resolved adapter set and reports one row per installed adapter. Reports configuration readiness only unless `probe=1`, because a live check calls the adapter and costs a real search credit on a metered source. Gated by agent_orchestrator.proposals.view.',
      responses: [{ status: 200, description: 'Web-search adapter health', schema: healthSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing agent_orchestrator.proposals.view',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
