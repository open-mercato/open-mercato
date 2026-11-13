import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo, type BrowserContext } from '@playwright/test'
import { z } from 'zod'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { startRlsLiveRuntime, type RlsLiveRuntime } from './helpers/liveRuntime'
import { createPeopleBrowserFixtures } from './helpers/peopleBrowserFixtures'

async function lastNameField(page: Page) {
  const input = page.locator('[data-crud-field-id="lastName"] input:visible').first()
  if (!await input.isVisible()) await page.getByRole('button', { name: /expand form panel/i }).click()
  await expect(input).toBeVisible()
  return input
}

async function savePerson(page: Page, expectedStatus: number) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'PUT')
  const save = page.getByRole('button', { name: /^save$/i }).first()
  await expect(save).toBeEnabled()
  await save.click()
  const response = await responsePromise
  expect(response.status()).toBe(expectedStatus)
  expect(response.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBeTruthy()
  return response
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
}

test.describe('TC-RLS-003: actual People forms with restricted FORCE RLS', () => {
  test.setTimeout(240_000)
  let runtime: RlsLiveRuntime
  let fixtures: Awaited<ReturnType<typeof createPeopleBrowserFixtures>>

  test.beforeAll(async () => {
    runtime = await startRlsLiveRuntime()
    try { fixtures = await createPeopleBrowserFixtures(runtime) } catch (error) { await runtime.stop(); throw error }
  })
  test.afterAll(async () => {
    try { await fixtures?.cleanup() } finally { await runtime?.stop() }
  })

  test('creates, edits and deletes own People; rejects tenant cookie leakage and stale browser edits', async ({ browser }, testInfo) => {
    const contexts: BrowserContext[] = []
    const firstName = `RlsBrowser${randomUUID().replaceAll('-', '')}`
    const originalLastName = 'Created'
    try {
      const baseline = await fixtures.retainedCustomers()
      const [actor, foreignActor] = fixtures.actors
      const context = await browser.newContext({ baseURL: runtime.baseUrl, locale: 'en-US' })
      contexts.push(context)
      await context.addCookies([{ name: 'auth_token', value: actor.token, url: runtime.baseUrl }])
      const page = await context.newPage()
      await page.goto('/backend/customers/people')
      await expect(page.getByText(runtime.first.slug, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(runtime.second.slug, { exact: true })).toHaveCount(0)
      await screenshot(page, testInfo, 'rls-people-own-list.png')

      await page.goto('/backend/customers/people/create')
      await fillControlledInput(page.locator('form').getByRole('textbox').first(), firstName)
      await fillControlledInput(page.locator('form').getByRole('textbox').nth(1), originalLastName)
      const createdResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Create Person' }).first().click()
      expect((await createdResponse).status()).toBe(201)
      await expect(page).toHaveURL(/\/backend\/customers\/people-v2\/[0-9a-f-]{36}$/i)
      const personId = z.string().uuid().parse(page.url().split('/').pop())
      await expect(await lastNameField(page)).toHaveValue(originalLastName)
      await screenshot(page, testInfo, 'rls-people-created-form.png')

      const stalePage = await context.newPage()
      await stalePage.goto(`/backend/customers/people-v2/${personId}`)
      await expect(await lastNameField(stalePage)).toHaveValue(originalLastName)
      await fillControlledInput(await lastNameField(page), 'Authorized winner')
      await savePerson(page, 200)
      await expect(page.getByTestId('record-conflict-banner')).toHaveCount(0)
      await expect.poll(async () => (await fixtures.persistedPerson(personId))[0]?.last_name).toBe('Authorized winner')
      await screenshot(page, testInfo, 'rls-people-edited-form.png')

      await fillControlledInput(await lastNameField(stalePage), 'Stale loser')
      const conflict = await savePerson(stalePage, 409)
      expect(await conflict.json()).toMatchObject({ error: expect.any(String) })
      await expect(stalePage.getByTestId('record-conflict-banner')).toBeVisible()
      await expect(await lastNameField(stalePage)).toHaveValue('Stale loser')
      await screenshot(stalePage, testInfo, 'rls-people-stale-conflict.png')
      expect(await fixtures.persistedPerson(personId)).toEqual([expect.objectContaining({ tenant_id: actor.tenantId, organization_id: actor.orgId, last_name: 'Authorized winner', deleted_at: null })])

      await context.addCookies([
        { name: 'om_selected_tenant', value: foreignActor.tenantId, url: runtime.baseUrl },
        { name: 'om_selected_org', value: foreignActor.orgId, url: runtime.baseUrl },
      ])
      const switchedList = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'GET')
      await page.goto('/backend/customers/people')
      const switchedResponse = await switchedList
      expect([200, 403]).toContain(switchedResponse.status())
      if (switchedResponse.ok()) {
        const listed = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).parse(await switchedResponse.json())
        expect(listed.items.map((person) => person.id)).not.toContain(foreignActor.customerId)
      }
      await expect(page.getByText(runtime.second.slug, { exact: true })).toHaveCount(0)
      await expect(page.getByText(runtime.first.slug, { exact: true }).first()).toBeVisible()
      const foreignRead = await context.request.get(`/api/customers/people/${foreignActor.customerId}`)
      expect([403, 404]).toContain(foreignRead.status())
      await screenshot(page, testInfo, 'rls-people-forged-selection.png')

      await context.clearCookies({ name: /^om_selected_(tenant|org)$/ })
      await context.addCookies([{ name: 'auth_token', value: foreignActor.token, url: runtime.baseUrl }])
      await page.goto('/backend/customers/people')
      await expect(page.getByText(runtime.second.slug, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(runtime.first.slug, { exact: true })).toHaveCount(0)
      await expect(page.getByText(`${firstName} Authorized winner`, { exact: true })).toHaveCount(0)
      expect([403, 404]).toContain((await context.request.get(`/api/customers/people/${personId}`)).status())
      await screenshot(page, testInfo, 'rls-people-second-tenant.png')

      await context.addCookies([{ name: 'auth_token', value: actor.token, url: runtime.baseUrl }])
      await page.goto(`/backend/customers/people-v2/${personId}`)
      await expect(await lastNameField(page)).toHaveValue('Authorized winner')
      await page.getByRole('button', { name: /^delete$/i }).first().click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await screenshot(page, testInfo, 'rls-people-delete-confirmation.png')
      const deleteResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'DELETE')
      await dialog.getByRole('button', { name: /^delete$/i }).click()
      const deleted = await deleteResponse
      expect(deleted.ok()).toBe(true)
      expect(deleted.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/customers\/people$/)
      await expect(page.getByText(`${firstName} Authorized winner`, { exact: true })).toHaveCount(0)
      expect(await fixtures.persistedPerson(personId)).toEqual([])
      expect(await fixtures.retainedCustomers()).toEqual(baseline)
      await screenshot(page, testInfo, 'rls-people-deleted-list.png')
    } catch (error) {
      for (const [contextIndex, context] of contexts.entries()) {
        for (const [pageIndex, page] of context.pages().entries()) {
          if (!page.isClosed()) await screenshot(page, testInfo, `rls-people-failure-${contextIndex}-${pageIndex}.png`).catch(() => {})
        }
      }
      await testInfo.attach('restricted-server-log', { body: await runtime.serverLog(), contentType: 'text/plain' })
      throw error
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})
