import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'
import {
  OTEL_RECEIVER_PORT_BUSY_REASON,
  OTEL_SETTINGS_PATH,
  OTEL_TEST_SPAN_PATH,
  englishMessage,
  readOtelSettings,
  restoreOtelSettings,
  saveOtelSettings,
  spansOf,
  startFakeOtlpReceiver,
  type FakeOtlpReceiver,
  type OtelExportSettingsBody,
} from './helpers/otelExportFixtures'

/**
 * TC-AGENT-OTEL-001: OTel export settings API, test-span endpoint and settings page.
 *
 * - GET returns the tenant settings, the row version and a redacted deployment
 *   view: flags only, never the endpoint URL, the exporter headers or the
 *   trace link template.
 * - PUT round-trips with optimistic locking (a stale version is rejected with
 *   409), refuses `content: 'full'` with 422 while the deployment denies content
 *   export, and refuses a writer without `agents.manage` with 403.
 * - The test-span endpoint returns 409 `otel_export_disabled` when the deployment
 *   switch is off. When the app runs with export on (endpoint
 *   `http://127.0.0.1:4319/v1/traces`), a fake receiver on that port gets the
 *   `om.export.test` span and the call answers `{ ok: true, httpStatus, latencyMs }`.
 *   An immediate second call is rate-limited with 429 — unless the app runs
 *   with rate limiting disabled (`OM_INTEGRATION_TEST`, which the ephemeral
 *   runner sets), in which case the spec records a note; the 429 path is
 *   covered by `__tests__/otel-export-settings-api.test.ts`.
 *
 * The tenant's previous settings are written back in `finally`; when the tenant
 * had none, that leaves a tenant row equal to the disabled default (there is no
 * DELETE route). A screenshot of the settings page is attached as evidence.
 */

const RATE_LIMIT_DISABLED_NOTE =
  'rate limiting is disabled in this app (OM_INTEGRATION_TEST); the 429 ceiling is covered by otel-export-settings-api.test.ts'
const DEPLOYMENT_SECRET_KEYS = ['endpoint', 'headers', 'traceUrlTemplate', 'template', 'url']

test.describe('TC-AGENT-OTEL-001: OTel export settings and test span', () => {
  test('settings API redacts, round-trips, locks, validates and gates writes', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const initial = await readOtelSettings(request, adminToken)
    const previousSettings = initial.settings ?? null
    let restricted: ScopedAgentUser | null = null

    try {
      expect(['tenant', 'default']).toContain(initial.source)
      expect(typeof initial.deployment?.enabled).toBe('boolean')
      expect(typeof initial.deployment?.endpointConfigured).toBe('boolean')
      expect(typeof initial.deployment?.traceLinkConfigured).toBe('boolean')
      for (const key of DEPLOYMENT_SECRET_KEYS) {
        expect(initial.deployment ?? {}, `deployment view never carries "${key}"`).not.toHaveProperty(key)
      }
      const rawBody = JSON.stringify(initial)
      expect(rawBody, 'no endpoint URL leaks into the settings body').not.toMatch(/https?:\/\//)
      expect(rawBody).not.toContain('{traceId}')

      const firstSettings: OtelExportSettingsBody = {
        enabled: true,
        content: 'none',
        exportUserIds: false,
        agentAllowlist: ['it.otel_export'],
      }
      const firstSave = await saveOtelSettings(request, adminToken, firstSettings, initial.updatedAt)
      expect(firstSave.status(), await firstSave.text()).toBe(200)
      const firstSaved = await readJsonSafe<{ updatedAt?: string | null; source?: string }>(firstSave)
      expect(firstSaved?.source).toBe('tenant')
      expect(typeof firstSaved?.updatedAt).toBe('string')

      const reread = await readOtelSettings(request, adminToken)
      expect(reread.source).toBe('tenant')
      expect(reread.settings?.enabled).toBe(true)
      expect(reread.settings?.content).toBe('none')
      expect(reread.settings?.agentAllowlist).toEqual(['it.otel_export'])

      const secondSave = await saveOtelSettings(
        request,
        adminToken,
        { enabled: false, content: 'none', exportUserIds: true },
        reread.updatedAt,
      )
      expect(secondSave.status(), await secondSave.text()).toBe(200)

      const staleSave = await saveOtelSettings(request, adminToken, firstSettings, firstSaved!.updatedAt)
      expect(staleSave.status(), 'a save carrying a superseded version is rejected').toBe(409)
      const afterStale = await readOtelSettings(request, adminToken)
      expect(afterStale.settings?.enabled).toBe(false)
      expect(afterStale.settings?.exportUserIds).toBe(true)

      const fullContent = await saveOtelSettings(
        request,
        adminToken,
        { enabled: true, content: 'full', exportUserIds: false },
        afterStale.updatedAt,
      )
      expect(fullContent.status(), await fullContent.text()).toBe(422)

      const invalid = await apiRequest(request, 'PUT', OTEL_SETTINGS_PATH, {
        token: adminToken,
        data: { enabled: 'yes', content: 'everything' },
      })
      expect(invalid.status()).toBe(400)

      restricted = await createScopedAgentUser(request, adminToken, {
        label: 'otel-export',
        features: ['agent_orchestrator.trace.view'],
      })
      const restrictedRead = await apiRequest(request, 'GET', OTEL_SETTINGS_PATH, { token: restricted.token })
      expect(restrictedRead.status()).toBe(200)
      const restrictedSave = await saveOtelSettings(
        request,
        restricted.token,
        { enabled: true, content: 'none', exportUserIds: false },
        afterStale.updatedAt,
      )
      expect(restrictedSave.status(), 'writing needs agents.manage').toBe(403)

      await login(page, 'admin')
      await page.goto('/backend/settings/otel-export', { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByText(englishMessage('agent_orchestrator.settings.otelExport.deployment'), { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText(englishMessage('agent_orchestrator.settings.otelExport.settings'), { exact: true }).first(),
      ).toBeVisible()
      await test.info().attach('otel-export-settings', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteScopedAgentUser(request, adminToken, restricted).catch(() => undefined)
      await restoreOtelSettings(request, adminToken, previousSettings)
    }
  })

  test('the test-span endpoint reports disabled, delivers to the receiver and is rate limited', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const settings = await readOtelSettings(request, adminToken)

    if (!settings.deployment?.enabled) {
      const disabled = await apiRequest(request, 'POST', OTEL_TEST_SPAN_PATH, { token: adminToken, data: {} })
      expect(disabled.status()).toBe(409)
      const body = await readJsonSafe<{ error?: string }>(disabled)
      expect(body?.error).toBe('otel_export_disabled')
      return
    }

    const receiver: FakeOtlpReceiver | null = await startFakeOtlpReceiver()
    test.skip(!receiver, OTEL_RECEIVER_PORT_BUSY_REASON)
    try {
      const first = await apiRequest(request, 'POST', OTEL_TEST_SPAN_PATH, { token: adminToken, data: {} })
      expect(first.status(), await first.text()).toBe(200)
      const result = await readJsonSafe<{ ok?: boolean; httpStatus?: number | null; latencyMs?: number }>(first)
      expect(result?.ok).toBe(true)
      expect(result?.httpStatus).toBe(200)
      expect(typeof result?.latencyMs).toBe('number')

      expect(receiver!.requests).toHaveLength(1)
      expect(receiver!.requests[0].path).toBe('/v1/traces')
      expect(receiver!.requests[0].contentEncoding).toBe('gzip')
      expect(spansOf(receiver!.requests[0].body).map((span) => span.name)).toEqual(['om.export.test'])

      const second = await apiRequest(request, 'POST', OTEL_TEST_SPAN_PATH, { token: adminToken, data: {} })
      expect([200, 429], 'one test span per tenant per window').toContain(second.status())
      if (second.status() !== 429) {
        test.info().annotations.push({ type: 'note', description: RATE_LIMIT_DISABLED_NOTE })
      }

      const health = await readOtelSettings(request, adminToken)
      expect(typeof health.health?.lastSuccessAt).toBe('string')
    } finally {
      await receiver?.close()
    }
  })
})
