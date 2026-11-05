import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  undoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.dictionaryEntries (#2572).
 *
 * Dictionary entries are organization-scoped lookup values. Creating an entry then undoing
 * must remove it (I3) and reject the consumed token (I5); deleting an entry then undoing must
 * re-materialize it (I2). Entries are read back through the kind list. Self-contained: every
 * entry is created with a unique value and removed in teardown.
 */

const KIND = 'source'
const DICT = `/api/customers/dictionaries/${KIND}`

async function entryExists(
  request: APIRequestContext,
  token: string,
  entryId: string,
): Promise<boolean> {
  const res = await apiRequest(request, 'GET', DICT, { token })
  const body = (await readJsonSafe(res)) as { items?: Array<{ id: string }> } | null
  return Boolean(body?.items?.some((entry) => entry.id === entryId))
}

test.describe('TC-UNDO-001 customers.dictionaryEntries undo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create entry → undo removes it (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let entryId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', DICT, {
        token,
        data: { value: `undo-src-${stamp}`, label: `Undo Source ${stamp}` },
      })
      expect(createRes.status(), `dictionary create status ${createRes.status()}`).toBe(201)
      const createOp = expectOperation(createRes, 'dictionaryEntries.create')
      const createBody = (await readJsonSafe(createRes)) as { id?: string } | null
      entryId = createBody?.id ?? null
      expect(entryId, 'entry id present').toBeTruthy()
      expect(await entryExists(request, token, entryId as string), 'entry present after create').toBe(true)

      await undoOk(request, token, createOp.undoToken, 'undo dictionary-entry create')
      expect(await entryExists(request, token, entryId as string), 'entry removed on undo (I3)').toBe(false)

      await expectTokenConsumed(request, token, createOp.undoToken, 'dictionaryEntries.create double-undo (I5)')
    } finally {
      if (entryId) await apiRequest(request, 'DELETE', `${DICT}/${entryId}`, { token }).catch(() => {})
    }
  })

  test('delete entry → undo re-materializes it (I2)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let entryId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', DICT, {
        token,
        data: { value: `undo-src-del-${stamp}`, label: `Undo Source Del ${stamp}` },
      })
      expect(createRes.status(), `dictionary create status ${createRes.status()}`).toBe(201)
      entryId = ((await readJsonSafe(createRes)) as { id?: string } | null)?.id ?? null
      expect(entryId, 'entry id present').toBeTruthy()

      const deleteRes = await apiRequest(request, 'DELETE', `${DICT}/${entryId}`, { token })
      expect(deleteRes.ok(), `dictionary delete status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'dictionaryEntries.delete')
      expect(await entryExists(request, token, entryId as string), 'entry gone after delete').toBe(false)

      await undoOk(request, token, deleteOp.undoToken, 'undo dictionary-entry delete')
      expect(await entryExists(request, token, entryId as string), 'entry re-materialized on undo (I2)').toBe(true)
    } finally {
      if (entryId) await apiRequest(request, 'DELETE', `${DICT}/${entryId}`, { token }).catch(() => {})
    }
  })
})
