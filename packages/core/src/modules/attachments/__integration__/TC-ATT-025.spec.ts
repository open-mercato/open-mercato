import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'messages'],
}

/**
 * TC-ATT-025: The record attachment list is bounded without page/pageSize
 * Source: GitHub issue #3816
 * Surfaces: GET /api/attachments?entityId=&recordId= (unpaginated and paginated forms) and the
 * message composer's "Save draft" on a draft that holds more attachments than one page.
 *
 * One unpaginated request must not load and decrypt every attachment of a record, while paging
 * still reaches every row. The composer sends the full attachment id list on a draft save and the
 * server deletes the attachments missing from it, so the composer has to page through the list.
 */

const CAP = 100
const UPLOADS = CAP + 1

type ListBody = { items?: Array<{ id: string }>; total?: number; totalPages?: number }

async function listAttachments(
  request: APIRequestContext,
  token: string,
  query: Record<string, string>,
): Promise<ListBody> {
  const params = new URLSearchParams(query)
  const response = await apiRequest(request, 'GET', `/api/attachments?${params.toString()}`, { token })
  expect(response.status(), `GET /api/attachments?${params.toString()}`).toBe(200)
  return (await readJsonSafe<ListBody>(response)) ?? {}
}

async function uploadMany(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
  created: string[],
): Promise<void> {
  for (let index = 0; index < UPLOADS; index += 1) {
    const uploaded = await uploadAttachmentFixture(request, token, {
      entityId,
      recordId,
      fileName: `tc-att-025-${index}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`tc-att-025 ${index}\n`),
    })
    created.push(uploaded.id)
  }
}

async function listAllIds(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
): Promise<{ ids: Set<string>; total: number | undefined }> {
  const firstPage = await listAttachments(request, token, { entityId, recordId, page: '1', pageSize: String(CAP) })
  const secondPage = await listAttachments(request, token, { entityId, recordId, page: '2', pageSize: String(CAP) })
  const ids = new Set([...(firstPage.items ?? []), ...(secondPage.items ?? [])].map((item) => item.id))
  return { ids, total: firstPage.total }
}

test.describe('TC-ATT-025: unpaginated attachment list is capped (#3816)', () => {
  test('returns at most 100 rows without paging and every row with paging', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const entityId = 'attachments:library'
    const recordId = `tc-att-025-${randomUUID()}`
    const created: string[] = []

    try {
      await uploadMany(request, token, entityId, recordId, created)

      const unpaged = await listAttachments(request, token, { entityId, recordId })
      expect(unpaged.items?.length).toBe(CAP)
      expect(unpaged.total, 'unpaginated wire shape stays unchanged').toBeUndefined()

      const onlyPageSize = await listAttachments(request, token, { entityId, recordId, pageSize: '5' })
      expect(onlyPageSize.items?.length).toBe(CAP)

      const paged = await listAllIds(request, token, entityId, recordId)
      expect(paged.total).toBe(UPLOADS)
      expect(paged.ids.size).toBe(UPLOADS)
      for (const id of created) expect(paged.ids.has(id)).toBe(true)
    } finally {
      for (const id of created) await deleteAttachmentIfExists(request, token, id)
    }
  })

  test('saving a draft with more than 100 attachments keeps every attachment', async ({ page, request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const subject = `QA TC-ATT-025 ${Date.now()}`
    const created: string[] = []
    let draftId: string | null = null

    try {
      const draftResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: { subject, body: 'Draft with many attachments', isDraft: true, sendViaEmail: false },
      })
      expect(draftResponse.status()).toBe(201)
      draftId = ((await readJsonSafe<{ id?: string }>(draftResponse)) ?? {}).id ?? null
      expect(typeof draftId).toBe('string')
      const messageId = draftId as string

      await uploadMany(request, token, 'messages:message', messageId, created)

      await login(page, 'admin')
      await page.goto(`/backend/messages/${messageId}`)
      const actionsButton = page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).first()
      const editItem = page.getByRole('menuitem', { name: /^Edit$|messages\.actions\.edit/i }).first()
      await expect(async () => {
        if (!(await editItem.isVisible().catch(() => false))) await actionsButton.click()
        await expect(editItem).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await editItem.click()
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes(`/api/messages/${messageId}`),
        { timeout: 30_000 },
      )
      await page.getByRole('button', { name: /save draft/i }).click()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok(), `PATCH /api/messages/${messageId}`).toBe(true)

      const remaining = await listAllIds(request, token, 'messages:message', messageId)
      expect(remaining.total).toBe(UPLOADS)
      for (const id of created) expect(remaining.ids.has(id)).toBe(true)
    } finally {
      for (const id of created) await deleteAttachmentIfExists(request, token, id)
      if (draftId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(draftId)}`, { token }).catch(() => undefined)
      }
    }
  })
})
