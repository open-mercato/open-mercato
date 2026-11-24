import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'

/**
 * TC-MAINT-002: Maintenance window gates API and pages; bypass and status work (spec M01–M06).
 *
 * Exclusive run only (OM_INTEGRATION_MAINTENANCE_EXCLUSIVE=1): the window is instance-wide.
 * The test runner must share the app's maintenance store (same host/state dir or Redis).
 */
function maintenance(args: string[]): string {
  return execFileSync('yarn', ['mercato', 'maintenance', ...args], {
    cwd: process.env.OM_TEST_APP_ROOT?.trim() || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, OM_APP_ROOT: resolveAppRoot() },
  })
}

function extractJson(output: string): Record<string, unknown> {
  const line = output.split('\n').find((entry) => entry.trim().startsWith('{"version"'))
  if (!line) throw new Error(`[internal] No JSON output from the maintenance CLI: ${output}`)
  return JSON.parse(line)
}

async function waitForGate(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('[internal] Maintenance gate did not converge within the poll interval')
}

test.describe('TC-MAINT-002: Maintenance window gates traffic', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })

  test('gates API and pages, honors bypass, and reopens on off', async ({ request }) => {
    let windowOn = false
    try {
      const on = extractJson(maintenance(['on', '--title', 'QA <b>upgrade</b>', '--message', 'Back <script>soon</script>', '--duration', '30m', '--allow-bypass', '--json']))
      windowOn = true
      const token = String(on.bypassToken)

      await waitForGate(async () => (await request.get('/api/customers/people')).status() === 503)

      const api = await request.post('/api/sales/orders', { data: {} })
      expect(api.status()).toBe(503)
      expect(Number(api.headers()['retry-after'])).toBeGreaterThanOrEqual(30)
      expect(api.headers()['cache-control']).toContain('no-store')
      expect((await api.json()).code).toBe('MAINTENANCE_MODE')

      const loginApi = await request.post('/api/auth/login', { form: { email: 'nobody@example.com', password: 'x' } })
      expect(loginApi.status()).toBe(503)

      const page = await request.get('/backend')
      expect(page.status()).toBe(503)
      const html = await page.text()
      expect(html).toContain('QA &lt;b&gt;upgrade&lt;/b&gt;')
      expect(html).not.toContain('<script>soon</script>')

      const status = await request.get('/api/maintenance/status')
      expect(status.status()).toBe(200)
      expect(await status.json()).toMatchObject({ active: true, message: 'Back <script>soon</script>' })
      expect((await request.get('/api/healthz')).headers()['x-maintenance-mode']).toBeUndefined()

      const bypassed = await request.get('/api/maintenance/status', { headers: { 'X-Maintenance-Bypass': token } })
      expect(bypassed.status()).toBe(200)
      const bypassApi = await request.get('/api/customers/people', { headers: { 'X-Maintenance-Bypass': token } })
      expect(bypassApi.status()).not.toBe(503)
      const wrongBypass = await request.get('/api/customers/people', { headers: { 'X-Maintenance-Bypass': 'wrong' } })
      expect(wrongBypass.status()).toBe(503)

      const form = await request.post('/maintenance-bypass', { form: { token }, maxRedirects: 0 })
      expect(form.status()).toBe(303)
      expect(form.headers()['location']).toMatch(/\/backend$/)
      expect(form.headers()['set-cookie']).toMatch(/om_maintenance_bypass=.+HttpOnly/i)
      const rejected = await request.post('/maintenance-bypass', { form: { token: 'wrong' }, maxRedirects: 0 })
      expect(rejected.status()).toBe(403)

      maintenance(['off'])
      windowOn = false
      await waitForGate(async () => (await request.get('/api/customers/people')).status() !== 503)
      const statusJson = extractJson(maintenance(['status', '--json']))
      expect(statusJson.active).toBe(false)
      expect(Array.isArray(statusJson.history) && statusJson.history.length > 0).toBe(true)
    } finally {
      if (windowOn) maintenance(['off'])
    }
  })
})
