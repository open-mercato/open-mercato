import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5001'
const artifactDir = '/work/.ai/qa/pr-6688'
const eventTitle = `PR 6688 QA Visit ${Date.now()}`
const consoleErrors = []
const pageErrors = []
const failedRequests = []

await mkdir(artifactDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

async function login() {
  await page.goto(`${baseUrl}/login?role=admin`)
  await page.locator('input[name=email]').fill('admin@acme.com')
  await page.locator('input[name=password]').fill('secret')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

try {
  await login()
  await page.waitForTimeout(2_000)
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'failed'
    if (!request.url().includes('/api/events/stream') && errorText !== 'net::ERR_ABORTED') failedRequests.push(`${request.method()} ${request.url()} — ${errorText}`)
  })
  await page.goto(`${baseUrl}/backend/calendar`)
  await page.getByRole('button', { name: 'New event' }).waitFor({ timeout: 30_000 })
  await page.screenshot({ path: `${artifactDir}/01-calendar-desktop.png`, fullPage: true })

  await page.getByRole('button', { name: 'New event' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: 'Meeting', exact: true }).waitFor()
  for (const eventType of ['Meeting', 'Call', 'Email', 'Note', 'Event', 'Visit', 'Task']) {
    await editor.getByRole('button', { name: eventType, exact: true }).waitFor()
  }

  await editor.getByRole('button', { name: 'Visit', exact: true }).click()
  await editor.getByText('Visit availability', { exact: true }).waitFor()
  await editor.getByText('Selected staff and resources are available.', { exact: true }).waitFor()
  assert.equal(await editor.getByRole('combobox', { name: 'To', exact: true }).getAttribute('placeholder'), 'Add recipient…')
  assert.equal(await editor.getByRole('button', { name: 'Visit', exact: true }).getAttribute('data-state'), 'active')
  await editor.getByLabel('Title').fill(eventTitle)
  await editor.getByRole('button', { name: 'Related to' }).click()
  await page.locator('input[placeholder="Search people or companies…"]').fill('a')
  await page.getByRole('option').first().waitFor()
  await page.getByRole('option').first().click()
  await page.screenshot({ path: `${artifactDir}/02-visit-editor-desktop.png`, fullPage: true })

  const saveResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/customers/interactions'), { timeout: 30_000 })
  await editor.getByRole('button', { name: 'Save event' }).click()
  const saveResponse = await saveResponsePromise
  assert.ok(saveResponse.ok(), `Visit save failed with HTTP ${saveResponse.status()}`)
  await editor.waitFor({ state: 'hidden', timeout: 30_000 })
  await page.getByText(eventTitle, { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.screenshot({ path: `${artifactDir}/03-visit-saved-desktop.png`, fullPage: true })

  await page.getByRole('button', { name: 'Calendar settings' }).click()
  const settings = page.getByRole('dialog')
  await settings.getByText('Activity Types', { exact: true }).waitFor()
  const manageTypes = settings.getByRole('link', { name: 'Manage activity types' })
  assert.equal(await manageTypes.getAttribute('href'), '/backend/config/customers#customer-dictionary-activity-types')
  await page.screenshot({ path: `${artifactDir}/04-calendar-settings-desktop.png`, fullPage: true })
  await manageTypes.click()

  const activityTypes = page.locator('#customer-dictionary-activity-types')
  await activityTypes.getByRole('button', { name: 'New activity type' }).waitFor({ timeout: 30_000 })
  for (const catalogEntry of ['Meeting', 'Call', 'Email', 'Note', 'Event', 'Visit', 'Task']) {
    await activityTypes.getByText(catalogEntry, { exact: true }).first().waitFor()
  }
  await activityTypes.getByText('example', { exact: true }).waitFor()
  await page.screenshot({ path: `${artifactDir}/05-activity-type-catalog-desktop.png`, fullPage: true })

  await activityTypes.getByRole('button', { name: 'New activity type' }).click()
  const typeEditor = page.getByRole('dialog', { name: 'New activity type' })
  await typeEditor.getByText('Appearance', { exact: true }).waitFor()
  await typeEditor.getByText('Form behavior', { exact: true }).waitFor()
  await typeEditor.getByText('Custom-field fieldsets', { exact: true }).first().waitFor()
  await typeEditor.getByRole('button', { name: 'Save', exact: true }).waitFor()
  await page.screenshot({ path: `${artifactDir}/06-new-activity-type-desktop.png`, fullPage: true })
  await typeEditor.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await typeEditor.waitFor({ state: 'hidden' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${baseUrl}/backend/calendar`)
  await page.getByRole('button', { name: 'New event' }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'New event' }).click()
  const mobileEditor = page.getByRole('dialog')
  await mobileEditor.getByRole('button', { name: 'Visit', exact: true }).click()
  await mobileEditor.getByText('Visit availability', { exact: true }).waitFor()
  await page.screenshot({ path: `${artifactDir}/07-visit-editor-mobile.png`, fullPage: true })
  await mobileEditor.getByRole('button', { name: 'Cancel', exact: true }).click()

  assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`)
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
  assert.deepEqual(failedRequests, [], `Failed requests: ${failedRequests.join(' | ')}`)

  console.log(JSON.stringify({
    result: 'passed',
    scenarios: [
      'Calendar renders and exposes all seven configured event types',
      'Visit type renders its recipient field and live availability extension',
      'Visit persists successfully and appears in the calendar',
      'Calendar settings links to the organization activity-type catalog',
      'Catalog includes built-in and module-provided types and opens the grouped editor',
      'Visit editor remains usable at a 390x844 mobile viewport',
    ],
    consoleErrors,
    pageErrors,
    failedRequests,
  }, null, 2))
} finally {
  await browser.close()
}
