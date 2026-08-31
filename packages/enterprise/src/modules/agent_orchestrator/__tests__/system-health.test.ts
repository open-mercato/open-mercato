/**
 * The overview's one health tile. The rules worth pinning are the ones that
 * decide whether an operator trusts it: it must never claim health it did not
 * check, never average a dead dependency away, never report a deliberate
 * non-configuration as a fault, and never confuse "we did not check" with "the
 * health path itself is broken".
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
  probed: true,
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
    expect(deriveWebSearchIndicator(webSearch({ adapters: [adapter({ probed: false })] })).state).toBe(
      'unknown',
    )
    expect(deriveWebSearchIndicator(webSearch()).state).toBe('ok')
  })

  it('goes green on one verified adapter and still names the unverified one', () => {
    // The engine races adapters, so one verified answer means the tool works.
    // Holding the whole tile at `unknown` because a billable adapter went
    // unprobed reports nothing at all — which is the defect this fixes.
    const indicator = deriveWebSearchIndicator(
      webSearch({
        adapters: [
          adapter({ id: 'model-native', probed: true, ok: true }),
          adapter({ id: 'firecrawl', probed: false, probeCost: 'billable' }),
        ],
      }),
    )
    expect(indicator.state).toBe('ok')
    expect(indicator.detail).toBe('model-native')
    expect(indicator.unverified).toEqual(['firecrawl'])
  })

  it('treats a deliberate non-configuration as unknown, not as a fault', () => {
    expect(deriveWebSearchIndicator(webSearch({ status: 'not_configured' })).state).toBe('unknown')
  })

  it('names the failing adapter rather than only saying degraded', () => {
    const indicator = deriveWebSearchIndicator(
      webSearch({
        adapters: [adapter({ id: 'serp', ok: false }), adapter({ id: 'exa' })],
      }),
    )
    expect(indicator.state).toBe('degraded')
    expect(indicator.detail).toBe('serp')
  })

  it('is down only when every enabled adapter is known to fail', () => {
    const allFail = deriveWebSearchIndicator(
      webSearch({ adapters: [adapter({ id: 'serp', ok: false }), adapter({ id: 'exa', ok: false })] }),
    )
    expect(allFail.state).toBe('down')

    // One failure plus one adapter nobody called is not proof the tool is dead.
    const someUnverified = deriveWebSearchIndicator(
      webSearch({
        adapters: [adapter({ id: 'serp', ok: false }), adapter({ id: 'firecrawl', probed: false })],
      }),
    )
    expect(someUnverified.state).toBe('degraded')
  })

  it('counts a misconfigured adapter as a fault without needing a probe', () => {
    // Readiness is free to know, and "no API key" is a fault either way.
    const indicator = deriveWebSearchIndicator(
      webSearch({ adapters: [adapter({ id: 'tavily', ready: false, ok: false, probed: false })] }),
    )
    expect(indicator.state).toBe('down')
    expect(indicator.detail).toBe('tavily')
  })

  it('ignores an adapter that is installed but disabled', () => {
    const indicator = deriveWebSearchIndicator(
      webSearch({ adapters: [adapter(), adapter({ id: 'exa', enabled: false, ok: false })] }),
    )
    expect(indicator.state).toBe('ok')
  })

  it('reports unknown when the fetch produced nothing', () => {
    expect(deriveWebSearchIndicator(null).state).toBe('unknown')
  })

  it('separates a broken health path from an unchecked one', () => {
    expect(deriveWebSearchIndicator(null, true).state).toBe('error')
  })
})

describe('deriveRuntimeIndicators', () => {
  const byId = (payload: AiRuntimeHealthPayload | null, fetchFailed = false) =>
    Object.fromEntries(deriveRuntimeIndicators(payload, fetchFailed).map((row) => [row.id, row]))

  it('separates the harness from its capability transport', () => {
    const rows = byId({
      status: 'ok',
      harness: { healthy: true, detail: 'stdio one-off', mode: 'one-off' },
      capability: { driver: 'mcp-http', healthy: false, detail: 'connection refused' },
    })
    expect(rows.harness.state).toBe('ok')
    expect(rows.harness.runtimeMode).toBe('one-off')
    expect(rows.capability.state).toBe('down')
    expect(rows.capability.detail).toBe('connection refused')
  })

  it('carries standalone mode and the capability tool count', () => {
    const rows = byId({
      status: 'ok',
      harness: { healthy: true, detail: 'business-harness', mode: 'standalone' },
      capability: { driver: 'mcp-http', healthy: true, tools: 98 },
    })
    expect(rows.harness.runtimeMode).toBe('standalone')
    expect(rows.capability.detail).toBe('mcp-http: 98')
  })

  it('reports every runtime indicator as unknown when the fetch produced nothing', () => {
    const rows = byId(null)
    expect([rows.harness.state, rows.capability.state]).toEqual(['unknown', 'unknown'])
  })

  it('reports error, not unknown, when the runtime health call itself failed', () => {
    const rows = byId(null, true)
    expect([rows.harness.state, rows.capability.state]).toEqual(['error', 'error'])
  })

  it('does not invent a verdict for a dependency the payload never mentioned', () => {
    const rows = byId({ status: 'ok', harness: { healthy: true } })
    expect(rows.harness.state).toBe('ok')
    expect(rows.capability.state).toBe('unknown')
  })
})

describe('rollupHealth', () => {
  it('surfaces the worst dependency rather than averaging it away', () => {
    expect(
      rollupHealth([
        { id: 'webSearch', state: 'ok', detail: null },
        { id: 'capability', state: 'ok', detail: null },
        { id: 'harness', state: 'down', detail: null },
      ]),
    ).toBe('down')
  })

  it('ranks error above down above degraded above unknown above ok', () => {
    expect(rollupHealth([{ id: 'capability', state: 'unknown', detail: null }])).toBe('unknown')
    expect(
      rollupHealth([
        { id: 'capability', state: 'unknown', detail: null },
        { id: 'harness', state: 'degraded', detail: null },
      ]),
    ).toBe('degraded')
    // Pins the SEVERITY entry: a state missing from the map would make every
    // comparison against it false, and the rollup would swallow it silently.
    expect(
      rollupHealth([
        { id: 'capability', state: 'ok', detail: null },
        { id: 'webSearch', state: 'error', detail: null },
      ]),
    ).toBe('error')
    expect(
      rollupHealth([
        { id: 'capability', state: 'down', detail: null },
        { id: 'webSearch', state: 'error', detail: null },
      ]),
    ).toBe('error')
  })

  it('is ok only when everything is', () => {
    expect(
      rollupHealth([
        { id: 'webSearch', state: 'ok', detail: null },
        { id: 'capability', state: 'ok', detail: null },
      ]),
    ).toBe('ok')
  })
})
