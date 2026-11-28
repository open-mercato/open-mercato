import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  patchDistribution,
  readDistribution,
} from '@open-mercato/core/helpers/integration/formsFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-FORMS-LOCK-002 — forms undo refuses once the record changed after the logged action.
 *
 * Undo writes back the snapshot taken before the action. When another admin changed the
 * record afterwards, the undo answers 409 `forms.errors.undo_conflict` and the newer change
 * is kept. Undoing your own actions one after the other still restores each previous state.
 */

const UNDO_CONFLICT_CODE = 'forms.errors.undo_conflict'

async function renameForm(request: APIRequestContext, token: string, formId: string, name: string) {
  const response = await apiRequest(request, 'PATCH', `/api/forms/${formId}`, { token, data: { name } })
  expect(response.status(), `rename to ${name}: ${await response.text()}`).toBe(200)
  return expectOperation(response, `rename to ${name}`)
}

async function readFormName(request: APIRequestContext, token: string, formId: string): Promise<string | undefined> {
  const response = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ name?: string }>(response))?.name
}

async function expectUndoConflict(request: APIRequestContext, token: string, undoToken: string) {
  const undo = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<{ error?: string; code?: string }>(undo)
  expect(undo.status(), `stale undo body ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code).toBe(UNDO_CONFLICT_CODE)
  expect(body?.error).toBeTruthy()
}

test.describe('TC-FORMS-LOCK-002: forms undo refuses a stale snapshot', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of an older rename keeps a newer rename by another admin', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const otherToken = await getAuthToken(request, 'superadmin')
    let formId: string | null = null
    try {
      formId = (await createFormFixture(request, adminToken, { name: 'QA LOCK002 Draft Intake' })).id
      const adminRename = await renameForm(request, adminToken, formId, 'QA LOCK002 Patient Intake')
      await renameForm(request, otherToken, formId, 'QA LOCK002 Patient Intake (Spanish)')

      await expectUndoConflict(request, adminToken, adminRename.undoToken)
      expect(await readFormName(request, adminToken, formId)).toBe('QA LOCK002 Patient Intake (Spanish)')
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })

  test('undoing two own renames one after the other restores the original name', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let formId: string | null = null
    try {
      formId = (await createFormFixture(request, adminToken, { name: 'QA LOCK002 Original' })).id
      const firstRename = await renameForm(request, adminToken, formId, 'QA LOCK002 Renamed')
      const secondRename = await renameForm(request, adminToken, formId, 'QA LOCK002 Renamed Again')

      await undoOk(request, adminToken, secondRename.undoToken, 'second rename')
      expect(await readFormName(request, adminToken, formId)).toBe('QA LOCK002 Renamed')
      await undoOk(request, adminToken, firstRename.undoToken, 'first rename')
      expect(await readFormName(request, adminToken, formId)).toBe('QA LOCK002 Original')
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })

  test('undo of an older update does not reopen a distribution another admin closed', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const otherToken = await getAuthToken(request, 'superadmin')
    let formId: string | null = null
    let distributionId: string | null = null
    try {
      formId = (await createFormFixture(request, adminToken)).id
      distributionId = (await createDistributionFixture(request, adminToken, formId, { maxResponses: 10 })).id

      const update = await patchDistribution(request, adminToken, distributionId, { maxResponses: 20 })
      expect(update.status(), await update.text()).toBe(200)
      const updateOperation = expectOperation(update, 'update distribution')
      const close = await patchDistribution(request, otherToken, distributionId, { status: 'closed' })
      expect(close.status(), await close.text()).toBe(200)

      await expectUndoConflict(request, adminToken, updateOperation.undoToken)
      const current = await readDistribution(request, adminToken, distributionId)
      expect(current).toEqual(expect.objectContaining({ status: 'closed', maxResponses: 20 }))
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })

  test('undo of a close with nothing in between reopens the distribution', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let formId: string | null = null
    let distributionId: string | null = null
    try {
      formId = (await createFormFixture(request, adminToken)).id
      distributionId = (await createDistributionFixture(request, adminToken, formId)).id
      const statusBefore = (await readDistribution(request, adminToken, distributionId))?.status

      const close = await patchDistribution(request, adminToken, distributionId, { status: 'closed' })
      expect(close.status(), await close.text()).toBe(200)
      await undoOk(request, adminToken, expectOperation(close, 'close distribution').undoToken, 'own close')

      expect((await readDistribution(request, adminToken, distributionId))?.status).toBe(statusBefore)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
