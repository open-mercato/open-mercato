/**
 * The overview's one health tile. The rules worth pinning are the ones that
 * decide whether an operator trusts it: it must never claim health it did not
 * check, never average a dead dependency away, and never report a deliberate
 * non-configuration as a fault.
 */
import {
  deriveRuntimeIndicators,
  deriveWebSearchIndicator,
  rollupHealth,
  type AiRuntimeHealthPayload,
  type WebSearchHealthPayload,
} from '../lib/systemHealth'

const adapter = (over: Partial<WebSearchHealthPayload['adapters'][number]> = {}) => ({
  id: 'serp',
  enabled: true,
  ready: true,
  ok: true,
  detail: null,
  latencyMs: null,
  ...over,
})

const webSearch = (over: Partial<WebSearchHealthPayload> = {}): WebSearchHealthPayload => ({
  status: 'ok',
  adapters: [adapter()],
  problems: [],
  ...over,
})

describe('deriveWebSearchIndicator', () => {
  it('does not claim health for something nobody contacted', () => {
    // The overview must not bill a metered adapter on a page view, so an
    // unprobed `ok` means "configured" — reporting it as healthy would be a
    // guess dressed as a fact.
    expect(deriveWebSearchIndicator(webSearch({ probed: false })).state).toBe('unknown')
    expect(deriveWebSearchIndicator(webSearch({ probed: true })).state).toBe('ok')
  })

  it('treats a deliberate non-configuration as unknown, not as a fault', () => {
    expect(deriveWebSearchIndicator(webSearch({ status: 'not_configured' })).state).toBe('unknown')
  })

  it('names the failing adapter rather than only saying degraded', () => {
    const indicator = deriveWebSearchIndicator(
      webSearch({
        probed: true,
        adapters: [adapter({ id: 'serp', ok: false }), adapter({ id: 'exa' })],
      }),
    )
    expect(indicator.state).toBe('degraded')
    expect(indicator.detail).toBe('serp')
  })

  it('ignores an adapter that is installed but disabled', () => {
    const indicator = deriveWebSearchIndicator(
      webSearch({ probed: true, adapters: [adapter({ id: 'exa', enabled: false, ok: false })] }),
    )
    expect(indicator.state).toBe('ok')
  })

  it('reports unknown when the fetch produced nothing', () => {
    expect(deriveWebSearchIndicator(null).state).toBe('unknown')
  })
})

describe('deriveRuntimeIndicators', () => {
  const byId = (payload: AiRuntimeHealthPayload | null) =>
    Object.fromEntries(deriveRuntimeIndicators(payload).map((row) => [row.id, row]))

  it('separates a healthy MCP server from an OpenCode that cannot see it', () => {
    // Different faults, different fixes — one amber dot for both would send the
    // operator to the wrong place.
    const rows = byId({
      status: 'ok',
      opencode: { healthy: true, version: '1.1.21' },
      mcpHealth: { healthy: true, tools: 12 },
      mcp: { 'open-mercato': { status: 'failed', error: 'connection refused' } },
    })
    expect(rows.mcp.state).toBe('ok')
    expect(rows.opencode.state).toBe('ok')
    expect(rows.opencodeMcp.state).toBe('down')
    expect(rows.opencodeMcp.detail).toBe('open-mercato')
  })

  it('reads a top-level error as the OpenCode probe failing', () => {
    const rows = byId({ status: 'error', message: 'OpenCode not reachable', mcpHealth: { healthy: true } })
    expect(rows.opencode.state).toBe('down')
    expect(rows.mcp.state).toBe('ok')
  })

  it('calls a partially-connected binding degraded, not down', () => {
    const rows = byId({
      status: 'ok',
      mcp: { 'open-mercato': { status: 'connected' }, other: { status: 'failed' } },
    })
    expect(rows.opencodeMcp.state).toBe('degraded')
  })

  it('reports every runtime indicator as unknown when the fetch produced nothing', () => {
    const rows = byId(null)
    expect([rows.mcp.state, rows.opencode.state, rows.opencodeMcp.state]).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ])
  })

  it('does not invent a verdict for a binding the payload never mentioned', () => {
    const rows = byId({ status: 'ok', opencode: { healthy: true, version: '1' } })
    expect(rows.opencodeMcp.state).toBe('unknown')
  })
})

describe('rollupHealth', () => {
  it('surfaces the worst dependency rather than averaging it away', () => {
    expect(
      rollupHealth([
        { id: 'webSearch', state: 'ok', detail: null },
        { id: 'mcp', state: 'ok', detail: null },
        { id: 'opencode', state: 'down', detail: null },
        { id: 'opencodeMcp', state: 'ok', detail: null },
      ]),
    ).toBe('down')
  })

  it('ranks down above degraded above unknown above ok', () => {
    expect(rollupHealth([{ id: 'mcp', state: 'unknown', detail: null }])).toBe('unknown')
    expect(
      rollupHealth([
        { id: 'mcp', state: 'unknown', detail: null },
        { id: 'opencode', state: 'degraded', detail: null },
      ]),
    ).toBe('degraded')
  })

  it('is ok only when everything is', () => {
    expect(
      rollupHealth([
        { id: 'webSearch', state: 'ok', detail: null },
        { id: 'mcp', state: 'ok', detail: null },
      ]),
    ).toBe('ok')
  })
})
