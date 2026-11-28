import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'

const interactionsPath = '/api/customers/interactions'
const activitiesPath = '/api/customers/activities'
const authoredBody = 'Follow up on the activity and keep the literal &#x20; and &amp; in the note. '
const legacyBody = 'Literal plaintext <reference> &amp; &#x20;'

type Note = {
  entityId: string
  dealId?: string
  occurredAt: string
  subject: string
  body: string
  appearanceIcon?: string
}

async function createCompletedNote(request: APIRequestContext, token: string, note: Note): Promise<string> {
  const response = await apiRequest(request, 'POST', activitiesPath, {
    token,
    data: { ...note, activityType: 'note' },
  })
  expect(response.status(), await response.text()).toBe(201)
  const result = await readJsonSafe<{ id?: string }>(response)
  return expectId(result?.id, 'Completed activity ID')
}

function history(page: Page) {
  return page.getByRole('heading', { name: /^Interaction history(?: with .+)?$/ }).locator('xpath=../..')
}

async function openNoteEditor(page: Page, title: string) {
  await history(page).getByText(title, { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit activity', exact: true })
  const editor = dialog.locator('.om-mdx-prose')
  await expect(editor).toBeVisible()
  return { dialog, editor }
}

async function editNote(page: Page, title: string): Promise<string> {
  const { dialog, editor } = await openNoteEditor(page, title)
  await dialog.getByRole('button', { name: 'Note', exact: true }).click()
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.insertText(authoredBody)

  const save = page.waitForResponse((response) =>
    new URL(response.url()).pathname === interactionsPath && response.request().method() === 'PUT')
  await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
  const response = await save
  expect(response.status(), await response.text()).toBe(200)
  const input = response.request().postDataJSON() as { body: string; bodyFormat?: string }
  expect(input.bodyFormat).toBe('markdown')
  expect(input.body, 'the editor should serialize the trailing space').toMatch(/&#x20;$/i)
  await expect(dialog).toBeHidden()
  return input.body
}

async function expectPreviews(page: Page) {
  const activityHistory = history(page)
  const markdownPreview = activityHistory.getByText(authoredBody.trimEnd(), { exact: true })
  await expect(markdownPreview).toBeVisible()
  expect(await markdownPreview.textContent()).toBe(authoredBody)
  await expect(activityHistory.getByText(legacyBody, { exact: true })).toBeVisible()
  await markdownPreview.scrollIntoViewIfNeeded()
}

test('TC-CRM-10328: deal and person previews distinguish serialized Markdown from literal entities', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  const title = `Markdown note ${stamp}`
  const occurredAt = new Date().toISOString()
  let personId: string | null = null
  let dealId: string | null = null
  const noteIds: string[] = []

  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'QA', lastName: stamp, displayName: `Activity preview person ${stamp}`,
    })
    dealId = await createDealFixture(request, token, {
      title: `Activity preview deal ${stamp}`, personIds: [personId],
    })
    const noteId = await createCompletedNote(request, token, {
      entityId: personId, dealId, occurredAt, subject: title, body: 'Original note', appearanceIcon: 'StickyNote',
    })
    noteIds.push(noteId)
    noteIds.push(await createCompletedNote(request, token, {
      entityId: personId, dealId, occurredAt, subject: `Plain note ${stamp}`, body: legacyBody,
    }))

    await login(page, 'admin')
    await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    const savedBody = await editNote(page, title)
    await expectPreviews(page)

    const storedResponse = await apiRequest(request, 'GET', `${interactionsPath}?entityId=${personId}&dealId=${dealId}`, { token })
    expect(storedResponse.ok(), await storedResponse.text()).toBeTruthy()
    const stored = await readJsonSafe<{ items: Array<{ id: string }> }>(storedResponse)
    expect(stored?.items.find(({ id }) => id === noteId)).toMatchObject({
      body: savedBody,
      bodyFormat: 'markdown',
      entityId: personId,
      dealId,
      status: 'done',
      occurredAt,
      scheduledAt: null,
      visibility: null,
      appearanceIcon: 'StickyNote',
    })

    const { dialog, editor } = await openNoteEditor(page, title)
    await expect.poll(async () => (await editor.textContent())?.replace(/\u00a0/g, ' ')).toBe(authoredBody)
    await dialog.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(`/backend/customers/deals/${dealId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    await expectPreviews(page)

    await page.route((url) => url.pathname === interactionsPath && url.searchParams.get('limit') === '50', (route) =>
      route.fulfill({ json: { items: [] } }))
    await page.goto(`/backend/customers/people/${personId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    await expectPreviews(page)
  } finally {
    for (const id of noteIds) await deleteEntityIfExists(request, token, interactionsPath, id)
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})

test('TC-CRM-10328: legacy and V2 company previews preserve literal entities', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  const title = `Markdown note ${stamp}`
  const occurredAt = new Date().toISOString()
  let companyId: string | null = null
  const noteIds: string[] = []

  try {
    companyId = await createCompanyFixture(request, token, `Activity preview company ${stamp}`)
    noteIds.push(await createCompletedNote(request, token, {
      entityId: companyId, occurredAt, subject: title, body: 'Original note',
    }))
    noteIds.push(await createCompletedNote(request, token, {
      entityId: companyId, occurredAt, subject: `Plain note ${stamp}`, body: legacyBody,
    }))

    await login(page, 'admin')
    await page.goto(`/backend/customers/companies-v2/${companyId}?tab=activity-log`, { waitUntil: 'domcontentloaded' })
    await editNote(page, title)
    await expectPreviews(page)

    await page.goto(`/backend/customers/companies/${companyId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    await expectPreviews(page)
  } finally {
    for (const id of noteIds) await deleteEntityIfExists(request, token, interactionsPath, id)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
