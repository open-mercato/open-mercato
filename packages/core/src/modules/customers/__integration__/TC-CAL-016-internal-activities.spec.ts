import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  escapeRegExp,
  INTERACTIONS_PATH,
  listInteractionsInWindow,
  localTimeAt,
  pressKeyUntil,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures'

const PEOPLE_PATH = '/api/customers/people'

async function openAgenda(page: Page) {
  await page.goto('/backend/calendar')
  await waitForCalendarLoaded(page)
  await pressKeyUntil(page, 'a', async () => {
    await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible({ timeout: 1_000 })
  })
}

async function saveEvent(page: Page, editor: Locator, method: 'POST' | 'PUT') {
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === INTERACTIONS_PATH && response.request().method() === method,
    ),
    editor.getByRole('button', { name: 'Save event', exact: true }).click(),
  ])
  return response
}

test.describe('TC-CAL-016 internal activities', () => {
  test('creates a meeting without a CRM record, then attaches and clears a link on the same meeting', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const title = `Internal standup ${stamp}`
    const personName = `Calendar link ${stamp}`
    let personId: string | null = null
    let interactionId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar', lastName: `link ${stamp}`, displayName: personName,
      })
      const scopedWindow = { entityId: personId, from: localTimeAt(-1, 0, 0), to: localTimeAt(8, 0, 0) }
      await seedShowWeekendsPreference(page, getTokenScope(token).userId)
      await login(page, 'admin')
      await openAgenda(page)

      await page.getByRole('button', { name: 'New event', exact: true }).click()
      const newEditor = page.getByRole('dialog', { name: 'New event' })
      await newEditor.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
      await expect(newEditor.getByRole('button', { name: 'Clear related record' })).toHaveCount(0)
      const created = await saveEvent(page, newEditor, 'POST')
      expect(created.status()).toBe(201)
      const createdBody: { id?: unknown } = await created.json()
      interactionId = expectId(createdBody.id, 'The internal meeting should have an id')
      expect(created.request().postDataJSON()).toMatchObject({ entityId: null, dealId: null })
      await expect(newEditor).toBeHidden()

      const item = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}, `) }).first()
      const editor = page.getByRole('dialog', { name: 'Edit event' })
      await item.click()
      await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
      await editor.getByRole('button', { name: 'Related to', exact: true }).click()
      await editor.getByRole('textbox', { name: 'Search people or companies…' }).fill(personName)
      await editor.getByRole('option', { name: new RegExp(escapeRegExp(personName)) }).click()
      await editor.getByRole('textbox', { name: 'Title', exact: true }).click()
      const attached = await saveEvent(page, editor, 'PUT')
      expect(attached.ok()).toBeTruthy()
      expect(attached.request().postDataJSON()).toMatchObject({ id: interactionId, entityId: personId })
      expect(await attached.request().headerValue(OPTIMISTIC_LOCK_HEADER_NAME)).toBeTruthy()
      await expect(editor).toBeHidden()
      expect(await listInteractionsInWindow(request, token, scopedWindow)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: interactionId, entityId: personId, title })]),
      )

      await openAgenda(page)
      await item.click()
      await editor.getByRole('button', { name: 'Clear related record' }).click()
      const cleared = await saveEvent(page, editor, 'PUT')
      expect(cleared.ok()).toBeTruthy()
      expect(cleared.request().postDataJSON()).toMatchObject({ id: interactionId, entityId: null, dealId: null })
      await expect(editor).toBeHidden()
      expect((await listInteractionsInWindow(request, token, scopedWindow)).some((row) => row.id === interactionId)).toBe(false)

      await openAgenda(page)
      await item.click()
      await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
      await expect(editor.getByRole('button', { name: 'Clear related record' })).toHaveCount(0)
    } finally {
      await deleteEntityIfExists(request, token, INTERACTIONS_PATH, interactionId)
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
    }
  })

  test('shows an unlinked task in global Tasks and excludes it from the person’s Tasks tab', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const internalTitle = `Internal task ${stamp}`
    const linkedTitle = `Linked task ${stamp}`
    const activityIds: string[] = []
    let personId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Internal', lastName: `tasks ${stamp}`, displayName: `Internal tasks ${stamp}`,
      })
      for (const data of [{ title: internalTitle }, { title: linkedTitle, entityId: personId }]) {
        const response = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
          token,
          data: { interactionType: 'task', ...data },
        })
        expect(response.status()).toBe(201)
        const body = await readJsonSafe<{ id?: unknown }>(response)
        activityIds.push(expectId(body?.id, 'The task should have an id'))
      }

      await login(page, 'admin')
      await page.goto('/backend/customer-tasks')
      await expect(page.getByRole('heading', { name: 'Customer related tasks', exact: true })).toBeVisible()
      await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(String(stamp))
      const internalRow = page.getByRole('row').filter({ hasText: internalTitle })
      await expect(internalRow).toBeVisible()
      await expect(internalRow.getByRole('link')).toHaveCount(0)
      await expect(page.getByRole('row').filter({ hasText: linkedTitle }).getByRole('link')).toBeVisible()

      await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
      await expect(page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('article').filter({ hasText: linkedTitle })).toBeVisible()
      await expect(page.getByText(internalTitle, { exact: true })).toHaveCount(0)
    } finally {
      for (const id of activityIds) await deleteEntityIfExists(request, token, INTERACTIONS_PATH, id)
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
    }
  })
})
