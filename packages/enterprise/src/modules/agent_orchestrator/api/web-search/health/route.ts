import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  probeAgeMs,
  probeTtlMs,
  readCachedProbes,
  resolveHealthCache,
  writeCachedProbes,
  type CachedProbe,
} from '../../../lib/webSearch/healthCache'
import { selectProbeTargets, type ProbeCost } from '../../../lib/webSearch/healthProbePlan'
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

/** Spending money is a settings-grade act, not a reviewer-grade one. */
const PROBE_FEATURE = 'agent_orchestrator.agents.manage'

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
  /** What calling this adapter's health check costs. */
  probeCost: ProbeCost
  /** When this row was last actually called — carried across from the cache. */
  checkedAt: string | null
}

type WebSearchHealthResponse = {
  /** Worst case across enabled adapters, for an at-a-glance badge. */
  status: 'ok' | 'degraded' | 'not_configured'
  /** Where the policy came from: a tenant override or the deployment default. */
  source: 'tenant' | 'instance'
  adapters: AdapterHealthRow[]
  problems: Array<{ id: string | null; packageName: string; reason: string }>
  /** True only when EVERY enabled adapter was called in this response. */
  probed: boolean
  checkedAt: string
}

/**
 * Collapses concurrent live probes. Two operators pressing Recheck at the same
 * moment must spend one credit and spawn one browser sidecar, not two.
 */
const inFlightProbes = new Map<string, Promise<Map<string, CachedProbe>>>()

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const probeParam = url.searchParams.get('probe')
  // Opening a screen must not spend money. `auto` verifies only the adapters
  // whose health check is free — which is most of them, because a probe's cost
  // is not the same as a search's — and reuses an operator-initiated probe for
  // the rest. `1` is the explicit, gated, billable path.
  const mode: 'readiness' | 'auto' | 'live' =
    probeParam === '1' ? 'live' : probeParam === 'auto' ? 'auto' : 'readiness'
  const force = url.searchParams.get('force') === '1'
  const requestedAdapter = url.searchParams.get('adapter')

  const container = await createRequestContainer()
  const tenantId = auth.tenantId ?? null

  if (mode === 'live') {
    const rbac = container.resolve('rbacService') as {
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<boolean>
    }
    const allowed = await rbac.userHasAllFeatures(auth.sub, [PROBE_FEATURE], {
      tenantId,
      organizationId: auth.orgId ?? null,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Running a live probe requires agent_orchestrator.agents.manage.' },
        { status: 403 },
      )
    }
  }

  const settings = await resolveWebSearchSettings(container, tenantId)
  const { engine, problems } = buildWebSearchEngine({ container, settings, tenantId })

  const enabledIds = new Set(
    settings.policy.adapters.filter((entry) => entry.enabled).map((entry) => entry.id),
  )
  const cache = resolveHealthCache(container)
  const nowMs = Date.now()

  // The engine is per-request and adapters may hold OS resources (the browser
  // tier spawns a sidecar to answer `ping`), so every probe must hand them back.
  let rows: AdapterHealthRow[]
  try {
    // Readiness first: synchronous, I/O-free by contract, and it is what tells
    // us each adapter's probe cost before deciding what may be called.
    const readiness = await engine.health({ probe: false })
    const cached =
      mode === 'readiness'
        ? new Map<string, CachedProbe>()
        : await readCachedProbes(
            cache,
            tenantId,
            readiness.map((report) => report.id),
          )

    const probeTargets = selectProbeTargets({
      candidates: readiness.map((report) => ({
        id: report.id,
        ready: report.ready,
        probeCost: (report.probeCost ?? 'billable') as ProbeCost,
      })),
      ageMsById: new Map(readiness.map((report) => [report.id, probeAgeMs(cached.get(report.id), nowMs)])),
      mode,
      force,
      ttlMs: probeTtlMs(),
      adapterId: requestedAdapter,
    })

    let fresh = new Map<string, CachedProbe>()
    if (probeTargets.length > 0) {
      const flightKey = `${tenantId ?? 'global'}:${probeTargets.slice().sort().join(',')}`
      const existing = inFlightProbes.get(flightKey)
      if (existing) {
        fresh = await existing
      } else {
        const flight = (async () => {
          const probed = await engine.health({
            probe: true,
            only: probeTargets,
            maxProbeCost: mode === 'auto' ? 'free' : 'billable',
          })
          const collected = new Map<string, CachedProbe>()
          const checkedAt = new Date().toISOString()
          for (const report of probed) {
            if (!report.probed) continue
            collected.set(report.id, {
              ok: report.ok,
              detail: report.detail ?? null,
              latencyMs: report.latencyMs ?? null,
              probeCost: (report.probeCost ?? 'billable') as ProbeCost,
              checkedAt,
            })
          }
          await writeCachedProbes(cache, tenantId, collected)
          return collected
        })()
        inFlightProbes.set(flightKey, flight)
        try {
          fresh = await flight
        } finally {
          inFlightProbes.delete(flightKey)
        }
      }
    }

    rows = readiness.map((report) => {
      const cost = (report.probeCost ?? 'billable') as ProbeCost
      // The default mode keeps reporting configuration only — its response must
      // stay what every existing caller already parses, cache or no cache.
      const probe = mode === 'readiness' ? undefined : fresh.get(report.id) ?? cached.get(report.id)
      const usable = report.ready && probe && probeAgeMs(probe, nowMs) < probeTtlMs()
      return {
        id: report.id,
        enabled: enabledIds.has(report.id),
        ready: report.ready,
        ok: usable ? probe!.ok : report.ok,
        detail: usable ? probe!.detail : report.detail ?? null,
        latencyMs: usable ? probe!.latencyMs : report.latencyMs ?? null,
        probed: Boolean(usable),
        probeCost: cost,
        checkedAt: usable ? probe!.checkedAt : null,
      }
    })
  } finally {
    await engine.dispose().catch(() => undefined)
  }

  const enabled = rows.filter((row) => row.enabled)
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
    adapters: rows,
    problems: problems.map((problem) => ({ ...problem })),
    probed: enabled.length > 0 && enabled.every((row) => row.probed),
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
      probeCost: z.enum(['free', 'heavy', 'billable']),
      checkedAt: z.string().nullable(),
    }),
  ),
  problems: z.array(
    z.object({ id: z.string().nullable(), packageName: z.string(), reason: z.string() }),
  ),
  probed: z.boolean(),
  checkedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent web-search adapter health',
  methods: {
    GET: {
      summary: 'Report every installed web-search adapter and its health',
      description:
        'Builds the tenant-resolved adapter set and reports one row per installed adapter. `probe` selects how much verification is done: omitted reports configuration readiness only; `auto` additionally calls every adapter whose health check is free and reuses a cached result for the ones that cost; `1` calls everything live and requires agent_orchestrator.agents.manage, because a metered source bills for it. `force=1` overrides the cached result of a costly adapter once it is older than 30 seconds, and `adapter=<id>` limits the live call to one adapter. Top-level `probed` is true only when every enabled adapter was verified. Reading is gated by agent_orchestrator.proposals.view.',
      responses: [{ status: 200, description: 'Web-search adapter health', schema: healthSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description:
            'Missing agent_orchestrator.proposals.view, or agent_orchestrator.agents.manage for probe=1',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
