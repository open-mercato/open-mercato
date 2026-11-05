import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION } from '../lib/constants'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const FOLDERS_PATH = '/api/documents/folders'
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
const FOLDER_LIMIT_MESSAGE = 'This organization has reached its folder limit.'

type FolderMutationBody = { id?: string; updatedAt?: string }

type CapScope = {
  token: string
  tenantId: string
  organizationId: string
  ownerUserId: string
}

function resolveUrl(path: string): string {
  return `${BASE_URL}${path}`
}

async function folderRequest(
  request: APIRequestContext,
  scope: CapScope,
  method: 'POST' | 'DELETE',
  data: Record<string, unknown>,
  updatedAt?: string,
): Promise<APIResponse> {
  return request.fetch(resolveUrl(FOLDERS_PATH), {
    method,
    headers: {
      Authorization: `Bearer ${scope.token}`,
      'Content-Type': 'application/json',
      Cookie: `om_selected_org=${scope.organizationId}`,
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
    data,
  })
}

async function createFolder(
  request: APIRequestContext,
  scope: CapScope,
  name: string,
): Promise<{ id: string; updatedAt: string }> {
  const response = await folderRequest(request, scope, 'POST', { name, parentFolderId: null })
  const body = await readJsonSafe<FolderMutationBody>(response)
  expect(response.status(), `create folder ${name}`).toBe(201)
  return {
    id: expectId(body?.id, 'folder create response should include id'),
    updatedAt: expectId(body?.updatedAt, 'folder create response should include updatedAt'),
  }
}

async function deleteFolderWithUndo(
  request: APIRequestContext,
  scope: CapScope,
  folder: { id: string; updatedAt: string },
): Promise<string> {
  const response = await folderRequest(request, scope, 'DELETE', { id: folder.id }, folder.updatedAt)
  expect(response.status(), 'folder delete').toBe(200)
  return expectOperation(response, 'folder delete').undoToken
}

async function undo(request: APIRequestContext, scope: CapScope, undoToken: string): Promise<APIResponse> {
  return apiRequestWithSelectedOrg(request, 'POST', UNDO_PATH, {
    token: scope.token,
    selectedOrgId: scope.organizationId,
    data: { undoToken },
  })
}

async function insertFillerFolders(scope: CapScope, count: number): Promise<void> {
  if (count <= 0) return
  await withClient(async (client) => {
    await client.query(
      `insert into document_folders (id, organization_id, tenant_id, name, owner_user_id, created_at, updated_at)
       select gen_random_uuid(), $1, $2, 'TC-DOCUMENTS-029 filler ' || n, $3, now(), now()
       from generate_series(1, $4::int) as n`,
      [scope.organizationId, scope.tenantId, scope.ownerUserId, count],
    )
  })
}

async function activeFolderCount(scope: CapScope): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from document_folders where organization_id = $1 and tenant_id = $2 and deleted_at is null',
      [scope.organizationId, scope.tenantId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function folderDeletedAt(scope: CapScope, folderId: string): Promise<Date | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from document_folders where id = $1 and organization_id = $2 and tenant_id = $3',
      [folderId, scope.organizationId, scope.tenantId],
    )
    return result.rows[0]?.deleted_at ?? null
  })
}

async function createCapScope(request: APIRequestContext, label: string): Promise<CapScope> {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, userId } = getTokenScope(token)
  const organizationId = await createOrganizationInDb({
    tenantId,
    name: `TC-DOCUMENTS-029 ${label} ${Date.now()}`,
  })
  return { token, tenantId, organizationId, ownerUserId: expectId(userId, 'admin user id') }
}

async function dropCapScope(scope: CapScope | null): Promise<void> {
  if (!scope) return
  await withClient(async (client) => {
    await client.query(
      'delete from document_folders where organization_id = $1 and tenant_id = $2',
      [scope.organizationId, scope.tenantId],
    )
  })
  await deleteOrganizationInDb(scope.organizationId)
}

test.describe('TC-DOCUMENTS-029: folder delete undo respects the organization folder cap', () => {
  test.describe.configure({ timeout: 180_000 })

  test('API: undo is rejected at the cap and succeeds once a slot frees up', async ({ request }) => {
    let scope: CapScope | null = null
    try {
      scope = await createCapScope(request, 'api')
      const restored = await createFolder(request, scope, 'TC-DOCUMENTS-029 restored')
      const undoToken = await deleteFolderWithUndo(request, scope, restored)

      await insertFillerFolders(scope, DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION - 1)
      const replacement = await createFolder(request, scope, 'TC-DOCUMENTS-029 replacement')
      expect(await activeFolderCount(scope)).toBe(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)

      const atCap = await folderRequest(request, scope, 'POST', { name: 'TC-DOCUMENTS-029 over cap', parentFolderId: null })
      expect(atCap.status()).toBe(422)

      const rejected = await undo(request, scope, undoToken)
      const rejectedBody = await readJsonSafe<{ error?: string }>(rejected)
      expect(rejected.status()).toBe(422)
      expect(rejectedBody?.error).toBe(FOLDER_LIMIT_MESSAGE)
      expect(await folderDeletedAt(scope, restored.id)).not.toBeNull()
      expect(await activeFolderCount(scope)).toBe(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)

      await deleteFolderWithUndo(request, scope, replacement)
      const accepted = await undo(request, scope, undoToken)
      expect(accepted.status(), `undo body ${JSON.stringify(await readJsonSafe(accepted))}`).toBe(200)
      expect(await folderDeletedAt(scope, restored.id)).toBeNull()
      expect(await activeFolderCount(scope)).toBe(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)
    } finally {
      await dropCapScope(scope)
    }
  })

  test('UI: the undo banner explains the folder limit and leaves the folder deleted', async ({ page, request }) => {
    let scope: CapScope | null = null
    try {
      scope = await createCapScope(request, 'ui')
      const folderName = `TC-DOCUMENTS-029 banner ${Date.now()}`
      const folder = await createFolder(request, scope, folderName)

      await login(page, 'admin')
      await page.context().addCookies([
        { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
      ])
      await page.goto('/backend/documents', { waitUntil: 'domcontentloaded' })

      const folderRow = page.locator('li').filter({ has: page.getByRole('button', { name: folderName, exact: true }) }).first()
      await expect(folderRow).toBeVisible({ timeout: 30_000 })
      await folderRow.getByRole('button', { name: /actions/i }).first().click()
      await page.getByRole('menuitem', { name: /delete/i }).click()
      const deleteResponse = page.waitForResponse((response) =>
        response.url().includes(FOLDERS_PATH) && response.request().method() === 'DELETE')
      await page.getByRole('alertdialog').getByRole('button', { name: /delete|confirm/i }).last().click()
      expect((await deleteResponse).status()).toBe(200)
      await expect(page.getByRole('button', { name: folderName, exact: true })).toHaveCount(0)

      await insertFillerFolders(scope, DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)

      const undoResponse = page.waitForResponse((response) =>
        response.url().includes(UNDO_PATH) && response.request().method() === 'POST')
      await page.getByRole('button', { name: /^undo$/i }).first().click()
      expect((await undoResponse).status()).toBe(422)
      await expect(page.getByText(FOLDER_LIMIT_MESSAGE).first()).toBeVisible({ timeout: 15_000 })
      expect(await folderDeletedAt(scope, folder.id)).not.toBeNull()
    } finally {
      await dropCapScope(scope)
    }
  })
})
