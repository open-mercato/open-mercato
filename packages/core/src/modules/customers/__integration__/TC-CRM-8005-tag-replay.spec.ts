import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const tagsPath = '/api/customers/tags'

for (const resource of ['people', 'companies'] as const) {
  test(`TC-CRM-8005 ${resource} update replays after a recorded tag is deleted`, async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const path = `/api/customers/${resource}`
    const stamp = randomUUID()
    const tagIds: string[] = []
    let id: string | null = null

    try {
      for (const label of ['kept', 'deleted']) {
        const response = await apiRequest(request, 'POST', tagsPath, {
          token,
          data: { label: `Replay ${label} ${stamp}`, slug: `replay-${label}-${stamp}` },
        })
        expect(response.status()).toBe(201)
        tagIds.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tag id'))
      }

      const before = `Before ${stamp}`
      const after = `After ${stamp}`
      const record = await apiRequest(request, 'POST', path, {
        token,
        data: {
          displayName: before,
          tags: tagIds,
          ...(resource === 'people' ? { firstName: 'Tag', lastName: 'Replay' } : {}),
        },
      })
      expect(record.status()).toBe(201)
      id = expectId((await readJsonSafe<{ id?: string }>(record))?.id, 'customer id')

      const update = await apiRequest(request, 'PUT', path, { token, data: { id, displayName: after, tags: tagIds } })
      expect(update.status()).toBe(200)
      const operation = expectOperation(update, `customers.${resource}.update`)

      const deletion = await apiRequest(request, 'DELETE', `${tagsPath}?id=${tagIds[1]}`, { token })
      expect(deletion.ok()).toBeTruthy()

      async function expectState(displayName: string) {
        const detail = await apiRequest(request, 'GET', `${path}/${id}`, { token })
        expect(detail.status()).toBe(200)
        const body = await readJsonSafe<{
          person?: { displayName: string }
          company?: { displayName: string }
          tags?: Array<{ id: string }>
        }>(detail)
        expect(body?.person?.displayName ?? body?.company?.displayName).toBe(displayName)
        expect(body?.tags?.map((tag) => tag.id)).toEqual([tagIds[0]])
      }

      await undoOk(request, token, operation.undoToken, 'update after tag deletion')
      await expectState(before)
      await redoOk(request, token, operation.logId, 'update after tag deletion')
      await expectState(after)

      const liveUpdate = await apiRequest(request, 'PUT', path, { token, data: { id, tags: tagIds } })
      expect(liveUpdate.status()).toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, path, id)
      for (const tagId of tagIds) await deleteEntityIfExists(request, token, tagsPath, tagId)
    }
  })
}
