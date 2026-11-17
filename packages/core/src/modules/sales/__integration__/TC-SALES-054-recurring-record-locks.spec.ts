import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page, type Response } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  CONFLICT_BANNER_TESTID,
  CONFLICT_DIALOG_TESTID,
  expectConflictBanner,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'

export const integrationMeta = {
  description: 'Recurring billing schedule saves with enterprise record locks on (#9065)',
  dependsOnModules: ['sales', 'record_locks'],
}

/**
 * TC-SALES-054 — recurring schedule saves with enterprise record locks on
 * (spec 2026-10-21-sales-recurring-orders, #9065).
 *
 * The Recurring billing dialog saves through the sales document guarded mutation, so the page's
 * record-lock state sees the write. The next status change or quote conversion on the same page,
 * without a reload, must go through instead of opening a false "Conflict detected" dialog. A second
 * tab that loaded the order before those writes must still get a real conflict, so the guard is
 * proven not to have been loosened.
 *
 * Lives in core rather than `packages/enterprise/` because external contributions to the
 * enterprise package are refused by CI; it talks to record_locks only over HTTP and runs only when
 * the module is enabled (as in CI). Self-contained: creates its own documents, restores the
 * record-lock settings and deletes everything it created.
 */

type JsonRecord = Record<string, unknown>

type RecordLockSettings = JsonRecord & {
  enabled?: boolean
  strategy?: string
  enabledResources?: string[]
}

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

async function readRecordLockSettings(request: APIRequestContext, token: string): Promise<RecordLockSettings> {
  const response = await apiRequest(request, 'GET', '/api/record_locks/settings', { token })
  expect(response.ok(), 'GET /api/record_locks/settings should succeed').toBeTruthy()
  return ((await readJson(response)).settings ?? {}) as RecordLockSettings
}

async function writeRecordLockSettings(request: APIRequestContext, token: string, settings: RecordLockSettings) {
  const response = await apiRequest(request, 'POST', '/api/record_locks/settings', { token, data: settings })
  expect(response.ok(), 'POST /api/record_locks/settings should succeed').toBeTruthy()
}

function isoDayFromToday(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const line = { currencyCode: 'USD', name: 'QA TC-SALES-054 service', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 }

async function createDocument(request: APIRequestContext, token: string, resource: 'orders' | 'quotes', data: JsonRecord) {
  const response = await apiRequest(request, 'POST', `/api/sales/${resource}`, { token, data })
  expect(response.status(), `POST /api/sales/${resource}`).toBe(201)
  return (await readJson(response)).id as string
}

async function readDocument(request: APIRequestContext, token: string, resource: 'orders' | 'quotes', id: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  return (((await readJson(response)).items ?? []) as JsonRecord[]).find((item) => item.id === id) ?? {}
}

async function orderStatus(request: APIRequestContext, token: string, value: string): Promise<{ id: string; label: string }> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?pageSize=100', { token })
  expect(response.ok(), 'GET /api/sales/order-statuses should succeed').toBeTruthy()
  const entry = (((await readJson(response)).items ?? []) as JsonRecord[]).find((item) => item.value === value)
  expect(entry, `order status "${value}" should be seeded`).toBeTruthy()
  return { id: entry?.id as string, label: String(entry?.label ?? entry?.value) }
}

async function openDocument(page: Page, id: string, kind: 'order' | 'quote') {
  const acquired = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/record_locks/acquire'
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.resourceId === id,
  )
  await page.goto(`/backend/sales/documents/${id}?kind=${kind}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('sales-recurrence-section')).toBeVisible({ timeout: 60_000 })
  expect((await acquired).status(), 'enterprise record-lock presence must run on the document').toBe(200)
}

async function saveSchedulePeriodCount(page: Page, periodCount: number) {
  const saved = page.waitForResponse((response) =>
    /^\/api\/sales\/(orders|quotes)$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT',
  )
  await page.getByTestId('sales-recurrence-edit').click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByTestId('sales-recurrence-period-count')
  await input.fill(String(periodCount))
  await expect(dialog.getByTestId('sales-recurrence-preview')).toContainText('Ends on')
  await input.press('ControlOrMeta+Enter')
  expect((await saved).status(), 'the schedule save must succeed').toBe(200)
  await expect(page.getByTestId('sales-recurrence-schedule')).toContainText(`${periodCount} payments`, { timeout: 30_000 })
}

function statusCard(page: Page): Locator {
  return page
    .locator('p', { hasText: /^Status$/ })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-lg ")][1]')
}

function orderPutResponse(page: Page) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/sales/orders' && response.request().method() === 'PUT',
  )
}

async function chooseStatus(page: Page, label: string) {
  const card = statusCard(page)
  await card.click()
  await card.getByRole('combobox').click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await card.getByRole('button', { name: /^save/i }).click()
}

async function awaitRequestWithoutConflict(page: Page, pending: Promise<Response>, label: string): Promise<Response> {
  const sent = pending.then((response) => ({ response }), () => ({ response: null }))
  const conflict = page
    .getByTestId(CONFLICT_DIALOG_TESTID)
    .or(page.getByTestId(CONFLICT_BANNER_TESTID))
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => ({ conflict: true as const }), () => ({ conflict: false as const }))
  const outcome = await Promise.race([sent, conflict])
  if ('conflict' in outcome) {
    throw new Error(
      outcome.conflict
        ? `[internal] ${label}: a record-lock conflict opened and no request was sent (#9065)`
        : `[internal] ${label}: no request was sent`,
    )
  }
  if (!outcome.response) throw new Error(`[internal] ${label}: the request did not complete`)
  return outcome.response
}

async function expectNoConflict(page: Page) {
  await expect(page.getByTestId(CONFLICT_DIALOG_TESTID)).toBeHidden()
  await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toBeHidden()
  await expect(page.getByText('Conflict detected', { exact: true })).toBeHidden()
}

test.describe('TC-SALES-054 recurring schedule saves with record locks on', () => {
  test.describe.configure({ timeout: 240_000 })

  test('order: a schedule save does not block the next status change, a stale tab still conflicts', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const settingsToken = await getAuthToken(request, 'superadmin')
    let previousSettings: RecordLockSettings | null = null
    let orderId: string | null = null
    let staleTab: Page | null = null
    try {
      previousSettings = await readRecordLockSettings(request, settingsToken)
      await writeRecordLockSettings(request, settingsToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['sales.order', 'sales.quote'],
      })
      const confirmed = await orderStatus(request, token, 'confirmed')
      const inFulfillment = await orderStatus(request, token, 'in_fulfillment')
      orderId = await createDocument(request, token, 'orders', {
        currencyCode: 'USD',
        lines: [line],
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(20), periodCount: 4 },
      })

      await login(page, 'admin')
      staleTab = await page.context().newPage()
      await openDocument(staleTab, orderId, 'order')
      await openDocument(page, orderId, 'order')

      await saveSchedulePeriodCount(page, 6)
      const statusSaved = orderPutResponse(page)
      await chooseStatus(page, confirmed.label)
      const statusResponse = await awaitRequestWithoutConflict(page, statusSaved, 'status change after the schedule save')
      expect(statusResponse.status(), 'the status change right after the schedule save must succeed').toBe(200)
      await expectNoConflict(page)
      const stored = await readDocument(request, token, 'orders', orderId)
      expect(stored.statusEntryId).toBe(confirmed.id)
      expect(stored.recurrence).toMatchObject({ periodCount: 6 })
      await page.screenshot({ path: testInfo.outputPath('order-status-after-schedule-save.png'), fullPage: true })

      const staleStatuses: number[] = []
      staleTab.on('response', (response) => {
        if (new URL(response.url()).pathname === '/api/sales/orders' && response.request().method() === 'PUT') {
          staleStatuses.push(response.status())
        }
      })
      await staleTab.bringToFront()
      await chooseStatus(staleTab, inFulfillment.label)
      await expectConflictBanner(staleTab)
      expect(staleStatuses.every((status) => status >= 400), 'no stale write may succeed').toBe(true)
      expect((await readDocument(request, token, 'orders', orderId)).statusEntryId).toBe(confirmed.id)
      await staleTab.screenshot({ path: testInfo.outputPath('order-stale-tab-conflict.png'), fullPage: true })
    } finally {
      await staleTab?.close()
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      if (previousSettings) await writeRecordLockSettings(request, settingsToken, previousSettings)
    }
  })

  test('quote: a schedule save does not block the next conversion', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const settingsToken = await getAuthToken(request, 'superadmin')
    let previousSettings: RecordLockSettings | null = null
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      previousSettings = await readRecordLockSettings(request, settingsToken)
      await writeRecordLockSettings(request, settingsToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['sales.order', 'sales.quote'],
      })
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(20), periodCount: 4 },
      })
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', { token, data: { quoteId, ...line } })
      expect(lineResponse.status()).toBe(201)

      await login(page, 'admin')
      await openDocument(page, quoteId, 'quote')
      await saveSchedulePeriodCount(page, 6)

      const converted = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/sales/quotes/convert' && response.request().method() === 'POST',
      )
      const trigger = page.getByRole('button', { name: 'Actions', exact: true })
      const convertItem = page.getByRole('menuitem', { name: 'Convert to order', exact: true })
      await expect(async () => {
        await trigger.click()
        await expect(convertItem).toBeVisible({ timeout: 1_500 })
      }).toPass({ timeout: 15_000 })
      await convertItem.click()
      const response = await awaitRequestWithoutConflict(page, converted, 'conversion after the schedule save')
      expect(response.status(), 'the conversion right after the schedule save must succeed').toBe(200)
      orderId = (((await response.json()) as JsonRecord).orderId as string | undefined) ?? null
      expect(orderId, 'the conversion must return the new order').toBeTruthy()
      await expect(page).toHaveURL(new RegExp(`/backend/sales/(orders|documents)/${orderId}`))
      await expectNoConflict(page)
      expect((await readDocument(request, token, 'orders', orderId as string)).recurrence).toMatchObject({ periodCount: 6 })
      await page.screenshot({ path: testInfo.outputPath('quote-converted-after-schedule-save.png'), fullPage: true })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      if (previousSettings) await writeRecordLockSettings(request, settingsToken, previousSettings)
    }
  })
})
