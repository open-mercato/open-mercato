import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-CRM-091: a person or company that carries labels can be deleted, and undo brings the labels back.
 *
 * Labels are private to the user who assigned them, and `customer_label_assignments.entity_id` references
 * `customer_entities` without an ON DELETE action. Before the fix, any user's label made every delete of the
 * record fail with `409 FOREIGN_KEY_VIOLATION`, even for users who cannot see that label.
 */

const PEOPLE = '/api/customers/people'
const COMPANIES = '/api/customers/companies'

type LabelRow = { id: string; user_id: string; label_id: string; created_at: Date }

async function labelAssignmentsFor(entityId: string): Promise<LabelRow[]> {
  return withClient(async (client) => {
    const result = await client.query<LabelRow>(
      'select id, user_id, label_id, created_at from customer_label_assignments where entity_id = $1 order by id',
      [entityId],
    )
    return result.rows
  })
}

async function entityExists(entityId: string): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query('select 1 from customer_entities where id = $1', [entityId])
    return (result.rowCount ?? 0) > 0
  })
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', path, { token, data })
  expect(res.ok(), `create ${path} status ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as { id?: string; entityId?: string } | null
  const id = body?.id ?? body?.entityId ?? null
  expect(id, `create ${path} returns an id`).toBeTruthy()
  return id as string
}

async function createAndAssignLabel(
  request: APIRequestContext,
  token: string,
  entityId: string,
  name: string,
): Promise<string> {
  const labelRes = await apiRequest(request, 'POST', '/api/customers/labels', { token, data: { label: name } })
  expect(labelRes.status(), 'label create').toBe(201)
  const labelId = ((await readJsonSafe(labelRes)) as { id?: string } | null)?.id
  expect(labelId, 'label id').toBeTruthy()
  const assignRes = await apiRequest(request, 'POST', '/api/customers/labels/assign', {
    token,
    data: { labelId, entityId },
  })
  expect(assignRes.status(), 'label assign').toBe(201)
  return labelId as string
}

async function assignedLabelIds(request: APIRequestContext, token: string, entityId: string): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `/api/customers/labels?entityId=${entityId}`, { token })
  expect(res.ok(), `labels list status ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as { assignedIds?: string[] } | null
  return body?.assignedIds ?? []
}

async function deleteLabels(labelIds: string[]): Promise<void> {
  if (!labelIds.length) return
  await withClient(async (client) => {
    await client.query('delete from customer_label_assignments where label_id = any($1::uuid[])', [labelIds])
    await client.query('delete from customer_labels where id = any($1::uuid[])', [labelIds])
  })
}

async function deleteQuietly(request: APIRequestContext, token: string, path: string, id: string | null) {
  if (!id) return
  await apiRequest(request, 'DELETE', `${path}?id=${id}`, { token }).catch(() => undefined)
}

test.describe('TC-CRM-091: delete people and companies that carry labels', () => {
  test('a person labelled privately by another user can be deleted', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let personId: string | null = null
    const labelIds: string[] = []
    try {
      personId = await createEntity(request, adminToken, PEOPLE, {
        firstName: 'Labelled',
        lastName: `TC-CRM-091 D ${stamp}`,
        displayName: `Labelled TC-CRM-091 D ${stamp}`,
      })
      labelIds.push(await createAndAssignLabel(request, employeeToken, personId, `TC-CRM-091 D ${stamp}`))
      expect(await labelAssignmentsFor(personId)).toHaveLength(1)
      expect(await assignedLabelIds(request, adminToken, personId), 'the label is private to the employee').toEqual([])

      const deleteRes = await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token: adminToken })
      expect(deleteRes.status(), 'delete must not be blocked by another user\'s private label').toBe(200)
      expect(await entityExists(personId), 'person row removed').toBe(false)
      expect(await labelAssignmentsFor(personId), 'label assignment removed with the person').toEqual([])
      personId = null
    } finally {
      await deleteLabels(labelIds)
      await deleteQuietly(request, adminToken, PEOPLE, personId)
    }
  })

  test('a company labelled privately by another user can be deleted; undo and redo carry the label', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let companyId: string | null = null
    const labelIds: string[] = []
    try {
      companyId = await createEntity(request, adminToken, COMPANIES, { displayName: `TC-CRM-091 Co ${stamp}` })
      const labelId = await createAndAssignLabel(request, employeeToken, companyId, `TC-CRM-091 ${stamp}`)
      labelIds.push(labelId)
      const before = await labelAssignmentsFor(companyId)
      expect(before).toHaveLength(1)
      expect(await assignedLabelIds(request, adminToken, companyId), 'the label is private to the employee').toEqual([])

      const deleteRes = await apiRequest(request, 'DELETE', `${COMPANIES}?id=${companyId}`, { token: adminToken })
      expect(deleteRes.status(), 'delete must not be blocked by another user\'s private label').toBe(200)
      const deleteOp = expectOperation(deleteRes, 'customers.companies.delete')
      expect(await entityExists(companyId), 'company row removed').toBe(false)
      expect(await labelAssignmentsFor(companyId), 'label assignment removed with the company').toEqual([])

      await undoOk(request, adminToken, deleteOp.undoToken, 'undo company delete')
      expect(await entityExists(companyId), 'company restored').toBe(true)
      expect(await labelAssignmentsFor(companyId), 'label assignment restored as it was').toEqual(before)
      expect(await assignedLabelIds(request, employeeToken, companyId)).toEqual([labelId])
      expect(await assignedLabelIds(request, adminToken, companyId), 'the restored label stays private').toEqual([])

      await redoOk(request, adminToken, deleteOp.logId, 'redo company delete')
      expect(await entityExists(companyId), 'company deleted again by redo').toBe(false)
      expect(await labelAssignmentsFor(companyId)).toEqual([])
      companyId = null
    } finally {
      await deleteLabels(labelIds)
      await deleteQuietly(request, adminToken, COMPANIES, companyId)
    }
  })

  test('a person labelled by two users can be deleted; undo restores both labels exactly', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let personId: string | null = null
    const labelIds: string[] = []
    try {
      personId = await createEntity(request, adminToken, PEOPLE, {
        firstName: 'Labelled',
        lastName: `TC-CRM-091 ${stamp}`,
        displayName: `Labelled TC-CRM-091 ${stamp}`,
      })
      const adminLabelId = await createAndAssignLabel(request, adminToken, personId, `TC-CRM-091 A ${stamp}`)
      labelIds.push(adminLabelId)
      const employeeLabelId = await createAndAssignLabel(request, employeeToken, personId, `TC-CRM-091 E ${stamp}`)
      labelIds.push(employeeLabelId)
      const before = await labelAssignmentsFor(personId)
      expect(before).toHaveLength(2)

      const deleteRes = await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token: adminToken })
      expect(deleteRes.status(), 'labels must not block the delete').toBe(200)
      const deleteOp = expectOperation(deleteRes, 'customers.people.delete')
      expect(await entityExists(personId), 'person row removed').toBe(false)
      expect(await labelAssignmentsFor(personId), 'label assignments removed with the person').toEqual([])

      await undoOk(request, adminToken, deleteOp.undoToken, 'undo person delete')
      expect(await entityExists(personId), 'person restored').toBe(true)
      expect(await labelAssignmentsFor(personId), 'both label assignments restored as they were').toEqual(before)
      expect(await assignedLabelIds(request, adminToken, personId)).toEqual([adminLabelId])
      expect(await assignedLabelIds(request, employeeToken, personId)).toEqual([employeeLabelId])

      await redoOk(request, adminToken, deleteOp.logId, 'redo person delete')
      expect(await entityExists(personId), 'person deleted again by redo').toBe(false)
      expect(await labelAssignmentsFor(personId)).toEqual([])
      personId = null
    } finally {
      await deleteLabels(labelIds)
      await deleteQuietly(request, adminToken, PEOPLE, personId)
    }
  })
})
