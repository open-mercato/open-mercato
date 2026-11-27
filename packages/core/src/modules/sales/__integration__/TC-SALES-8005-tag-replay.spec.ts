import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSalesOrderFixture, createSalesQuoteFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const tagsPath = '/api/sales/tags'

for (const resource of ['orders', 'quotes'] as const) {
  test(`TC-SALES-8005 ${resource} update replays after a recorded tag is deleted`, async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const path = `/api/sales/${resource}`
    const stamp = randomUUID()
    const tagIds: string[] = []
    let id: string | null = null

    try {
      for (const label of ['kept', 'deleted']) {
        const response = await apiRequest(request, 'POST', tagsPath, {
          token,
          data: { label: `Replay ${label} ${stamp}` },
        })
        expect(response.status()).toBe(201)
        tagIds.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tag id'))
      }

      id = resource === 'orders'
        ? await createSalesOrderFixture(request, token)
        : await createSalesQuoteFixture(request, token)
      const before = `Before ${stamp}`
      const after = `After ${stamp}`

      const original = await apiRequest(request, 'PUT', path, { token, data: { id, comment: before, tags: tagIds } })
      expect(original.status()).toBe(200)
      const update = await apiRequest(request, 'PUT', path, { token, data: { id, comment: after, tags: tagIds } })
      expect(update.status()).toBe(200)
      const operation = expectOperation(update, `sales.${resource}.update`)

      const deletion = await apiRequest(request, 'DELETE', `${tagsPath}?id=${tagIds[1]}`, { token })
      expect(deletion.ok()).toBeTruthy()

      async function expectState(comment: string) {
        const response = await apiRequest(request, 'GET', `${path}?id=${id}&probe=${randomUUID()}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ items?: Array<{ id: string; comment: string; tags?: Array<{ id: string }> }> }>(response)
        const document = body?.items?.find((item) => item.id === id)
        expect(document?.comment).toBe(comment)
        expect(document?.tags?.map((tag) => tag.id)).toEqual([tagIds[0]])
      }

      await undoOk(request, token, operation.undoToken, 'update after tag deletion')
      await expectState(before)
      await redoOk(request, token, operation.logId, 'update after tag deletion')
      await expectState(after)

      const liveUpdate = await apiRequest(request, 'PUT', path, { token, data: { id, tags: tagIds } })
      expect(liveUpdate.status()).toBe(400)
    } finally {
      await deleteSalesEntityIfExists(request, token, path, id)
      for (const tagId of tagIds) await deleteSalesEntityIfExists(request, token, tagsPath, tagId)
    }
  })
}
