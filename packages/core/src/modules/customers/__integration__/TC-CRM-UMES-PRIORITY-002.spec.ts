import { expect, test } from '@playwright/test'
import { createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { assertNativePayload, authenticateCrm, captureCrmWrites, cleanupCrmRecord, createPriority, openCrmPriorityForm, readCrmOverview, readPriorities, selectPriority } from './helpers/umesFixtures'

export const integrationMeta = { requiredModules: ['customers', 'example'] }

test('TC-CRM-UMES-PRIORITY-002: Owning-module failure remains visible after native save', async ({ page, request }, testInfo) => {
  const token = await authenticateCrm(page, request)
  const personId = await createPersonFixture(request, token, { firstName: 'Failure', lastName: 'Feedback', displayName: `Priority failure ${Date.now()}` })
  const captured = captureCrmWrites(page)
  try {
    await createPriority(request, token, personId, 'high')
    await openCrmPriorityForm(page, 'people', personId)
    await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveText('High')
    await page.route('**/api/example/customer-priorities', async (route) => {
      if (route.request().method() === 'PUT') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected owning-module write failure' }) })
      else await route.continue()
    })
    await page.getByRole('main').getByRole('textbox').first().fill('Native update succeeds')
    await selectPriority(page, 'Critical')
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByText('Failed to save priority.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    assertNativePayload(captured.writes, 'people', 'PUT')
    expect(captured.writes.filter((write) => write.path === '/api/example/customer-priorities')).toHaveLength(1)
    const overview = await readCrmOverview(request, token, 'people', personId)
    expect(overview.envelope.profile).toMatchObject({ firstName: 'Native update succeeds' })
    expect(overview.priority.priority).toBe('high')
    expect(await readPriorities(request, token, personId)).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('priority-owning-save-failure.png'), fullPage: true })
  } finally {
    captured.stop()
    await page.unroute('**/api/example/customer-priorities')
    await cleanupCrmRecord(request, token, 'people', personId)
  }
})

test('TC-CRM-UMES-PRIORITY-002: Create failure feedback survives the successful native redirect', async ({ page, request }, testInfo) => {
  const token = await authenticateCrm(page, request)
  const captured = captureCrmWrites(page)
  let personId: string | null = null
  try {
    await page.goto('/backend/customers/people/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeVisible()
    await page.getByRole('main').getByRole('textbox').nth(0).fill('Priority')
    await page.getByRole('main').getByRole('textbox').nth(1).fill(`Creation failure ${Date.now()}`)
    await selectPriority(page, 'Critical')
    await page.route('**/api/example/customer-priorities', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected owning-module create failure' }) })
      else await route.continue()
    })
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'POST')
    const childFailed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/example/customer-priorities' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create Person', exact: true }).first().click()
    const nativeResponse = await created
    expect(nativeResponse.ok()).toBe(true)
    const body = await nativeResponse.json() as { id?: string; entityId?: string }
    personId = body.id ?? body.entityId ?? null
    expect(personId).toBeTruthy()
    expect((await childFailed).status()).toBe(500)
    await expect(page).toHaveURL(new RegExp(`/backend/customers/people-v2/${personId}$`))
    await expect(page.getByText('The record was created, but its priority could not be saved. Open the record to retry.', { exact: true })).toBeVisible()
    assertNativePayload(captured.writes, 'people', 'POST')
    const childWrites = captured.writes.filter((write) => write.path === '/api/example/customer-priorities')
    expect(childWrites).toHaveLength(1)
    expect(childWrites[0].data).toMatchObject({ customerId: personId, priority: 'critical' })
    expect(await readPriorities(request, token, personId as string)).toHaveLength(0)
    await page.screenshot({ path: testInfo.outputPath('priority-owning-create-failure.png'), fullPage: true })
  } finally {
    captured.stop()
    await page.unroute('**/api/example/customer-priorities')
    await cleanupCrmRecord(request, token, 'people', personId)
  }
})
