import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { waitForCalendarLoaded } from './helpers/calendarFixtures'

/**
 * TC-CAL-015: the calendar editor's cached reads stay inside their organization
 * Spec: .ai/specs/2026-09-28-configurable-calendar-event-types.md
 *
 * The editor keeps the activity type catalog and the custom field definitions in module-level
 * caches. This drives the real organization switcher, cookies and API responses:
 *   1. An organization's read that finishes after a switch never reaches the next organization,
 *      through the late response, a reopened editor, a reload and switching back.
 *   2. A failed refresh of a warm cache keeps the draft, blocks type selection and saving, sends
 *      nothing, and recovers only after a successful retry.
 *
 * Self-contained: organizations, activity types and custom fields are created through the API
 * and removed in the finally blocks.
 */

test.setTimeout(120_000)

const CATALOG_ROUTE = '**/api/customers/activity-types*'
const DEFINITIONS_ROUTE = '**/api/entities/definitions?*'
const INTERACTION_ENTITY_ID = 'customers:customer_interaction'

type Catalog = { items: Array<{ key: string; behavior: Record<string, unknown> }> }

type ScopeFixture = {
  id: string
  name: string
  cookie: string
  typeKey: string
  typeLabel: string
  typeEntryId: string
  typeUpdatedAt: string | null
  fieldKey: string
  fieldLabel: string
}

async function createScopeFixture(
  request: APIRequestContext,
  superToken: string,
  tenantId: string,
  label: string,
): Promise<ScopeFixture> {
  const stamp = `${Date.now()}_${label.toLowerCase()}`
  const name = `QA calendar cache ${label} ${stamp}`
  const organization = await apiRequest(request, 'POST', '/api/directory/organizations', {
    token: superToken, data: { tenantId, name },
  })
  expect(organization.status(), await organization.text()).toBe(201)
  const id = (await organization.json() as { id: string }).id
  const cookie = `om_selected_tenant=${tenantId}; om_selected_org=${id}`
  const headers = { Cookie: cookie }

  const catalogResponse = await apiRequest(request, 'GET', `/api/customers/activity-types?organizationId=${id}`, {
    token: superToken, headers,
  })
  expect(catalogResponse.status()).toBe(200)
  const meeting = (await catalogResponse.json() as Catalog).items.find((item) => item.key === 'meeting')
  expect(meeting, 'every organization resolves the built-in meeting type').toBeTruthy()

  const typeKey = `qa_cache_${stamp}`
  const typeLabel = `QA type ${label} ${stamp}`
  const typeResponse = await apiRequest(request, 'POST', '/api/customers/dictionaries/activity-types', {
    token: superToken,
    headers,
    data: { value: typeKey, label: typeLabel, behavior: { ...meeting!.behavior, order: 8000, selectable: true } },
  })
  expect(typeResponse.status(), await typeResponse.text()).toBe(201)
  const type = await typeResponse.json() as { id: string; updatedAt?: string }

  const fieldKey = `qa_cache_${stamp}`
  const fieldLabel = `QA field ${label} ${stamp}`
  const fieldResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token: superToken,
    headers,
    data: { entityId: INTERACTION_ENTITY_ID, key: fieldKey, kind: 'text', configJson: { label: fieldLabel, validation: [] } },
  })
  expect(fieldResponse.status(), await fieldResponse.text()).toBe(200)

  return { id, name, cookie, typeKey, typeLabel, typeEntryId: type.id, typeUpdatedAt: type.updatedAt ?? null, fieldKey, fieldLabel }
}

async function removeScopeFixture(request: APIRequestContext, superToken: string, scope: ScopeFixture): Promise<void> {
  const headers = { Cookie: scope.cookie }
  await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token: superToken, headers, data: { entityId: INTERACTION_ENTITY_ID, key: scope.fieldKey },
  }).catch(() => undefined)
  await apiRequest(request, 'DELETE', `/api/customers/dictionaries/activity-types/${scope.typeEntryId}`, {
    token: superToken,
    headers: {
      ...headers,
      ...(scope.typeUpdatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': scope.typeUpdatedAt } : {}),
    },
  }).catch(() => undefined)
  await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${scope.id}`, { token: superToken }).catch(() => undefined)
}

async function openCalendarIn(page: Page, tenantId: string, scope: ScopeFixture): Promise<void> {
  const url = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: tenantId, url, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.id, url, sameSite: 'Lax' },
  ])
  await page.goto('/backend/calendar', { waitUntil: 'domcontentloaded' })
}

function isInteractionDefinitionsRead(url: string, method: string): boolean {
  return method === 'GET' && url.includes('customer_interaction')
}

// Reads the first matching response under the cookies of that moment, then delivers it only when
// released. Holding the request itself would send it with the cookies of the later organization.
async function holdFirstResponse(page: Page, pattern: string, matches: (url: string, method: string) => boolean) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => { release = resolve })
  let markFetched: (body: string) => void = () => {}
  const fetched = new Promise<string>((resolve) => { markFetched = resolve })
  let markDelivered: () => void = () => {}
  const delivered = new Promise<void>((resolve) => { markDelivered = resolve })
  let held = false
  await page.route(pattern, async (route) => {
    const sent = route.request()
    if (held || !matches(sent.url(), sent.method())) return route.fallback()
    held = true
    const response = await route.fetch()
    const body = await response.text()
    markFetched(body)
    await released
    await route.fulfill({ response, body }).catch(() => undefined)
    markDelivered()
  })
  return { fetched, delivered, release: () => release() }
}

async function switchOrganization(page: Page, scope: ScopeFixture): Promise<void> {
  await page.getByRole('button', { name: /^Organization:/ }).first().click()
  await page.getByRole('button', { name: scope.name, exact: true }).click()
  await expect(page.getByRole('button', { name: `Organization: ${scope.name}`, exact: true })).toBeVisible()
  const cookies = await page.context().cookies()
  expect(cookies.find((cookie) => cookie.name === 'om_selected_org')?.value).toBe(scope.id)
}

async function openEditor(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New event', exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('group', { name: 'Event type' })).toBeVisible()
  return editor
}

async function closeEditor(editor: Locator): Promise<void> {
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

function typeOption(editor: Locator, scope: ScopeFixture): Locator {
  return editor.getByRole('group', { name: 'Event type' }).getByRole('button', { name: scope.typeLabel, exact: true })
}

async function expectEditorScopedTo(editor: Locator, shown: ScopeFixture, hidden: ScopeFixture): Promise<void> {
  await expect(typeOption(editor, shown)).toBeVisible({ timeout: 30_000 })
  await expect(editor.getByText(shown.fieldLabel)).toBeVisible({ timeout: 30_000 })
  await expect(typeOption(editor, hidden)).toHaveCount(0)
  await expect(editor.getByText(hidden.fieldLabel)).toHaveCount(0)
}

test.describe('TC-CAL-015: calendar editor cache scope', () => {
  test('a read that finishes after an organization switch never reaches the next organization', async ({ page, request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    const scopes: ScopeFixture[] = []
    try {
      const first = await createScopeFixture(request, superToken, tenantId, 'A')
      scopes.push(first)
      const second = await createScopeFixture(request, superToken, tenantId, 'B')
      scopes.push(second)

      const catalogRead = await holdFirstResponse(page, CATALOG_ROUTE, (_url, method) => method === 'GET')
      const definitionsRead = await holdFirstResponse(page, DEFINITIONS_ROUTE, isInteractionDefinitionsRead)

      await login(page, 'superadmin')
      await openCalendarIn(page, tenantId, first)
      await waitForCalendarLoaded(page)
      expect(await catalogRead.fetched, 'the held catalog answer belongs to the first organization').toContain(first.typeKey)
      expect(await definitionsRead.fetched, 'the held definitions belong to the first organization').toContain(first.fieldKey)

      await switchOrganization(page, second)
      const editor = await openEditor(page)
      await expectEditorScopedTo(editor, second, first)

      catalogRead.release()
      definitionsRead.release()
      await Promise.all([catalogRead.delivered, definitionsRead.delivered])
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250))))
      await expectEditorScopedTo(editor, second, first)

      await closeEditor(editor)
      await expectEditorScopedTo(await openEditor(page), second, first)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForCalendarLoaded(page)
      await expect(page.getByRole('button', { name: `Organization: ${second.name}`, exact: true })).toBeVisible({ timeout: 30_000 })
      await expectEditorScopedTo(await openEditor(page), second, first)
      await closeEditor(page.getByRole('dialog'))

      await switchOrganization(page, first)
      await expectEditorScopedTo(await openEditor(page), first, second)
    } finally {
      await page.unroute(CATALOG_ROUTE).catch(() => undefined)
      await page.unroute(DEFINITIONS_ROUTE).catch(() => undefined)
      for (const scope of scopes) await removeScopeFixture(request, superToken, scope)
    }
  })

  test('a failed refresh of a warm cache keeps the draft, blocks saving and recovers only after a retry', async ({ page, request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    let scope: ScopeFixture | null = null
    let failCatalog = false
    let failDefinitions = false
    const createdInteractions: string[] = []
    try {
      scope = await createScopeFixture(request, superToken, tenantId, 'C')
      const fixture = scope

      await page.route(CATALOG_ROUTE, async (route) => {
        if (failCatalog && route.request().method() === 'GET') {
          return route.fulfill({ status: 500, json: { error: 'Injected failure' } })
        }
        return route.fallback()
      })
      await page.route(DEFINITIONS_ROUTE, async (route) => {
        const sent = route.request()
        if (failDefinitions && isInteractionDefinitionsRead(sent.url(), sent.method())) {
          return route.fulfill({ status: 500, json: { error: 'Injected failure' } })
        }
        return route.fallback()
      })
      page.on('request', (sent) => {
        if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/customers/interactions') {
          createdInteractions.push(sent.url())
        }
      })

      await login(page, 'superadmin')
      await openCalendarIn(page, tenantId, fixture)
      await waitForCalendarLoaded(page)

      const warmEditor = await openEditor(page)
      await expect(typeOption(warmEditor, fixture)).toBeVisible({ timeout: 30_000 })
      await expect(warmEditor.getByText(fixture.fieldLabel)).toBeVisible({ timeout: 30_000 })
      await closeEditor(warmEditor)

      const failures = [
        {
          message: 'Activity types could not be loaded. Retry to save this event.',
          setFailing: (value: boolean) => { failCatalog = value },
        },
        {
          message: 'Custom fields could not be loaded. Retry to save this event.',
          setFailing: (value: boolean) => { failDefinitions = value },
        },
      ]
      for (const [index, failure] of failures.entries()) {
        failure.setFailing(true)
        const editor = await openEditor(page)
        const failureMessage = editor.getByText(failure.message)
        await expect(failureMessage).toBeVisible({ timeout: 30_000 })

        const draft = `QA draft ${index} ${Date.now()}`
        const title = editor.getByRole('textbox', { name: 'Title', exact: true })
        await title.fill(draft)
        await expect(title).toHaveValue(draft)

        const save = editor.getByRole('button', { name: 'Save event', exact: true })
        await expect(typeOption(editor, fixture)).toBeDisabled()
        await expect(save).toBeDisabled()
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(failureMessage).toBeVisible()
        expect(createdInteractions, 'a failed refresh sends no mutation').toHaveLength(0)

        failure.setFailing(false)
        await editor.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(failureMessage).toHaveCount(0, { timeout: 30_000 })
        await expect(title, 'the retry keeps the draft').toHaveValue(draft)
        await expect(typeOption(editor, fixture)).toBeEnabled()
        await expect(save).toBeEnabled({ timeout: 30_000 })
        await closeEditor(editor)
      }
      expect(createdInteractions).toHaveLength(0)
    } finally {
      await page.unroute(CATALOG_ROUTE).catch(() => undefined)
      await page.unroute(DEFINITIONS_ROUTE).catch(() => undefined)
      if (scope) await removeScopeFixture(request, superToken, scope)
    }
  })
})
