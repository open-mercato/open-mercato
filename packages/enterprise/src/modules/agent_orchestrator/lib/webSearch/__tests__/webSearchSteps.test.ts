import type { SearchStep } from '@open-mercato/web-research'
import { toProgressPayload, type WebSearchProgressScope } from '../steps'

const scope: WebSearchProgressScope = {
  runId: 'run-1',
  agentId: 'deals.web_researcher',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  query: 'open mercato pricing',
}

const step = (overrides: Partial<SearchStep> = {}): SearchStep => ({
  seq: 3,
  at: '2026-07-26T00:00:00.000Z',
  phase: 'adapter',
  event: 'blocked',
  adapterId: 'serp-html',
  ...overrides,
})

describe('toProgressPayload', () => {
  it('carries the adapter, outcome and reason an operator needs', () => {
    const payload = toProgressPayload(
      step({ detail: 'HTTP 429 from html.duckduckgo.com', metrics: { latencyMs: 812, resultCount: 0 } }),
      scope,
    )

    expect(payload).toMatchObject({
      runId: 'run-1',
      agentId: 'deals.web_researcher',
      sequence: 3,
      phase: 'adapter',
      event: 'blocked',
      adapterId: 'serp-html',
      detail: 'HTTP 429 from html.duckduckgo.com',
      latencyMs: 812,
      resultCount: 0,
    })
  })

  it('never carries a result list, only a summary', () => {
    const payload = toProgressPayload(step({ event: 'ok', metrics: { resultCount: 10 } }), scope)
    expect(Object.keys(payload)).not.toContain('results')
  })

  // The SSE route truncates a frame at 4KB; a long adapter reason must not push
  // the payload past it and cost the operator the whole step.
  it('truncates a long detail and a long query', () => {
    const payload = toProgressPayload(step({ detail: 'x'.repeat(1000) }), {
      ...scope,
      query: 'q'.repeat(500),
    })

    expect(payload.detail?.length).toBeLessThanOrEqual(240)
    expect(payload.query.length).toBeLessThanOrEqual(120)
    expect(JSON.stringify(payload).length).toBeLessThan(4096)
  })

  it('falls back to the query as correlation id outside a run', () => {
    const payload = toProgressPayload(step(), { ...scope, runId: null })
    expect(payload.id).toBe('open mercato pricing')
    expect(payload.runId).toBeNull()
  })

  it('nulls absent optional fields rather than omitting them', () => {
    const payload = toProgressPayload(step({ adapterId: undefined, detail: undefined }), scope)
    expect(payload.adapterId).toBeNull()
    expect(payload.detail).toBeNull()
    expect(payload.latencyMs).toBeNull()
  })
})
