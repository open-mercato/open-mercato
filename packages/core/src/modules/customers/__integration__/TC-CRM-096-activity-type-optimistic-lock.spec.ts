import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import type { CalendarEventTypeBehavior } from '../calendar-event-types'
import type { ScopedCalendarEventType } from '../lib/calendar/eventTypeResolver'

const CATALOG_PATH = '/api/customers/activity-types'
const DICTIONARY_PATH = '/api/customers/dictionaries/activity-types'
const SETTINGS_PATH = '/backend/config/customers#customer-dictionary-activity-types'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const TYPE_KEY = 'note'
const FIRST_LABEL = 'Note (first tab)'
const STALE_LABEL = 'Note (stale tab)'

type DictionaryRow = {
  id: string
  value: string
  label: string
  behavior: CalendarEventTypeBehavior | null
  isInherited: boolean
  updatedAt: string
}

const test = base.extend<{ note: { path: string; token: string; version: string } }>({
  note: async ({ request }, runTest) => {
    const token = await getAuthToken(request, 'admin')
    const original = await readNoteRow(request, token)
    expect(original.updatedAt).toBeTruthy()
    expect(await readNoteType(request, token)).toMatchObject({ updatedAt: null })

    const path = `${DICTIONARY_PATH}/${original.id}`
    try {
      await runTest({ path, token, version: original.updatedAt })
    } finally {
      const current = await readNoteRow(request, token)
      if (current.label === FIRST_LABEL || current.label === STALE_LABEL) {
        const restored = await apiRequest(request, 'PATCH', path, {
          token,
          headers: { [LOCK_HEADER]: current.updatedAt },
          data: { label: original.label, behavior: original.behavior },
        })
        expect(restored.status()).toBe(200)
        expect(await readNoteType(request, token)).toMatchObject({ updatedAt: null })
      }
    }
  },
})

async function readNoteRow(request: APIRequestContext, token: string): Promise<DictionaryRow> {
  const response = await apiRequest(request, 'GET', DICTIONARY_PATH, { token })
  expect(response.status()).toBe(200)
  const { items } = await response.json() as { items: DictionaryRow[] }
  const row = items.find((item) => item.value === TYPE_KEY && !item.isInherited)
  if (!row) throw new Error('[internal] Expected a seeded local Note activity type row')
  return row
}

async function readNoteType(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', CATALOG_PATH, { token })
  expect(response.status()).toBe(200)
  const { items } = await response.json() as { items: ScopedCalendarEventType[] }
  return items.find((item) => item.key === TYPE_KEY)
}

async function openNoteEditor(page: Page): Promise<Locator> {
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: TYPE_KEY, exact: true }) })
  await row.getByRole('button', { name: 'Open actions' }).click()
  await page.getByRole('menuitem', { name: 'Configure' }).click()
  return page.getByRole('dialog', { name: 'Configure' })
}

async function saveNote(page: Page, dialog: Locator, path: string) {
  const [patch] = await Promise.all([
    page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname === path),
    dialog.getByRole('button', { name: 'Save', exact: true }).click(),
  ])
  return { patch, response: await patch.response() }
}

test('TC-CRM-096: first edit of a built-in activity type rejects a stale second save', async ({ page, context, request, note }) => {
  await login(page, 'admin')
  const stalePage = await context.newPage()
  await Promise.all([page.goto(SETTINGS_PATH), stalePage.goto(SETTINGS_PATH)])
  const firstDialog = await openNoteEditor(page)
  const staleDialog = await openNoteEditor(stalePage)
  await firstDialog.getByRole('textbox', { name: /^Label\b/ }).fill(FIRST_LABEL)
  await firstDialog.getByRole('checkbox', { name: 'Priority', exact: true }).check()
  await staleDialog.getByRole('textbox', { name: /^Label\b/ }).fill(STALE_LABEL)

  const first = await saveNote(page, firstDialog, note.path)
  expect(await first.patch.headerValue(LOCK_HEADER)).toBe(note.version)
  expect(first.response?.status()).toBe(200)

  const stale = await saveNote(stalePage, staleDialog, note.path)
  expect(await stale.patch.headerValue(LOCK_HEADER)).toBe(note.version)
  expect(stale.response?.status()).toBe(409)
  await expect(stalePage.getByTestId('record-conflict-banner')).toBeVisible()

  expect(await readNoteType(request, note.token)).toMatchObject({
    label: FIRST_LABEL,
    behavior: { fields: { priority: true } },
  })
})
