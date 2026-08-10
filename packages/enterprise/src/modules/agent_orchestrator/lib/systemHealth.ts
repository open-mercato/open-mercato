/**
 * Rolls the orchestrator's four runtime dependencies into one tile-sized model.
 *
 * The overview used to spend a full-width card on web search alone, while MCP
 * and OpenCode — the two things whose absence stops an agent running at all —
 * were not on the page. One tile carries all four, so "is the fleet's plumbing
 * up" is a glance rather than a tour.
 *
 * PURE. The fetching lives in the component; the verdicts live here so they can
 * be tested without a DOM, and so the rollup rule is written once.
 */

/** Ordered worst-last: the rollup is `max` over this scale. */
export type HealthState = 'ok' | 'unknown' | 'degraded' | 'down'

const SEVERITY: Record<HealthState, number> = { ok: 0, unknown: 1, degraded: 2, down: 3 }

export type HealthIndicatorId = 'webSearch' | 'mcp' | 'opencode' | 'opencodeMcp'

export type HealthIndicator = {
  id: HealthIndicatorId
  state: HealthState
  /** Short, already-resolved supporting text, or null. Never a translation key. */
  detail: string | null
}

export type WebSearchHealthPayload = {
  status: 'ok' | 'degraded' | 'not_configured'
  probed?: boolean
  adapters: Array<{ id: string; enabled: boolean; ready: boolean; ok: boolean; detail: string | null; latencyMs: number | null }>
  problems: Array<{ id: string | null; packageName: string; reason: string }>
}

export type AiRuntimeHealthPayload = {
  status?: 'ok' | 'error'
  opencode?: { healthy: boolean; version: string }
  mcp?: Record<string, { status: string; error?: string }>
  mcpHealth?: { healthy: boolean; status?: string; tools?: number }
  message?: string
}

export function isWebSearchHealthPayload(value: unknown): value is WebSearchHealthPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'string' &&
    Array.isArray((value as { adapters?: unknown }).adapters)
  )
}

export function isAiRuntimeHealthPayload(value: unknown): value is AiRuntimeHealthPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return 'status' in candidate || 'opencode' in candidate || 'mcpHealth' in candidate
}

/**
 * Web search is the one dependency whose absence is a CHOICE: an installation
 * that never enabled an adapter is configured correctly, so `not_configured`
 * reports as `unknown` rather than as a fault. And an `ok` the server did not
 * probe means "configured", never "working" — the overview must not bill a
 * metered adapter on a page view, so it may not claim health it did not check.
 */
export function deriveWebSearchIndicator(payload: WebSearchHealthPayload | null): HealthIndicator {
  if (!payload) return { id: 'webSearch', state: 'unknown', detail: null }
  if (payload.status === 'not_configured') return { id: 'webSearch', state: 'unknown', detail: null }

  const enabled = payload.adapters.filter((adapter) => adapter.enabled)
  const failing = enabled.filter((adapter) => adapter.ready && !adapter.ok)
  if (payload.status === 'degraded' || failing.length > 0) {
    return {
      id: 'webSearch',
      state: 'degraded',
      detail: failing.length > 0 ? failing.map((adapter) => adapter.id).join(', ') : null,
    }
  }
  return {
    id: 'webSearch',
    state: payload.probed === false ? 'unknown' : 'ok',
    detail: enabled.length > 0 ? enabled.map((adapter) => adapter.id).join(', ') : null,
  }
}

/**
 * MCP, OpenCode, and the binding between them. They are reported separately
 * because they fail separately and are fixed in different places: an MCP server
 * that is up while OpenCode cannot see it is a config problem, not an outage,
 * and the tile should not blur the two into one amber dot.
 */
export function deriveRuntimeIndicators(payload: AiRuntimeHealthPayload | null): HealthIndicator[] {
  if (!payload) {
    return [
      { id: 'mcp', state: 'unknown', detail: null },
      { id: 'opencode', state: 'unknown', detail: null },
      { id: 'opencodeMcp', state: 'unknown', detail: null },
    ]
  }

  const mcp: HealthIndicator = payload.mcpHealth
    ? {
        id: 'mcp',
        state: payload.mcpHealth.healthy ? 'ok' : 'down',
        detail:
          payload.mcpHealth.healthy && typeof payload.mcpHealth.tools === 'number'
            ? `${payload.mcpHealth.tools}`
            : null,
      }
    : { id: 'mcp', state: 'unknown', detail: null }

  const opencode: HealthIndicator = payload.opencode
    ? {
        id: 'opencode',
        state: payload.opencode.healthy ? 'ok' : 'down',
        detail: payload.opencode.version || null,
      }
    : {
        id: 'opencode',
        // A top-level `error` IS the OpenCode probe failing — that is the branch
        // `handleOpenCodeHealth` returns when the client throws.
        state: payload.status === 'error' ? 'down' : 'unknown',
        detail: payload.message ?? null,
      }

  const bindings = Object.entries(payload.mcp ?? {})
  let opencodeMcp: HealthIndicator
  if (bindings.length === 0) {
    opencodeMcp = { id: 'opencodeMcp', state: 'unknown', detail: null }
  } else {
    const broken = bindings.filter(([, binding]) => binding.status !== 'connected')
    opencodeMcp = {
      id: 'opencodeMcp',
      state: broken.length === 0 ? 'ok' : broken.length === bindings.length ? 'down' : 'degraded',
      detail: broken.length > 0 ? broken.map(([name]) => name).join(', ') : null,
    }
  }

  return [mcp, opencode, opencodeMcp]
}

/**
 * The tile's headline. Worst-of, not an average: one dead dependency is the
 * thing the reader needs to see, and averaging it against three healthy ones
 * would hide exactly the case the tile exists for.
 */
export function rollupHealth(indicators: readonly HealthIndicator[]): HealthState {
  return indicators.reduce<HealthState>(
    (worst, indicator) => (SEVERITY[indicator.state] > SEVERITY[worst] ? indicator.state : worst),
    'ok',
  )
}
