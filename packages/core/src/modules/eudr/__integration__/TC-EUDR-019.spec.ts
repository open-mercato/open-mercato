import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'audit_logs'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const ARCHIVED_CODE = 'eudr.errors.archivedReadOnly'
const ARCHIVED_MESSAGE = 'Archived statements are read-only.'
const PASSWORD = 'StrongSecret123!'

type UndoRefusalBody = {
  error?: string
  code?: string
}

type StatementRow = {
  id?: string
  title?: string
  status?: string
}

type CreatorFixture = {
  roleId: string
  userId: string
  email: string
  token: string
}

async function createCreatorFixture(
  request: APIRequestContext,
  superadminToken: string,
  organizationId: string,
  tenantId: string,
  stamp: string,
  cleanup: { roleId: string | null; userId: string | null },
): Promise<CreatorFixture> {
  const email = `qa-eudr-019-${stamp}@example.com`
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `qa-eudr-019-creator-${stamp}`,
    tenantId,
  })
  cleanup.roleId = roleId
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: [
      'eudr.statements.view',
      'eudr.statements.manage',
      'audit_logs.view_self',
      'audit_logs.undo_self',
    ],
    organizations: [organizationId],
  })
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: 'QA TC-EUDR-019 Creator',
  })
  cleanup.userId = userId
  const token = await getAuthToken(request, email, PASSWORD)
  return { roleId, userId, email, token }
}

async function createDraftStatement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<{ id: string; undoToken: string }> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: { title, commodity: 'coffee', actorRole: 'operator' },
  })
  expect(response.status(), `statement fixture failed: ${response.status()}`).toBe(201)
  const operation = expectOperation(response, `create ${title}`)
  const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'statement fixture id')
  return { id, undoToken: operation.undoToken }
}

async function updateStatement(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', STATEMENTS_PATH, { token, data })
}

async function archiveStatement(request: APIRequestContext, token: string, id: string): Promise<void> {
  const response = await updateStatement(request, token, { id, status: 'archived' })
  expect(response.status(), `archive statement failed: ${response.status()}`).toBe(200)
}

async function readStatement(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<StatementRow | null> {
  const response = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `read statement failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: StatementRow[] }>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function expectUndoRefused(
  request: APIRequestContext,
  token: string,
  undoToken: string,
  context: string,
): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<UndoRefusalBody>(response)
  expect(response.status(), `${context}: undo must be refused with 409, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code, `${context}: refusal code`).toBe(ARCHIVED_CODE)
  expect(body?.error, `${context}: refusal message should be localized`).toBe(ARCHIVED_MESSAGE)
}

async function deleteStatementIfPossible(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

test.describe('TC-EUDR-019: statement undo never removes or reopens a statement that delete would refuse', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('create and update undos are refused once the statement is archived', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID().slice(0, 8)
    const cleanup: { roleId: string | null; userId: string | null } = { roleId: null, userId: null }
    const statementIds: string[] = []

    try {
      const creator = await createCreatorFixture(request, superadminToken, organizationId, tenantId, stamp, cleanup)

      const archived = await createDraftStatement(request, creator.token, `TC-EUDR-019 Archived ${stamp}`)
      statementIds.push(archived.id)
      await archiveStatement(request, adminToken, archived.id)
      await expectUndoRefused(request, creator.token, archived.undoToken, 'create undo after archive')
      const archivedRow = await readStatement(request, adminToken, archived.id)
      expect(archivedRow?.status, 'archived statement must survive the refused create undo').toBe('archived')

      const edited = await createDraftStatement(request, creator.token, `TC-EUDR-019 Edited ${stamp}`)
      statementIds.push(edited.id)
      const editResponse = await updateStatement(request, creator.token, {
        id: edited.id,
        title: `TC-EUDR-019 Edited twice ${stamp}`,
      })
      expect(editResponse.status(), `edit statement failed: ${editResponse.status()}`).toBe(200)
      const editOperation = expectOperation(editResponse, 'edit statement')
      await archiveStatement(request, adminToken, edited.id)
      await expectUndoRefused(request, creator.token, editOperation.undoToken, 'update undo after archive')
      const blockedCreateUndo = await undoByToken(request, creator.token, edited.undoToken)
      expect(blockedCreateUndo.status(), 'create undo stays unavailable behind the refused update undo').toBe(400)
      expect((await readJsonSafe<UndoRefusalBody>(blockedCreateUndo))?.error).toBe('Undo token not available')
      const editedRow = await readStatement(request, adminToken, edited.id)
      expect(editedRow?.status, 'update undo must not reopen the archived statement').toBe('archived')
      expect(editedRow?.title, 'update undo must not rewrite the archived statement').toBe(`TC-EUDR-019 Edited twice ${stamp}`)

      const selfArchived = await createDraftStatement(request, creator.token, `TC-EUDR-019 Self archived ${stamp}`)
      statementIds.push(selfArchived.id)
      const selfArchiveResponse = await updateStatement(request, creator.token, { id: selfArchived.id, status: 'archived' })
      expect(selfArchiveResponse.status(), `self archive failed: ${selfArchiveResponse.status()}`).toBe(200)
      const selfArchiveOperation = expectOperation(selfArchiveResponse, 'self archive')
      await expectUndoRefused(request, creator.token, selfArchiveOperation.undoToken, 'undo of own archive')
      const selfArchivedRow = await readStatement(request, adminToken, selfArchived.id)
      expect(selfArchivedRow?.status, 'archived statement stays read-only for its own archiver').toBe('archived')

      const draft = await createDraftStatement(request, creator.token, `TC-EUDR-019 Draft ${stamp}`)
      statementIds.push(draft.id)
      await undoOk(request, creator.token, draft.undoToken, 'create undo of an untouched draft')
      expect(await readStatement(request, adminToken, draft.id), 'draft create undo still removes it').toBeNull()
    } finally {
      for (const id of statementIds) await deleteStatementIfPossible(request, adminToken, id)
      await deleteUserIfExists(request, superadminToken, cleanup.userId)
      await deleteRoleIfExists(request, superadminToken, cleanup.roleId)
    }
  })

  test('the audit log shows the translated refusal when undoing a create after an archive', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID().slice(0, 8)
    const cleanup: { roleId: string | null; userId: string | null } = { roleId: null, userId: null }
    let statementId: string | null = null

    try {
      const creator = await createCreatorFixture(request, superadminToken, organizationId, tenantId, stamp, cleanup)
      const statement = await createDraftStatement(request, creator.token, `TC-EUDR-019 UI ${stamp}`)
      statementId = statement.id
      await archiveStatement(request, adminToken, statement.id)

      const loginForm = new URLSearchParams()
      loginForm.set('email', creator.email)
      loginForm.set('password', PASSWORD)
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      })
      expect(loginResponse.ok(), 'creator should log in').toBe(true)

      await page.goto('/backend/audit-logs')
      const createRow = page.getByRole('row').filter({ hasText: 'Create EUDR due diligence statement' }).first()
      await expect(createRow).toBeVisible({ timeout: 20_000 })
      const undoResponse = page.waitForResponse((response) => (
        response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST'
      ))
      await createRow.getByRole('button', { name: 'Undo last action' }).click()
      expect((await undoResponse).status(), 'UI undo must be refused').toBe(409)
      await expect(page.getByText(ARCHIVED_MESSAGE).first()).toBeVisible({ timeout: 10_000 })

      const row = await readStatement(request, adminToken, statement.id)
      expect(row?.status, 'archived statement must survive the refused UI undo').toBe('archived')
    } finally {
      if (statementId) await deleteStatementIfPossible(request, adminToken, statementId)
      await deleteUserIfExists(request, superadminToken, cleanup.userId)
      await deleteRoleIfExists(request, superadminToken, cleanup.roleId)
    }
  })
})
