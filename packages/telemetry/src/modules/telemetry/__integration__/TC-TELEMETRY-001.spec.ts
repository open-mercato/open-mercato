import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-TELEMETRY-001: browser RUM span-ingest proxy contract.
 *
 * Route: POST /api/telemetry/browser-traces (requireAuth). The proxy accepts
 * OTLP/HTTP batches from authenticated backoffice sessions and forwards them
 * to the configured collector. It is deliberately fire-and-forget: when browser
 * telemetry is disabled for the environment (the default, and the state of the
 * integration test env) it accepts and drops with 204 so a stale client never
 * retries. Oversized payloads are refused with 413 before buffering.
 */
test.describe('TC-TELEMETRY-001: browser traces proxy', () => {
  let token = ''

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('unauthenticated span ingest is rejected', async ({ request }) => {
    const res = await request.post('/api/telemetry/browser-traces', {
      headers: { 'Content-Type': 'application/json' },
      data: { resourceSpans: [] },
    })
    expect(res.status(), 'span ingest must not be an unauthenticated endpoint').toBe(401)
  })

  test('authenticated batch is accepted', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/telemetry/browser-traces', {
      token,
      data: { resourceSpans: [] },
    })
    // 204 = telemetry disabled for the environment (accept-and-drop, the
    // default here); 202 = forwarded to a configured collector.
    expect([204, 202], 'an authenticated batch is always accepted').toContain(res.status())
  })

  test('an oversized payload is refused with 413', async ({ request }) => {
    const oversized = `{"resourceSpans":["${'x'.repeat(1_100_000)}"]}`
    const res = await request.post('/api/telemetry/browser-traces', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: oversized,
    })
    expect(res.status(), 'payloads above the 1 MB cap are refused').toBe(413)
  })
})
