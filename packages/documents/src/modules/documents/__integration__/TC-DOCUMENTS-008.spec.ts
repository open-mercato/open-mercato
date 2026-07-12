import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
  ok?: boolean
}

type DocumentTemplateItem = {
  id?: string
  name?: string
  description?: string | null
  bodyHtml?: string
  contextSlots?: Array<{ slot?: string; entityType?: string; required?: boolean }> | null
  isActive?: boolean
  updatedAt?: string
  createdAt?: string
}

type DocumentTemplateListBody = {
  items?: DocumentTemplateItem[]
  total?: number
}

type ContentBody = {
  contentHtml?: string
  contentText?: string
  updatedAt?: string | null
}

type ConflictBody = {
  error?: string
  code?: string
  currentUpdatedAt?: string
  expectedUpdatedAt?: string
}

type DocumentsTestUser = {
  id: string
  roleId: string
  email: string
  password: string
  token: string
  name: string
}

const DOCUMENTS_LIMITED_FEATURES = ['documents.view', 'documents.create']
const DOCUMENTS_VIEW_FEATURES = ['documents.view']
const VALID_PASSWORD = 'Valid1!Pass'
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function uniqueEmail(label: string): string {
  return `tc-documents-008-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string): string {
  return `Docs${label}1!${Date.now()}`
}

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  label: string,
  features: string[],
): Promise<DocumentsTestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-008 ${label} ${Date.now()}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features,
  })

  const email = uniqueEmail(label)
  const password = policyPassword(label)
  const name = `TC Documents 008 ${label}`
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
    name,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, email, password, token, name }
}

async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId(body?.id, 'tenant create response should include id')
}

async function createTenantDocumentUser(
  request: APIRequestContext,
  superadminToken: string,
  input: { tenantId: string; organizationId: string; label: string; stamp: number },
): Promise<{ id: string; roleId: string; token: string; email: string }> {
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `TC-DOCUMENTS-008 ${input.label} ${input.stamp}`,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: DOCUMENTS_VIEW_FEATURES,
    organizations: null,
  })

  const email = `tc-documents-008-${input.label}-${input.stamp}-${Math.floor(Math.random() * 1_000_000)}@example.com`
  const id = await createUserFixture(request, superadminToken, {
    email,
    password: VALID_PASSWORD,
    organizationId: input.organizationId,
    roles: [roleId],
    name: `TC Documents 008 ${input.label}`,
  })
  const token = await getAuthToken(request, email, VALID_PASSWORD)
  return { id, roleId, token, email }
}

function templatePayload(name: string, bodyHtml: string) {
  return {
    name,
    description: `Template for ${name}`,
    bodyHtml,
    contextSlots: [
      { slot: 'customer', entityType: 'customer-person', required: true },
    ],
    isActive: true,
  }
}

async function createTemplate(
  request: APIRequestContext,
  token: string,
  name: string,
  bodyHtml: string,
): Promise<{ id: string; updatedAt: string }> {
  const response = await apiRequest(request, 'POST', '/api/documents/templates', {
    token,
    data: templatePayload(name, bodyHtml),
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'POST /api/documents/templates should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'template create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'template create response should include updatedAt'),
  }
}

async function deleteTemplateIfExists(
  request: APIRequestContext,
  token: string | null,
  templateId: string | null,
  updatedAt: string | null,
): Promise<void> {
  if (!token || !templateId) return
  await request.fetch(resolveUrl('/api/documents/templates'), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
    data: { id: templateId },
  }).catch(() => undefined)
}

async function listTemplates(
  request: APIRequestContext,
  token: string,
  search: string,
): Promise<DocumentTemplateItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents/templates?search=${encodeURIComponent(search)}`,
    { token },
  )
  const body = await readJsonSafe<DocumentTemplateListBody>(response)
  expect(response.status(), 'GET /api/documents/templates should return 200').toBe(200)
  return Array.isArray(body?.items) ? body.items : []
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<{ id: string; updatedAt: string }> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'document create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'document create response should include updatedAt'),
  }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  updatedAt: string | null,
): Promise<void> {
  if (!token || !documentId) return
  await request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(documentId)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
  }).catch(() => undefined)
}

async function putContent(
  request: APIRequestContext,
  token: string,
  documentId: string,
  contentHtml: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'PUT',
    `/api/documents/${encodeURIComponent(documentId)}/content`,
    { token, data: { contentHtml } },
  )
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'PUT /api/documents/[id]/content should return 200').toBe(200)
  expect(body?.ok, 'content PUT should report ok=true').toBe(true)
}

function fillTemplateBody(bodyHtml: string, entityId: string): string {
  const escapedValue = 'Ada &amp; &lt;Lovelace&gt;&quot;'
  const entityRefSpan = `<span data-entity-ref data-entity-type="customer-person" data-entity-id="${entityId}" data-label="${escapedValue}" data-href="/backend/customers/people/${entityId}" class="om-entity-ref">${escapedValue}</span>`
  return bodyHtml
    .replaceAll('{{customer.name}}', escapedValue)
    .replaceAll('<span data-template-token="customer.chip">{{customer.chip}}</span>', entityRefSpan)
    .replaceAll('{{quote.number}}', '')
}

test.describe('TC-DOCUMENTS-008: templates and chips', () => {
  test('covers template CRUD, feature gating, tenant isolation, chip instantiation, and docx export', async ({ request }) => {
    const stamp = Date.now()
    const baseBodyHtml = '<h1>Offer for {{customer.name}}</h1><p><span data-template-token="customer.chip">{{customer.chip}}</span></p><p>{{quote.number}}</p><p style="text-align: center"><mark>Centered mark</mark></p>'
    const crudTemplateName = `TC-DOCUMENTS-008 CRUD ${stamp}`
    const renamedTemplateName = `TC-DOCUMENTS-008 CRUD renamed ${stamp}`
    const workflowTemplateName = `TC-DOCUMENTS-008 Workflow ${stamp}`
    let adminToken: string | null = null
    let superadminToken: string | null = null
    let limitedUser: DocumentsTestUser | null = null
    let crudTemplateId: string | null = null
    let crudTemplateUpdatedAt: string | null = null
    let workflowTemplateId: string | null = null
    let workflowTemplateUpdatedAt: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null
    let tenantBId: string | null = null
    let organizationBId: string | null = null
    let tenantBUser: { id: string; roleId: string; token: string; email: string } | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      limitedUser = await createDocumentsUser(request, adminToken, 'limited', DOCUMENTS_LIMITED_FEATURES)

      const crudTemplate = await createTemplate(request, adminToken, crudTemplateName, baseBodyHtml)
      crudTemplateId = crudTemplate.id
      crudTemplateUpdatedAt = crudTemplate.updatedAt

      const createdTemplates = await listTemplates(request, adminToken, crudTemplateName)
      const createdTemplate = createdTemplates.find((item) => item.id === crudTemplateId) ?? null
      expect(createdTemplate, 'template list should include the created template').not.toBeNull()
      expect(createdTemplate?.name).toBe(crudTemplateName)
      expect(createdTemplate?.bodyHtml).toBe(baseBodyHtml)
      expect(createdTemplate?.contextSlots).toEqual([
        { slot: 'customer', entityType: 'customer-person', required: true },
      ])
      expect(createdTemplate?.isActive).toBe(true)
      expectUpdatedAt(createdTemplate?.createdAt, 'template list item should include createdAt')
      expectUpdatedAt(createdTemplate?.updatedAt, 'template list item should include updatedAt')

      await new Promise((resolve) => setTimeout(resolve, 20))
      const renameResponse = await request.fetch(resolveUrl('/api/documents/templates'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: crudTemplateUpdatedAt,
        },
        data: { id: crudTemplateId, name: renamedTemplateName },
      })
      const renameBody = await readJsonSafe<MutationBody>(renameResponse)
      expect(renameResponse.status(), 'template PUT with fresh updatedAt should return 200').toBe(200)
      const staleUpdatedAt = crudTemplateUpdatedAt
      crudTemplateUpdatedAt = expectUpdatedAt(renameBody?.updatedAt, 'template PUT response should include updatedAt')

      const staleResponse = await request.fetch(resolveUrl('/api/documents/templates'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: staleUpdatedAt,
        },
        data: { id: crudTemplateId, name: `${renamedTemplateName} stale` },
      })
      const staleBody = await readJsonSafe<ConflictBody>(staleResponse)
      expect(staleResponse.status(), 'template PUT with stale updatedAt should return 409').toBe(409)
      expect(staleBody?.code, 'stale template PUT should return the optimistic-lock conflict code')
        .toBe('optimistic_lock_conflict')
      expect(staleBody?.expectedUpdatedAt).toBe(staleUpdatedAt)
      expectUpdatedAt(staleBody?.currentUpdatedAt, 'stale template PUT should include currentUpdatedAt')

      const deleteResponse = await request.fetch(resolveUrl('/api/documents/templates'), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: crudTemplateUpdatedAt,
        },
        data: { id: crudTemplateId },
      })
      const deleteBody = await readJsonSafe<MutationBody>(deleteResponse)
      expect(deleteResponse.status(), 'template DELETE with fresh updatedAt should return 200').toBe(200)
      expect(deleteBody?.ok).toBe(true)
      crudTemplateId = null
      crudTemplateUpdatedAt = null

      const deletedTemplates = await listTemplates(request, adminToken, renamedTemplateName)
      expect(
        deletedTemplates.some((item) => item.id === crudTemplate.id),
        'deleted template should no longer be listed',
      ).toBe(false)

      const workflowTemplate = await createTemplate(request, adminToken, workflowTemplateName, baseBodyHtml)
      workflowTemplateId = workflowTemplate.id
      workflowTemplateUpdatedAt = workflowTemplate.updatedAt

      const limitedListResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/templates?search=${encodeURIComponent(workflowTemplateName)}`,
        { token: limitedUser.token },
      )
      const limitedListBody = await readJsonSafe<DocumentTemplateListBody>(limitedListResponse)
      expect(limitedListResponse.status(), 'limited documents.view user should list templates').toBe(200)
      const limitedItems = Array.isArray(limitedListBody?.items) ? limitedListBody.items : []
      expect(
        limitedItems.some((item) => item.id === workflowTemplateId),
        'limited documents.view user should see same-organization template',
      ).toBe(true)

      const limitedPostResponse = await apiRequest(request, 'POST', '/api/documents/templates', {
        token: limitedUser.token,
        data: { invalid: true },
      })
      expect(limitedPostResponse.status(), 'limited template POST should be feature-denied before validation')
        .toBe(403)

      const limitedPutResponse = await apiRequest(request, 'PUT', '/api/documents/templates', {
        token: limitedUser.token,
        data: { id: workflowTemplateId, name: `${workflowTemplateName} denied` },
      })
      expect(limitedPutResponse.status(), 'limited template PUT should be feature-denied').toBe(403)

      const limitedDeleteResponse = await apiRequest(request, 'DELETE', '/api/documents/templates', {
        token: limitedUser.token,
        data: { id: workflowTemplateId },
      })
      expect(limitedDeleteResponse.status(), 'limited template DELETE should be feature-denied').toBe(403)

      const tenantAScope = getTokenScope(adminToken)
      tenantBId = await createTenantFixture(request, superadminToken, `TC-DOCUMENTS-008 Tenant B ${stamp}`)
      organizationBId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-DOCUMENTS-008 Org B ${stamp}`,
        tenantId: tenantBId,
      })
      tenantBUser = await createTenantDocumentUser(request, superadminToken, {
        tenantId: tenantBId,
        organizationId: organizationBId,
        label: 'tenant-b',
        stamp,
      })
      const tenantBScope = getTokenScope(tenantBUser.token)
      expect(tenantBScope.tenantId, 'tenant B token should use the fixture tenant').toBe(tenantBId)
      expect(tenantBScope.organizationId, 'tenant B token should use the fixture organization').toBe(organizationBId)
      expect(tenantBScope.tenantId, 'tenant B must differ from tenant A').not.toBe(tenantAScope.tenantId)
      expect(tenantBScope.organizationId, 'tenant B org must differ from tenant A org').not.toBe(tenantAScope.organizationId)

      const tenantBTemplates = await listTemplates(request, tenantBUser.token, workflowTemplateName)
      expect(
        tenantBTemplates.some((item) => item.id === workflowTemplateId),
        'second tenant template list should not include tenant A template',
      ).toBe(false)

      const document = await createDocument(request, adminToken, workflowTemplateName)
      documentId = document.id
      documentUpdatedAt = document.updatedAt

      const entityId = randomUUID()
      const filledBodyHtml = fillTemplateBody(baseBodyHtml, entityId)
      await putContent(request, adminToken, documentId, filledBodyHtml)

      const contentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        { token: adminToken },
      )
      const contentBody = await readJsonSafe<ContentBody>(contentResponse)
      expect(contentResponse.status(), 'GET /api/documents/[id]/content should return 200').toBe(200)
      const storedHtml = contentBody?.contentHtml ?? ''
      expect(storedHtml).toContain('data-entity-ref')
      expect(storedHtml).toContain('data-entity-type="customer-person"')
      expect(storedHtml).toContain(`data-entity-id="${entityId}"`)
      // The canonical TipTap serializer keeps angle brackets literal inside a
      // quoted attribute while escaping the quote delimiter. Assert the
      // canonical form rather than the caller's pre-materialization encoding.
      expect(storedHtml).toContain('data-label="Ada &amp; <Lovelace>&quot;"')
      expect(storedHtml).toContain(`data-href="/backend/customers/people/${entityId}"`)
      expect(storedHtml).toContain('class="om-entity-ref"')
      expect(storedHtml).toContain('Ada &amp; &lt;Lovelace&gt;"')
      expect(storedHtml).toContain('style="text-align: center;"')
      expect(storedHtml).toContain('<mark>Centered mark</mark>')
      expect(storedHtml).not.toContain('{{')

      const docxResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/export?format=docx`,
        { token: adminToken },
      )
      expect(docxResponse.status(), 'chip-bearing docx export should return 200').toBe(200)
      expect(docxResponse.headers()['content-type'] ?? '').toContain('wordprocessingml')
      const docxBuffer = await docxResponse.body()
      expect(docxBuffer.length, 'docx export should include a non-empty zip payload').toBeGreaterThan(100)
      expect(docxBuffer.subarray(0, 2).toString('latin1')).toBe('PK')
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteTemplateIfExists(request, adminToken, workflowTemplateId, workflowTemplateUpdatedAt)
      await deleteTemplateIfExists(request, adminToken, crudTemplateId, crudTemplateUpdatedAt)
      await deleteUserIfExists(request, adminToken, limitedUser?.id ?? null)
      await deleteRoleIfExists(request, adminToken, limitedUser?.roleId ?? null)
      await deleteUserIfExists(request, superadminToken, tenantBUser?.id ?? null)
      await deleteRoleIfExists(request, superadminToken, tenantBUser?.roleId ?? null)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', organizationBId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantBId)
    }
  })
})
