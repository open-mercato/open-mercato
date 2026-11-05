import { expect, test, type APIRequestContext, type Locator, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const INTERACTIONS_API = '/api/customers/interactions'
const TOGGLES_API = '/api/feature_toggles'
const UNIFIED_INTERACTIONS_TOGGLE = 'customers.interactions.unified'
const INTERACTION_STATUSES_API = '/api/customers/dictionaries/interaction-statuses'

type Interaction = {
  id: string
  title: string | null
  body: string | null
  status: string
  updatedAt: string
}

type ToggleOverride = {
  id: string
  isOverride: boolean
  value: boolean
}

async function listInteractions(request: APIRequestContext, token: string, entityId: string): Promise<Interaction[]> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS_API}?entityId=${entityId}&interactionType=task&limit=100`, { token })
  expect(response.status(), 'customer task interactions should load').toBe(200)
  const body = await readJsonSafe<{ items?: Interaction[] }>(response)
  return body?.items ?? []
}

async function resolveToggle(request: APIRequestContext, token: string): Promise<{ id: string; override: ToggleOverride }> {
  const listResponse = await apiRequest(request, 'GET', `${TOGGLES_API}/overrides?identifier=${UNIFIED_INTERACTIONS_TOGGLE}&pageSize=100`, { token })
  expect(listResponse.status(), 'feature toggle list should load').toBe(200)
  const list = await readJsonSafe<{ items?: Array<{ toggleId: string; isOverride: boolean }> }>(listResponse)
  const row = list?.items?.find((item) => item.toggleId && (item as { identifier?: string }).identifier === UNIFIED_INTERACTIONS_TOGGLE)
  expect(row, `toggle ${UNIFIED_INTERACTIONS_TOGGLE} should be seeded`).toBeTruthy()
  const detailResponse = await apiRequest(request, 'GET', `${TOGGLES_API}/global/${row!.toggleId}/override`, { token })
  expect(detailResponse.status(), 'feature toggle value should load').toBe(200)
  const detail = await readJsonSafe<{ value?: unknown }>(detailResponse)
  expect(typeof detail?.value, 'unified interactions toggle should be boolean').toBe('boolean')
  return { id: row!.toggleId, override: { id: row!.toggleId, isOverride: row!.isOverride, value: detail!.value as boolean } }
}

async function setToggle(request: APIRequestContext, token: string, toggleId: string, isOverride: boolean, value?: boolean): Promise<void> {
  const response = await apiRequest(request, 'PUT', `${TOGGLES_API}/overrides`, {
    token,
    data: { toggleId, isOverride, ...(isOverride ? { overrideValue: value } : {}) },
  })
  expect(response.status(), 'feature toggle override should update').toBe(200)
}

async function expectAlignedStatusAppearance(trigger: Locator): Promise<void> {
  const leading = trigger.locator('[data-slot="select-trigger-leading"]')
  const icon = leading.locator('svg')
  const color = leading.locator('span').first()
  await expect(leading).toBeVisible()
  await expect(icon).toBeVisible()
  await expect(color).toBeVisible()
  const [iconBox, colorBox] = await Promise.all([icon.boundingBox(), color.boundingBox()])
  expect(iconBox, 'status icon should have a layout box').not.toBeNull()
  expect(colorBox, 'status color should have a layout box').not.toBeNull()
  expect(Math.abs(iconBox!.y + iconBox!.height / 2 - (colorBox!.y + colorBox!.height / 2)), 'status icon and color centers should align horizontally').toBeLessThanOrEqual(1)
  const colorBackground = await color.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(colorBackground, 'status color indicator should be visibly filled').not.toBe('rgba(0, 0, 0, 0)')
}

test.describe('TC-CRM-8469: native customer task dialog conflict recovery', () => {
  test('preserves the title draft and concurrent description edit, retries, and keeps status appearance aligned on mobile', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA TC-CRM-8469 ${stamp}`
    let personId: string | null = null
    let firstTaskId: string | null = null
    let secondTaskId: string | null = null
    let statusId: string | null = null
    let toggle: { id: string; override: ToggleOverride } | null = null
    const statusValue = `qa_8469_${Date.now()}`
    const statusLabel = `QA 8469 ${Date.now()}`

    try {
      toggle = await resolveToggle(request, token)
      await setToggle(request, token, toggle.id, true, true)
      const statusResponse = await apiRequest(request, 'POST', INTERACTION_STATUSES_API, {
        token,
        data: { value: statusValue, label: statusLabel, color: '#a855f7', icon: 'lucide:circle' },
      })
      expect(statusResponse.status(), 'custom status fixture should be created').toBe(201)
      const createdStatus = await readJsonSafe<{ id?: string }>(statusResponse)
      statusId = createdStatus?.id ?? null
      expect(statusId, 'custom status fixture should return an id').toBeTruthy()
      personId = await createPersonFixture(request, token, {
        firstName: 'Conflict',
        lastName: `TC-CRM-8469-${stamp}`,
        displayName: `${marker} Person`,
      })
      for (const [title, body] of [[`${marker} first`, 'Original description'], [`${marker} second`, 'Second description']]) {
        const response = await apiRequest(request, 'POST', INTERACTIONS_API, {
          token,
          data: { entityId: personId, interactionType: 'task', title, body, status: statusValue, occurredAt: new Date().toISOString() },
        })
        expect(response.status(), 'task fixture should be created').toBe(201)
        const created = await readJsonSafe<{ id?: string }>(response)
        expect(created?.id, 'task creation should return an id').toBeTruthy()
        if (!firstTaskId) firstTaskId = created!.id!
        else secondTaskId = created!.id!
      }

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
      await page.getByRole('tab', { name: 'Activity', exact: true }).click()
      await page.getByText(`${marker} first`, { exact: true }).waitFor({ state: 'visible' })
      const firstTaskCard = page.locator('article').filter({ has: page.getByText(`${marker} first`, { exact: true }) }).last()
      await firstTaskCard.getByRole('button', { name: 'Edit', exact: true }).click()
      const mobileDialog = page.getByRole('dialog', { name: /edit task/i })
      await expect(mobileDialog).toBeVisible()
      await expectAlignedStatusAppearance(mobileDialog.locator('[role="combobox"]').filter({ hasText: statusLabel }))
      const dialogBox = await mobileDialog.boundingBox()
      expect(dialogBox, 'mobile task dialog should have a layout box').not.toBeNull()
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
      await mobileDialog.getByRole('button', { name: /cancel/i }).click()

      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
      await page.getByText(`${marker} first`, { exact: true }).waitFor({ state: 'visible' })
      const desktopTaskCard = page.locator('article').filter({ has: page.getByText(`${marker} first`, { exact: true }) }).last()
      await desktopTaskCard.getByRole('button', { name: 'Edit', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: /edit task/i })
      await expect(dialog).toBeVisible()
      const statusTrigger = dialog.locator('[role="combobox"]').filter({ hasText: statusLabel })
      await expectAlignedStatusAppearance(statusTrigger)

      const before = (await listInteractions(request, token, personId)).find((item) => item.id === firstTaskId)
      expect(before?.updatedAt, 'task version should be available before concurrent update').toBeTruthy()
      await dialog.getByRole('textbox', { name: 'Task title' }).fill(`${marker} edited title`)
      const concurrentUpdate = await apiRequest(request, 'PUT', INTERACTIONS_API, {
        token,
        data: { id: firstTaskId, body: 'Concurrent description preserved' },
      })
      expect(concurrentUpdate.status(), 'concurrent description update should succeed').toBe(200)

      const failedSubmit = page.waitForRequest((outgoing: Request) => outgoing.method() === 'PUT' && outgoing.url().includes(INTERACTIONS_API))
      await dialog.getByRole('button', { name: /update task/i }).click()
      const failedRequest = await failedSubmit
      const failedVersion = failedRequest.headers()[OPTIMISTIC_LOCK_HEADER_NAME]
      expect(failedVersion, 'first save should send the task version loaded by the dialog').toBeTruthy()
      const conflictBanner = page.getByTestId('record-conflict-banner')
      await expect(conflictBanner).toBeVisible()
      await expect(conflictBanner).toContainText(/record changed|changed by another|modified by someone else|refresh and try again/i)
      await expect(page.getByText(/record_modified|Task updated/i)).toHaveCount(0)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: 'Task title' })).toHaveValue(`${marker} edited title`)

      const conflictVersion = (await listInteractions(request, token, personId)).find((item) => item.id === firstTaskId)?.updatedAt
      expect(conflictVersion, 'server should expose the refreshed task version after the concurrent update').toBeTruthy()
      expect(new Date(failedVersion).toISOString()).toBe(new Date(before!.updatedAt).toISOString())
      expect(new Date(conflictVersion!).toISOString()).not.toBe(new Date(failedVersion).toISOString())
      const retrySubmit = page.waitForRequest((outgoing: Request) => outgoing.method() === 'PUT' && outgoing.url().includes(INTERACTIONS_API))
      await dialog.getByRole('textbox', { name: 'Task title' }).focus()
      await page.keyboard.press('Control+Enter')
      const retryRequest = await retrySubmit
      expect(new Date(retryRequest.headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toISOString()).toBe(new Date(conflictVersion!).toISOString())
      await expect(dialog).toBeHidden()
      const persisted = (await listInteractions(request, token, personId)).find((item) => item.id === firstTaskId)
      expect(persisted?.title).toBe(`${marker} edited title`)
      expect(persisted?.body).toBe('Concurrent description preserved')
      expect(persisted?.updatedAt).not.toBe(before?.updatedAt)

      const secondTaskCard = page.locator('article').filter({ has: page.getByText(`${marker} second`, { exact: true }) }).last()
      await secondTaskCard.getByRole('button', { name: 'Edit', exact: true }).click()
      const nextDialog = page.getByRole('dialog', { name: /edit task/i })
      await expect(nextDialog).toBeVisible()
      await expect(page.getByTestId('record-conflict-banner')).toHaveCount(0)
      await expectAlignedStatusAppearance(nextDialog.locator('[role="combobox"]').filter({ hasText: statusLabel }))

      await nextDialog.getByRole('button', { name: /cancel/i }).click()
    } finally {
      try {
        await deleteEntityIfExists(request, token, INTERACTIONS_API, secondTaskId)
        await deleteEntityIfExists(request, token, INTERACTIONS_API, firstTaskId)
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
        if (statusId) {
          const response = await apiRequest(request, 'DELETE', `${INTERACTION_STATUSES_API}/${statusId}`, { token })
          expect(response.status(), 'custom status fixture should be deleted').toBe(200)
        }
      } finally {
        if (toggle) await setToggle(request, token, toggle.id, toggle.override.isOverride, toggle.override.value)
      }
    }
  })
})
