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
 * TC-UNDO-001 customers.dictionaryKindSettings (#2572).
 *
 * Kind settings are an org-scoped upsert: the first upsert for a brand-new kind creates the
 * settings row, so undoing it must remove the row (I3) and reject the consumed token (I5).
 * Self-contained: a unique custom kind is used so no shared/seeded settings row is touched, and
 * the row is removed by the undo under test.
 */

const KIND_SETTINGS = '/api/customers/dictionaries/kind-settings'

async function kindSettingExists(
  request: APIRequestContext,
  token: string,
  kind: string,
): Promise<boolean> {
  const res = await apiRequest(request, 'GET', KIND_SETTINGS, { token })
  const body = (await readJsonSafe(res)) as { items?: Array<{ kind: string }> } | null
  return Boolean(body?.items?.some((entry) => entry.kind === kind))
}

test.describe('TC-UNDO-001 customers.dictionaryKindSettings undo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('upsert new kind setting → undo removes it (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const kind = `undo_kind_${Date.now()}`
    let createOp: ReturnType<typeof expectOperation> | null = null
    try {
      const upsertRes = await apiRequest(request, 'PATCH', KIND_SETTINGS, {
        token,
        data: { kind, selectionMode: 'single', visibleInTags: true, sortOrder: 3 },
      })
      expect(upsertRes.ok(), `kind-settings upsert status ${upsertRes.status()}`).toBeTruthy()
      createOp = expectOperation(upsertRes, 'dictionaryKindSettings.upsert')
      expect(await kindSettingExists(request, token, kind), 'kind setting present after upsert').toBe(true)

      await undoOk(request, token, createOp.undoToken, 'undo kind-settings upsert')
      expect(await kindSettingExists(request, token, kind), 'kind setting removed on undo (I3)').toBe(false)

      await expectTokenConsumed(request, token, createOp.undoToken, 'dictionaryKindSettings.upsert double-undo (I5)')
      createOp = null
    } finally {
      // If undo did not run (early failure), best-effort consume the create so the row does not leak.
      if (createOp) await undoOk(request, token, createOp.undoToken, 'cleanup kind-settings upsert').catch(() => {})
    }
  })
})
