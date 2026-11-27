import { expect, test as base, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import en from '../i18n/en.json' with { type: 'json' }
import pl from '../i18n/pl.json' with { type: 'json' }

const DEFINITIONS = '/api/agent_orchestrator/processes'
const LIST_REQUEST = '**/api/agent_orchestrator/processes?*'
type DefinitionFixture = { id: string; name: string; token: string; before: unknown }

const test = base.extend<{ definition: DefinitionFixture }>({
  definition: async ({ request, page, context, baseURL }, use) => {
    const token = await getAuthToken(request, 'admin')
    const name = `TC-PROCDEF-005 ${randomUUID()}`
    const created = await apiRequest(request, 'POST', DEFINITIONS, {
      token,
      data: { name, workflowMode: 'workflow', workflowId: 'tc-procdef-005', enabled: false, triggers: [{ kind: 'manual' }] },
    })
    expect(created.status()).toBe(201)
    const body = await readJsonSafe<{ id?: string }>(created)
    expect(body?.id).toBeTruthy()
    const id = body!.id!
    try {
      const scope = getTokenContext(token)
      expect(scope.tenantId).toBeTruthy()
      expect(scope.organizationId).toBeTruthy()
      await context.addCookies([
        { name: 'auth_token', value: token, url: baseURL! },
        { name: 'om_selected_tenant', value: scope.tenantId, url: baseURL! },
        { name: 'om_selected_org', value: scope.organizationId, url: baseURL! },
      ])
      await acknowledgeGlobalNotices(page)
      const detail = await apiRequest(request, 'GET', `${DEFINITIONS}/${id}`, { token })
      expect(detail.ok()).toBeTruthy()
      const before = await readJsonSafe<unknown>(detail)
      await use({ id, name, token, before })
    } finally {
      const deleted = await apiRequest(request, 'DELETE', `${DEFINITIONS}?id=${id}`, { token })
      expect(deleted.ok(), 'owned definition is deleted').toBeTruthy()
    }
  },
})

async function observeRejections(page: Page): Promise<string[]> {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  await page.addInitScript(() => {
    const captured: string[] = []
    Object.assign(window, { processLoadRejections: captured })
    window.addEventListener('unhandledrejection', (event) => {
      captured.push(event.reason instanceof Error ? event.reason.message : String(event.reason))
    })
  })
  return pageErrors
}

async function refresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('om:event', {
      detail: { id: 'agent_orchestrator.process.execution.completed', payload: {}, timestamp: Date.now() },
    }))
  })
}

async function expectNoRejections(page: Page, pageErrors: string[]): Promise<void> {
  expect(await page.evaluate(() => (
    window as unknown as { processLoadRejections: string[] }
  ).processLoadRejections)).toEqual([])
  expect(pageErrors).toEqual([])
}

for (const [locale, dict] of [['en', en], ['pl', pl]] as const) {
  test.describe(`TC-AGENT-PROCDEF-005: load transport failures (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }])
    })

    test('live rejection and HTTP503 retain rows and recover on an actual200', async ({ page, request, definition }) => {
      const pageErrors = await observeRejections(page)
      await page.goto('/backend/processes/definitions')
      await expect(page.getByRole('row', { name: new RegExp(definition.name) })).toBeVisible()

      await page.route(LIST_REQUEST, (route) => route.abort('failed'), { times: 1 })
      await refresh(page)
      const failure = page.getByText(dict['agent_orchestrator.processDefinitions.list.error'], { exact: true })
      await expect(failure).toBeVisible()
      await expectNoRejections(page, pageErrors)

      let releaseUnavailable!: () => void
      const unavailableGate = new Promise<void>((resolve) => { releaseUnavailable = resolve })
      await page.route(LIST_REQUEST, async (route) => {
        await unavailableGate
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
      }, { times: 1 })
      await refresh(page)
      try {
        await expect(page.getByRole('row', { name: new RegExp(definition.name) })).toBeVisible()
        await expect(failure).toBeHidden()
      } finally {
        releaseUnavailable()
      }
      await expect(failure).toBeVisible()
      await expectNoRejections(page, pageErrors)

      let releaseRecovery!: () => void
      const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve })
      await page.route(LIST_REQUEST, async (route) => {
        await recoveryGate
        await route.continue()
      }, { times: 1 })
      const recovered = page.waitForResponse((response) => (
        response.url().includes(`${DEFINITIONS}?`) && response.status() === 200
      ))
      await refresh(page)
      try {
        await expect(page.getByRole('row', { name: new RegExp(definition.name) })).toBeVisible()
        await expect(failure).toBeHidden()
      } finally {
        releaseRecovery()
      }
      await recovered
      await expect(failure).toBeHidden()
      await expect(page.getByRole('row', { name: new RegExp(definition.name) })).toBeVisible()
      await expectNoRejections(page, pageErrors)
      const detail = await apiRequest(request, 'GET', `${DEFINITIONS}/${definition.id}`, { token: definition.token })
      expect(detail.ok()).toBeTruthy()
      expect(await readJsonSafe<unknown>(detail)).toEqual(definition.before)
    })

    test('an initial aborted GET leaves loading and a later live refresh recovers', async ({ page, definition }) => {
      const pageErrors = await observeRejections(page)
      await page.route(LIST_REQUEST, (route) => route.abort('failed'), { times: 1 })
      await page.goto('/backend/processes/definitions')
      const failure = page.getByText(dict['agent_orchestrator.processDefinitions.list.error'], { exact: true })
      await expect(failure).toBeVisible()
      await expectNoRejections(page, pageErrors)
      const recovered = page.waitForResponse((response) => (
        response.url().includes(`${DEFINITIONS}?`) && response.status() === 200
      ))
      await refresh(page)
      await recovered
      await expect(page.getByRole('row', { name: new RegExp(definition.name) })).toBeVisible()
      await expect(failure).toBeHidden()
      await expectNoRejections(page, pageErrors)
    })
  })
}
