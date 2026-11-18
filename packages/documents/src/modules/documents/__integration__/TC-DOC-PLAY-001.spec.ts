import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createPlaybook,
  createPlaybookOrFail,
  deletePlaybookIfExists,
  OPTIMISTIC_LOCK_HEADER,
  PLAYBOOKS_PATH,
  readPlaybook,
  uniqueCode,
} from './helpers/reviewPlaybookFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-PLAY-001: review playbook CRUD', () => {
  test('creates, updates with a version bump, enforces unique codes and deletes', async ({ request }) => {
    let adminToken: string | null = null
    let playbookId: string | null = null
    let reusedId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const code = uniqueCode('nda')
      playbookId = await createPlaybookOrFail(request, adminToken, {
        code,
        name: 'Mutual NDA review',
        instructions: 'Check every clause against the firm positions.',
      })
      const created = await readPlaybook(request, adminToken, playbookId)
      expect(created).toMatchObject({ code, name: 'Mutual NDA review', version: 1, isActive: true })
      expect(typeof created?.updatedAt).toBe('string')

      const duplicate = await createPlaybook(request, adminToken, { code, name: 'Duplicate' })
      expect(duplicate.response.status(), 'duplicate code should be rejected').toBe(409)
      expect(duplicate.body?.code).toBe('documents.reviewPlaybooks.errors.codeTaken')

      const update = await apiRequest(request, 'PUT', PLAYBOOKS_PATH, {
        token: adminToken,
        data: { id: playbookId, name: 'Mutual NDA review v2' },
        headers: { [OPTIMISTIC_LOCK_HEADER]: created?.updatedAt ?? '' },
      })
      expect(update.status(), 'PUT review playbook should return 200').toBe(200)
      const updated = await readPlaybook(request, adminToken, playbookId)
      expect(updated).toMatchObject({ name: 'Mutual NDA review v2', version: 2 })

      const stale = await apiRequest(request, 'PUT', PLAYBOOKS_PATH, {
        token: adminToken,
        data: { id: playbookId, name: 'Stale write' },
        headers: { [OPTIMISTIC_LOCK_HEADER]: created?.updatedAt ?? '' },
      })
      expect(stale.status(), 'stale PUT should conflict').toBe(409)

      const remove = await apiRequest(request, 'DELETE', `${PLAYBOOKS_PATH}?id=${encodeURIComponent(playbookId)}`, {
        token: adminToken,
        headers: { [OPTIMISTIC_LOCK_HEADER]: updated?.updatedAt ?? '' },
      })
      expect(remove.status(), 'DELETE review playbook should return 200').toBe(200)
      expect(await readJsonSafe<{ ok?: boolean }>(remove)).toMatchObject({ ok: true })
      expect(await readPlaybook(request, adminToken, playbookId)).toBeNull()
      playbookId = null

      reusedId = await createPlaybookOrFail(request, adminToken, { code, name: 'Code reused after delete' })
    } finally {
      await deletePlaybookIfExists(request, adminToken, playbookId)
      await deletePlaybookIfExists(request, adminToken, reusedId)
    }
  })
})
