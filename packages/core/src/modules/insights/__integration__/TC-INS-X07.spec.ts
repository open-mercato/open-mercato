import { expect, test } from '@playwright/test'
import { DEAL_PROCESS_KEY } from './helpers/xrayApi'
import { XRAY_ANALYTICS_BASE, cleanupXrayAnalyticsFixture, createXrayAnalyticsFixture, createXrayOrganization, xrayCall } from './helpers/xrayAnalyticsApi'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * TC-INS-X07: Process X-Ray live query limits answer 422 with a hint
 * Covers:
 *   - GET /api/insights/xray/{processKey}/map, /bottlenecks, /cases with a custom window
 *
 * A custom window longer than 180 days is refused with 422 `window_too_large` and the hint
 * `run_background_analysis` (no counts in the body), before any event is read; exactly 180
 * days is accepted. An empty or reversed window is a 400 `invalid_window`, and an unknown time
 * zone too. Runs in an organization created for the test.
 */
test.describe('TC-INS-X07: X-Ray window limits', () => {
  test('refuses windows over 180 days with a hint to run a background analysis', async ({ request }) => {
    const fixture = createXrayAnalyticsFixture()
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X07')
      const adminToken = fixture.adminToken as string
      const to = new Date(Date.UTC(2026, 9, 1))
      const window = (days: number) => `from=${encodeURIComponent(new Date(to.getTime() - days * DAY_MS).toISOString())}&to=${encodeURIComponent(to.toISOString())}`

      for (const route of ['map', 'bottlenecks', 'cases']) {
        const tooLarge = await xrayCall(request, adminToken, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/${route}?${window(181)}`, { selectedOrgId: organizationId })
        expect(tooLarge.status, `${route} over 180 days: ${tooLarge.text}`).toBe(422)
        expect(tooLarge.body).toEqual({ error: expect.any(String), code: 'window_too_large', hint: 'run_background_analysis' })
      }

      const exact = await xrayCall<{ n: number; window: { from: string; to: string } }>(request, adminToken, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map?${window(180)}`, { selectedOrgId: organizationId })
      expect(exact.status, `map over exactly 180 days: ${exact.text}`).toBe(200)
      expect(exact.body).toEqual(expect.objectContaining({ n: 0, window: expect.objectContaining({ to: to.toISOString() }) }))

      const reversed = await xrayCall(request, adminToken, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map?from=${encodeURIComponent(to.toISOString())}&to=${encodeURIComponent(new Date(to.getTime() - DAY_MS).toISOString())}`, { selectedOrgId: organizationId })
      expect(reversed).toEqual(expect.objectContaining({ status: 400, body: expect.objectContaining({ code: 'invalid_window' }) }))
      const badZone = await xrayCall(request, adminToken, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map?window=7d&timeZone=Mars%2FOlympus_Mons`, { selectedOrgId: organizationId })
      expect(badZone).toEqual(expect.objectContaining({ status: 400, body: expect.objectContaining({ code: 'invalid_window' }) }))
    } finally {
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
