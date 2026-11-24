import { expect, test } from '@playwright/test'

/**
 * TC-MAINT-001: Maintenance mode is inert while no window is active (spec M03, M11).
 * Read-only: it never changes the instance-wide maintenance state, so it is safe in shared runs.
 */
test.describe('TC-MAINT-001: Maintenance status without an active window', () => {
  test('public status endpoint answers with the minimal inactive body', async ({ request }) => {
    const response = await request.get('/api/maintenance/status')
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['active', 'message', 'retryAfter', 'until'])
    test.skip(body.active === true, 'A maintenance window is active on this instance; the inactive assertions do not apply.')
    expect(body).toEqual({ active: false, until: null, retryAfter: null, message: null })
  })

  test('API, health and pages are not gated without a window', async ({ request }) => {
    const status = await request.get('/api/maintenance/status')
    test.skip((await status.json()).active === true, 'A maintenance window is active on this instance.')
    const health = await request.get('/api/healthz')
    expect(health.status()).toBeLessThan(500)
    expect(health.headers()['x-maintenance-mode']).toBeUndefined()
    const login = await request.get('/backend/login', { maxRedirects: 0 })
    expect(login.status()).not.toBe(503)
    expect(login.headers()['x-maintenance-mode']).toBeUndefined()
  })
})
