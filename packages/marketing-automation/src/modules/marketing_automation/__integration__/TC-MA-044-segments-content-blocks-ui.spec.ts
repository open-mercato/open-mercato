import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const SEGMENTS_PATH = '/api/marketing_automation/segments'
const BLOCKS_PATH = '/api/marketing_automation/content-blocks'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type Segment = {
  id: string
  slug: string
  name: string
  description: string | null
  expression: { operator?: string; rules?: Array<Record<string, unknown>> } | null
  updatedAt: string
}

type Block = { id: string; key: string; name: string; html: string; updatedAt: string }

async function listSegments(request: APIRequestContext, token: string): Promise<Segment[]> {
  const response = await apiRequest(request, 'GET', `${SEGMENTS_PATH}?pageSize=100`, { token })
  return (await readJsonSafe<{ items?: Segment[] }>(response))?.items ?? []
}

async function findSegment(request: APIRequestContext, token: string, name: string): Promise<Segment | null> {
  return (await listSegments(request, token)).find((segment) => segment.name === name) ?? null
}

async function removeSegmentByName(request: APIRequestContext, token: string, name: string): Promise<void> {
  const segment = await findSegment(request, token, name)
  if (!segment) return
  await apiRequest(request, 'DELETE', `${SEGMENTS_PATH}/${segment.id}`, { token, headers: { [LOCK_HEADER]: segment.updatedAt } })
}

async function createSegment(request: APIRequestContext, token: string, name: string, marker: string): Promise<Segment> {
  const response = await apiRequest(request, 'POST', SEGMENTS_PATH, {
    token,
    data: { name, expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] } },
  })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<Segment>(response))!
}

async function findBlock(request: APIRequestContext, token: string, key: string): Promise<Block | null> {
  const response = await apiRequest(request, 'GET', `${BLOCKS_PATH}?pageSize=100`, { token })
  const items = (await readJsonSafe<{ items?: Block[] }>(response))?.items ?? []
  return items.find((block) => block.key === key) ?? null
}

async function removeBlockByKey(request: APIRequestContext, token: string, key: string): Promise<void> {
  const block = await findBlock(request, token, key)
  if (!block) return
  await apiRequest(request, 'DELETE', `${BLOCKS_PATH}/${block.id}`, { token, headers: { [LOCK_HEADER]: block.updatedAt } })
}

async function scorePoints(request: APIRequestContext, token: string, customerId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
  return (await readJsonSafe<{ score?: { points?: number } }>(response))?.score?.points ?? 0
}

async function confirmDialog(page: Page, button: 'Confirm' | 'Cancel', text?: string): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  if (text) await expect(dialog).toContainText(text)
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

/**
 * Waits for the list REQUEST: the table shell is server-rendered, so only the hydrated client asking for the list
 * says typing is safe.
 */
async function openScreen(page: Page, url: string, listPath: string): Promise<void> {
  const listed = page.waitForResponse((response) =>
    response.url().includes(listPath) && response.request().method() === 'GET')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await listed
}

function segmentRow(page: Page, name: string) {
  return page.getByRole('row', { name: new RegExp(name) })
}

/**
 * TC-MA-044: the segments and content blocks screens, driven as an operator would.
 *
 * Every segment the bulk action touches is narrowed to this spec's own fixture by display name — other specs
 * assert that customers nobody scored hold zero points.
 */
test.describe('TC-MA-044 segments and content blocks screens', () => {
  test.describe.configure({ timeout: 90_000 })

  /**
   * The dev runtime's diagnostics banner floats over the bottom of the page and swallows clicks meant for the
   * editor's Save button. It is dev chrome, not the screen under test, so it is dismissed whenever it appears.
   */
  test.beforeEach(async ({ page }) => {
    await page.addLocatorHandler(page.getByTestId('dev-runtime-diagnostics-banner'), async (banner) => {
      await banner.getByRole('button', { name: 'Dismiss' }).click()
    }, { noWaitAfter: true })
  })

  test('an operator builds a segment with the condition builder, edits it and removes it', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const name = `QA UI segment ${stamp}`
    const marker = `QA UI Segment Person ${stamp}`
    try {
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/segments', SEGMENTS_PATH)

      await expect(page.getByText('New segment').first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
      await expect(page.getByText('No conditions defined')).toBeVisible()

      await fillControlledInput(page.locator('#segment-name'), name)
      await fillControlledInput(page.locator('#segment-description'), 'Made by TC-MA-044')
      await page.getByRole('button', { name: 'Add First Condition' }).click()
      await fillControlledInput(page.getByPlaceholder('e.g., status, user.email'), 'customer.displayName')
      await fillControlledInput(page.getByPlaceholder('e.g., "ACTIVE" or ["A","B"]'), marker)
      await expect(page.getByPlaceholder('e.g., status, user.email')).toHaveValue('customer.displayName')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByText('Segment saved.')).toBeVisible({ timeout: 20_000 })
      const row = segmentRow(page, name)
      await expect(row).toBeVisible({ timeout: 20_000 })
      const created = await findSegment(request, token, name)
      expect(created?.description).toBe('Made by TC-MA-044')
      expect(created?.slug).toMatch(/^qa-ui-segment/)
      expect(created?.expression?.rules?.[0]).toMatchObject({ field: 'customer.displayName', operator: '=', value: marker })
      await expect(row).toContainText(created!.slug)
      // Saving resets the editor to a fresh draft.
      await expect(page.locator('#segment-name')).toHaveValue('')

      await row.getByRole('button', { name: 'Edit' }).click()
      await expect(page.getByText(`Editing ${name}`)).toBeVisible()
      await expect(page.locator('#segment-name')).toHaveValue(name)
      await expect(page.getByText(`Referenced in an audience as ${created!.slug}. It does not change when the name does.`)).toBeVisible()
      await expect(page.getByPlaceholder('e.g., "ACTIVE" or ["A","B"]')).toHaveValue(marker)

      // Unsaved work is not thrown away without asking.
      await fillControlledInput(page.locator('#segment-description'), 'Edited by TC-MA-044')
      await page.getByRole('button', { name: 'New segment' }).click()
      await confirmDialog(page, 'Cancel', 'Discard unsaved changes?')
      await expect(page.locator('#segment-description')).toHaveValue('Edited by TC-MA-044')

      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Segment saved.').first()).toBeVisible({ timeout: 20_000 })
      await expect.poll(async () => (await findSegment(request, token, name))?.description, { timeout: 20_000 })
        .toBe('Edited by TC-MA-044')
      expect((await findSegment(request, token, name))?.slug).toBe(created!.slug)

      await row.getByRole('button', { name: 'Remove' }).click()
      await confirmDialog(page, 'Confirm', 'Campaigns that target it will match nobody.')
      await expect(row).toBeHidden({ timeout: 20_000 })
      expect(await findSegment(request, token, name)).toBeNull()
    } finally {
      await removeSegmentByName(request, token, name)
    }
  })

  test('members, size history, overlap, the bulk points action and export for a segment', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA UI Members ${stamp}`
    const mainName = `QA UI members ${stamp}`
    const otherName = `QA UI overlap ${stamp}`
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Members', displayName: marker })
      const main = await createSegment(request, token, mainName, marker)
      await createSegment(request, token, otherName, marker)
      const pointsBefore = await scorePoints(request, token, personId)

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/segments', SEGMENTS_PATH)

      const row = segmentRow(page, mainName)
      await expect(row).toBeVisible({ timeout: 20_000 })
      await row.getByRole('button', { name: 'Members' }).click()

      await expect(page.getByText(`Editing ${mainName}`)).toBeVisible()
      await expect(page.getByRole('link', { name: marker })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('link', { name: marker })).toHaveAttribute('href', `/backend/marketing/customers/${personId}`)
      await expect(page.getByText(/Every candidate was checked\.|A sample: \d+ candidates were checked/)).toBeVisible()
      // A segment made a moment ago has no recorded sizes, so no trend is drawn.
      await expect(page.getByText('Sizes are recorded once a day, so a trend appears from tomorrow.')).toBeVisible()

      await expect(page.getByText('Compare and act')).toBeVisible()
      await page.locator('#overlap-with').click()
      await page.getByRole('option', { name: otherName }).click()
      await expect(page.getByText(new RegExp(`^1 of 1 are also in ${otherName}( · sampled)?$`))).toBeVisible({ timeout: 20_000 })

      const exportLink = page.getByRole('link', { name: 'Export CSV' })
      await expect(exportLink).toHaveAttribute('href', `${SEGMENTS_PATH}/${main.id}/export`)
      await expect(exportLink).toHaveAttribute('download', '')
      const exported = await page.request.get(`${SEGMENTS_PATH}/${main.id}/export`)
      expect(exported.status()).toBe(200)
      expect(await exported.text()).toContain(marker)

      // Asking first: declining leaves nobody scored.
      await page.getByRole('button', { name: 'Award 10 points to members' }).click()
      await confirmDialog(page, 'Cancel', 'Apply this to everybody currently in the segment?')

      await page.getByRole('button', { name: 'Award 10 points to members' }).click()
      await confirmDialog(page, 'Confirm')
      await expect(page.getByText(
        /Started\. Watch it in the progress bar at the top\.|This installation cannot track background work/,
      )).toBeVisible({ timeout: 20_000 })
      if (await page.getByText('Started. Watch it in the progress bar at the top.').isVisible()) {
        await expect.poll(() => scorePoints(request, token, personId!), { timeout: 45_000 }).toBe(pointsBefore + 10)
      }
    } finally {
      await removeSegmentByName(request, token, mainName)
      await removeSegmentByName(request, token, otherName)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('unsaved segment work is guarded when switching segments and when leaving the screen', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const otherName = `QA UI guard ${stamp}`
    const draftName = `QA UI unsaved ${stamp}`
    try {
      await createSegment(request, token, otherName, `QA UI Guard Nobody ${stamp}`)
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/segments', SEGMENTS_PATH)
      const row = segmentRow(page, otherName)
      await expect(row).toBeVisible({ timeout: 20_000 })

      await fillControlledInput(page.locator('#segment-name'), draftName)
      await page.getByRole('button', { name: 'Add First Condition' }).click()

      await row.getByRole('button', { name: 'Edit' }).click()
      await confirmDialog(page, 'Cancel', 'This segment has changes that have not been saved.')
      await expect(page.locator('#segment-name')).toHaveValue(draftName)
      await expect(page.getByPlaceholder('e.g., status, user.email')).toBeVisible()

      const url = page.url()
      const away = page.locator('a[href^="/backend"]:not([href^="/backend/marketing/segments"])').filter({ visible: true }).first()
      await away.click()
      await confirmDialog(page, 'Cancel', 'Discard unsaved changes?')
      expect(page.url()).toBe(url)
      await expect(page.locator('#segment-name')).toHaveValue(draftName)

      await away.click()
      await confirmDialog(page, 'Confirm', 'Discard unsaved changes?')
      await expect(page).not.toHaveURL(/\/backend\/marketing\/segments/, { timeout: 20_000 })
      expect(await findSegment(request, token, draftName)).toBeNull()
    } finally {
      await removeSegmentByName(request, token, otherName)
      await removeSegmentByName(request, token, draftName)
    }
  })

  test('an operator creates, edits and removes a content block', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `qa-ui-block-${stamp}`
    try {
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/content-blocks', BLOCKS_PATH)

      await expect(page.getByText('New block').first()).toBeVisible()
      await expect(page.getByText('Lowercase letters, digits, dashes. Referenced in a message as {{block:key}}.')).toBeVisible()
      const save = page.getByRole('button', { name: 'Save' })
      await expect(save).toBeDisabled()

      await fillControlledInput(page.locator('#block-key'), key)
      await expect(save).toBeDisabled()
      await fillControlledInput(page.locator('#block-name'), 'QA UI footer')
      await expect(save).toBeEnabled()
      await fillControlledInput(page.locator('#block-html'), '<p>QA footer</p>')
      await save.click()
      await expect(page.getByText('Saved.')).toBeVisible({ timeout: 20_000 })

      const row = page.getByRole('row', { name: new RegExp(key) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText(`{{block:${key}}}`)
      await expect(row).toContainText('QA UI footer')
      expect(await findBlock(request, token, key)).toMatchObject({ name: 'QA UI footer', html: '<p>QA footer</p>' })

      await row.getByRole('button', { name: 'Edit' }).click()
      await expect(page.getByText(`Editing ${key}`)).toBeVisible()
      // The reference is immutable once created: messages point at it.
      await expect(page.locator('#block-key')).toBeDisabled()
      await expect(page.locator('#block-key')).toHaveValue(key)
      await expect(page.locator('#block-html')).toHaveValue('<p>QA footer</p>')
      await fillControlledInput(page.locator('#block-html'), '<p>QA footer, edited</p>')
      await save.click()
      await expect.poll(async () => (await findBlock(request, token, key))?.html, { timeout: 20_000 })
        .toBe('<p>QA footer, edited</p>')
      await expect(page.getByText('New block').first()).toBeVisible()

      await row.getByRole('button', { name: 'Remove' }).click()
      await confirmDialog(page, 'Confirm', 'Messages that reference it will render nothing in its place.')
      await expect(row).toBeHidden({ timeout: 20_000 })
      expect(await findBlock(request, token, key)).toBeNull()
    } finally {
      await removeBlockByKey(request, token, key)
    }
  })

  test('a taken content block reference is refused on the screen', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const takenKey = `qa-ui-taken-${Date.now()}`
    try {
      const taken = await apiRequest(request, 'POST', BLOCKS_PATH, {
        token,
        data: { key: takenKey, name: 'QA UI taken', html: '<p>taken</p>' },
      })
      expect(taken.status()).toBe(200)

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/content-blocks', BLOCKS_PATH)
      await fillControlledInput(page.locator('#block-key'), takenKey)
      await fillControlledInput(page.locator('#block-name'), 'QA UI duplicate')
      const refused = page.waitForResponse((response) =>
        response.url().includes(BLOCKS_PATH) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Save' }).click()
      expect((await refused).status()).toBe(409)
      await expect(page.getByText('A block with that reference already exists.')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#block-key')).toHaveValue(takenKey)
      await expect(page.getByRole('row', { name: new RegExp(takenKey) })).toHaveCount(1)
    } finally {
      await removeBlockByKey(request, token, takenKey)
    }
  })

  test('a segment defined in terms of segments is refused on the screen', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `QA UI nested ${Date.now()}`
    try {
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/segments', SEGMENTS_PATH)
      await fillControlledInput(page.locator('#segment-name'), name)
      await page.getByRole('button', { name: 'Add First Condition' }).click()
      await fillControlledInput(page.getByPlaceholder('e.g., status, user.email'), 'segments')
      await page.getByRole('combobox').filter({ hasText: 'Equals' }).click()
      await page.getByRole('option', { name: 'Contains', exact: true }).click()
      await fillControlledInput(page.getByPlaceholder('e.g., "ACTIVE" or ["A","B"]'), 'anything')
      const refused = page.waitForResponse((response) =>
        response.url().includes(SEGMENTS_PATH) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Save' }).click()
      expect((await refused).status()).toBe(400)
      await expect(page.getByText('A segment cannot be defined in terms of other segments.')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#segment-name')).toHaveValue(name)
      expect(await findSegment(request, token, name)).toBeNull()
    } finally {
      await removeSegmentByName(request, token, name)
    }
  })
})
