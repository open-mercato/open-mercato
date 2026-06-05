import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoOk, redoOk, skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 (§5 X10 / invariant I4) — custom-field values are restored exactly on undo.
 *
 * Creates an ad-hoc integer custom field on customers:company, sets a value, updates it,
 * and asserts undo reverts the cf value (and redo re-applies it). Verified on a working
 * entity (company); people cf restore is blocked by the scalar-undo no-op #2498.
 */

const COMPANIES = '/api/customers/companies'
const DEFINITIONS = '/api/entities/definitions'

test.describe('TC-UNDO-001 custom-field restore (I4 / X10)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('company cf: set → update → undo restores → redo re-applies', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `undo_cf_${stamp}`
    let companyId: string | null = null
    let defCreated = false
    const readCf = async (id: string) => ((await readJsonSafe(await apiRequest(request, 'GET', `${COMPANIES}/${id}`, { token }))) as any)?.customFields?.[key]
    try {
      const def = await apiRequest(request, 'POST', DEFINITIONS, { token, data: { entityId: 'customers:company', key, kind: 'integer', label: `Undo CF ${stamp}`, formEditable: true, listVisible: true } })
      expect(def.ok(), `cf def create ${def.status()}`).toBeTruthy()
      defCreated = true

      const createRes = await apiRequest(request, 'POST', COMPANIES, { token, data: { displayName: `CF Co ${stamp}`, [`cf_${key}`]: 5 } })
      expect(createRes.ok()).toBeTruthy()
      companyId = expectOperation(createRes, 'companies.create').resourceId
      expect(await readCf(companyId as string), 'cf present after create').toBe(5)

      const updateOp = expectOperation(await apiRequest(request, 'PUT', COMPANIES, { token, data: { id: companyId, [`cf_${key}`]: 10 } }), 'companies.update')
      expect(await readCf(companyId as string)).toBe(10)

      await undoOk(request, token, updateOp.undoToken, 'undo company cf update')
      expect(await readCf(companyId as string), 'cf reverts on undo (I4)').toBe(5)

      await redoOk(request, token, updateOp.logId, 'redo company cf update')
      expect(await readCf(companyId as string), 'cf re-applied on redo (I6)').toBe(10)
    } finally {
      if (companyId) await apiRequest(request, 'DELETE', `${COMPANIES}?id=${companyId}`, { token }).catch(() => {})
      if (defCreated) await apiRequest(request, 'DELETE', `${DEFINITIONS}?entityId=customers:company&key=${key}`, { token }).catch(() => {})
    }
  })
})
