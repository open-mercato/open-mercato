import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
}

type CapabilityBody = {
  tier?: string
  capabilities?: {
    canView?: boolean
    canEdit?: boolean
    canShare?: boolean
  }
}

type CollabTokenBody = {
  token?: string
  url?: string | null
  tier?: string
  canEdit?: boolean
  readOnly?: boolean
  expiresInSec?: number
}

type FolderNode = {
  id?: string
  name?: string
  canEdit?: boolean
  visibility?: 'owned' | 'contains-visible' | 'ancestor'
  updatedAt?: string
  children?: FolderNode[]
}

type FolderListBody = {
  items?: FolderNode[]
}

type PrincipalsBody = {
  items?: Array<{ id?: string; label?: string; secondary?: string | null }>
  total?: number
  page?: number
  pageSize?: number
}

type TestUser = {
  id: string
  roleId: string
  token: string
}

type CreatedRecord = {
  id: string
  updatedAt: string
}

const OWNER_NO_EDIT_FEATURES = [
  'documents.view',
  'documents.create',
  'documents.share',
]

const OWNER_EDIT_FEATURES = [
  ...OWNER_NO_EDIT_FEATURES,
  'documents.edit',
]

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

function uniqueEmail(label: string, stamp: number): string {
  return `tc-documents-009-${label}-${stamp}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string, stamp: number): string {
  return `Docs009${label}1!${stamp}`
}

async function createTestUser(
  request: APIRequestContext,
  adminToken: string,
  input: {
    label: string
    stamp: number
    tenantId: string
    organizationId: string
    features: string[]
  },
): Promise<TestUser> {
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-009 ${input.label} ${input.stamp}`,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: input.features,
    organizations: null,
  })
  const email = uniqueEmail(input.label, input.stamp)
  const password = policyPassword(input.label, input.stamp)
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [roleId],
    name: `TC Documents 009 ${input.label}`,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, token }
}

async function createFolder(
  request: APIRequestContext,
  token: string,
  name: string,
  parentFolderId: string | null,
): Promise<CreatedRecord> {
  const response = await apiRequest(request, 'POST', '/api/documents/folders', {
    token,
    data: { name, parentFolderId },
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), `create folder ${name}`).toBe(201)
  return {
    id: expectId(body?.id, 'folder create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'folder create response should include updatedAt'),
  }
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
  folderId: string | null,
): Promise<CreatedRecord> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId },
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), `create document ${title}`).toBe(201)
  return {
    id: expectId(body?.id, 'document create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'document create response should include updatedAt'),
  }
}

async function createUserShare(
  request: APIRequestContext,
  token: string,
  documentId: string,
  userId: string,
): Promise<CreatedRecord> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/documents/${encodeURIComponent(documentId)}/shares`,
    {
      token,
      data: { principalType: 'user', principalId: userId, permission: 'viewer' },
    },
  )
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'share create should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'share create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'share create response should include updatedAt'),
  }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  document: CreatedRecord | null,
): Promise<void> {
  if (!token || !document) return
  await request.fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
    },
  }).catch(() => undefined)
}

async function deleteFolderIfExists(
  request: APIRequestContext,
  token: string | null,
  folder: CreatedRecord | null,
): Promise<void> {
  if (!token || !folder) return
  await request.fetch('/api/documents/folders', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: folder.updatedAt,
    },
    data: { id: folder.id },
  }).catch(() => undefined)
}

async function deleteShareIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  share: CreatedRecord | null,
): Promise<void> {
  if (!token || !documentId || !share) return
  await request.fetch(`/api/documents/${encodeURIComponent(documentId)}/shares`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: share.updatedAt,
    },
    data: { id: share.id },
  }).catch(() => undefined)
}

function flattenFolders(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenFolders(node.children ?? [])])
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  expect(payload, 'collaboration token should have a JWT payload').toBeTruthy()
  return JSON.parse(Buffer.from(payload as string, 'base64url').toString('utf8')) as Record<string, unknown>
}

function healthUrlFromWebSocketUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/healthz'
  url.search = ''
  url.hash = ''
  return url.toString()
}

test.describe('TC-DOCUMENTS-009: capability, folder, token, and readiness hardening', () => {
  test('keeps owner/manager relationship access separate from edit and share action features', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let owner: TestUser | null = null
    let manager: TestUser | null = null
    let document: CreatedRecord | null = null
    let managerShare: CreatedRecord | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenContext(adminToken)
      owner = await createTestUser(request, adminToken, {
        label: 'owner',
        stamp,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: OWNER_NO_EDIT_FEATURES,
      })
      manager = await createTestUser(request, adminToken, {
        label: 'manager',
        stamp,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['documents.view', 'documents.manage'],
      })
      document = await createDocument(
        request,
        owner.token,
        `TC-DOCUMENTS-009 capability ${stamp}`,
        null,
      )

      const ownerDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}`,
        { token: owner.token },
      )
      const ownerDetail = await readJsonSafe<CapabilityBody>(ownerDetailResponse)
      expect(ownerDetailResponse.status()).toBe(200)
      expect(ownerDetail?.tier).toBe('owner')
      expect(ownerDetail?.capabilities).toMatchObject({ canView: true, canEdit: false })

      const deniedContentWrite = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(document.id)}/content`,
        {
          token: owner.token,
          data: { contentHtml: '<p>denied owner write</p>', contentText: 'denied owner write' },
        },
      )
      expect(deniedContentWrite.status(), 'owner without documents.edit must not write').toBe(403)

      const collabResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/collab-token`,
        { token: owner.token },
      )
      const collabBody = await readJsonSafe<CollabTokenBody>(collabResponse)
      expect(collabResponse.status()).toBe(200)
      expect(collabBody).toMatchObject({ tier: 'owner', canEdit: false, readOnly: true, expiresInSec: 60 })
      const collabToken = expectId(collabBody?.token, 'collaboration response should include token')
      const claims = decodeJwtPayload(collabToken)
      expect(claims).toMatchObject({
        aud: 'documents-collab-v2',
        tokenVersion: 2,
        readOnly: true,
        documentId: document.id,
      })
      expect(Number(claims.exp) - Number(claims.iat)).toBeGreaterThan(0)
      expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(60)

      const managerDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}`,
        { token: manager.token },
      )
      const managerDetail = await readJsonSafe<CapabilityBody>(managerDetailResponse)
      expect(managerDetailResponse.status()).toBe(200)
      expect(managerDetail?.capabilities).toMatchObject({ canView: true, canEdit: false, canShare: false })

      const deniedSharesResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/shares`,
        { token: manager.token },
      )
      expect(deniedSharesResponse.status(), 'manager without documents.share must be denied').toBe(403)

      await setRoleAclFeatures(request, adminToken, {
        roleId: manager.roleId,
        features: ['documents.view', 'documents.manage', 'documents.share'],
        organizations: null,
      })
      const allowedSharesResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/shares`,
        { token: manager.token },
      )
      expect(allowedSharesResponse.status(), 'manager with documents.share should list shares').toBe(200)
      managerShare = await createUserShare(request, manager.token, document.id, manager.id)
    } finally {
      await deleteShareIfExists(request, adminToken, document?.id ?? null, managerShare)
      await deleteDocumentIfExists(request, adminToken, document)
      await deleteUserIfExists(request, adminToken, manager?.id ?? null)
      await deleteRoleIfExists(request, adminToken, manager?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteRoleIfExists(request, adminToken, owner?.roleId ?? null)
    }
  })

  test('filters folder names and enforces ownership, cycle, and non-empty guards', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let owner: TestUser | null = null
    let ownedFolder: CreatedRecord | null = null
    let ancestorFolder: CreatedRecord | null = null
    let visibleFolder: CreatedRecord | null = null
    let unrelatedFolder: CreatedRecord | null = null
    let visibleDocument: CreatedRecord | null = null
    let ownerDocument: CreatedRecord | null = null
    let visibleShare: CreatedRecord | null = null
    const ancestorName = `TC-DOCUMENTS-009 ancestor ${stamp}`
    const visibleName = `TC-DOCUMENTS-009 visible ${stamp}`
    const unrelatedName = `TC-DOCUMENTS-009 unrelated ${stamp}`

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenContext(adminToken)
      owner = await createTestUser(request, adminToken, {
        label: 'folders',
        stamp,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: OWNER_EDIT_FEATURES,
      })
      ownedFolder = await createFolder(
        request,
        owner.token,
        `TC-DOCUMENTS-009 owned ${stamp}`,
        null,
      )
      ancestorFolder = await createFolder(request, adminToken, ancestorName, null)
      visibleFolder = await createFolder(request, adminToken, visibleName, ancestorFolder.id)
      unrelatedFolder = await createFolder(request, adminToken, unrelatedName, null)
      visibleDocument = await createDocument(
        request,
        adminToken,
        `TC-DOCUMENTS-009 visible document ${stamp}`,
        visibleFolder.id,
      )
      visibleShare = await createUserShare(request, adminToken, visibleDocument.id, owner.id)

      await setRoleAclFeatures(request, adminToken, {
        roleId: owner.roleId,
        features: OWNER_NO_EDIT_FEATURES,
        organizations: null,
      })
      const foldersResponse = await apiRequest(request, 'GET', '/api/documents/folders', {
        token: owner.token,
      })
      const foldersBody = await readJsonSafe<FolderListBody>(foldersResponse)
      expect(foldersResponse.status()).toBe(200)
      const folders = flattenFolders(foldersBody?.items ?? [])
      expect(folders.find((folder) => folder.id === ownedFolder?.id)).toMatchObject({
        canEdit: false,
        visibility: 'owned',
      })
      expect(folders.find((folder) => folder.id === visibleFolder?.id)).toMatchObject({
        canEdit: false,
        visibility: 'contains-visible',
      })
      expect(folders.find((folder) => folder.id === ancestorFolder?.id)).toMatchObject({
        canEdit: false,
        visibility: 'ancestor',
      })
      expect(folders.some((folder) => folder.id === unrelatedFolder?.id)).toBe(false)
      expect(JSON.stringify(foldersBody)).not.toContain(unrelatedName)

      await setRoleAclFeatures(request, adminToken, {
        roleId: owner.roleId,
        features: OWNER_EDIT_FEATURES,
        organizations: null,
      })
      const foreignChildResponse = await apiRequest(request, 'POST', '/api/documents/folders', {
        token: owner.token,
        data: { name: `TC-DOCUMENTS-009 denied child ${stamp}`, parentFolderId: ancestorFolder.id },
      })
      expect(foreignChildResponse.status(), 'foreign folder visibility must not grant writes').toBe(403)

      const foreignCreateResponse = await apiRequest(request, 'POST', '/api/documents', {
        token: owner.token,
        data: { title: `TC-DOCUMENTS-009 denied document ${stamp}`, folderId: ancestorFolder.id },
      })
      expect(foreignCreateResponse.status(), 'foreign folder must reject document creation').toBe(403)

      ownerDocument = await createDocument(
        request,
        owner.token,
        `TC-DOCUMENTS-009 owner document ${stamp}`,
        ownedFolder.id,
      )
      const foreignMoveResponse = await request.fetch(`/api/documents/${encodeURIComponent(ownerDocument.id)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${owner.token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: ownerDocument.updatedAt,
        },
        data: { folderId: ancestorFolder.id },
      })
      expect(foreignMoveResponse.status(), 'foreign folder must reject document moves').toBe(403)

      const cycleResponse = await request.fetch('/api/documents/folders', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: ancestorFolder.updatedAt,
        },
        data: { id: ancestorFolder.id, parentFolderId: visibleFolder.id },
      })
      expect(cycleResponse.status(), 'moving a folder beneath its descendant must fail').toBe(400)

      const nonEmptyAncestorDelete = await request.fetch('/api/documents/folders', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: ancestorFolder.updatedAt,
        },
        data: { id: ancestorFolder.id },
      })
      expect(nonEmptyAncestorDelete.status(), 'folder with an active child must not delete').toBe(409)
      const ancestorDeleteBody = await nonEmptyAncestorDelete.text()
      expect(ancestorDeleteBody).not.toContain(visibleName)
      expect(ancestorDeleteBody).not.toContain(visibleFolder.id)

      const nonEmptyVisibleDelete = await request.fetch('/api/documents/folders', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: visibleFolder.updatedAt,
        },
        data: { id: visibleFolder.id },
      })
      expect(nonEmptyVisibleDelete.status(), 'folder with an active document must not delete').toBe(409)
      const visibleDeleteBody = await nonEmptyVisibleDelete.text()
      expect(visibleDeleteBody).not.toContain(visibleDocument.id)
    } finally {
      await deleteShareIfExists(request, adminToken, visibleDocument?.id ?? null, visibleShare)
      await deleteDocumentIfExists(request, adminToken, ownerDocument)
      await deleteDocumentIfExists(request, adminToken, visibleDocument)
      await deleteFolderIfExists(request, adminToken, visibleFolder)
      await deleteFolderIfExists(request, adminToken, ancestorFolder)
      await deleteFolderIfExists(request, adminToken, unrelatedFolder)
      await deleteFolderIfExists(request, adminToken, ownedFolder)
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteRoleIfExists(request, adminToken, owner?.roleId ?? null)
    }
  })

  test('scopes the principal picker to viewers and rejects unauthenticated and no-view callers', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let noView: TestUser | null = null
    let document: CreatedRecord | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenContext(adminToken)
      noView = await createTestUser(request, adminToken, {
        label: 'no-view',
        stamp,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['documents.create'],
      })
      document = await createDocument(
        request,
        adminToken,
        `TC-DOCUMENTS-009 principals ${stamp}`,
        null,
      )

      const authorized = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/principals`,
        { token: adminToken },
      )
      const authorizedBody = await readJsonSafe<PrincipalsBody>(authorized)
      expect(authorized.status(), 'documents.view caller lists principals').toBe(200)
      expect(Array.isArray(authorizedBody?.items)).toBe(true)
      expect(authorizedBody?.pageSize).toBeLessThanOrEqual(20)

      const denied = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/principals`,
        { token: noView.token },
      )
      expect(denied.status(), 'caller without documents.view is forbidden').toBe(403)

      const unauthenticated = await request.get(
        `/api/documents/${encodeURIComponent(document.id)}/principals`,
      )
      expect(unauthenticated.status(), 'unauthenticated caller is rejected').toBe(401)
    } finally {
      await deleteDocumentIfExists(request, adminToken, document)
      await deleteUserIfExists(request, adminToken, noView?.id ?? null)
      await deleteRoleIfExists(request, adminToken, noView?.roleId ?? null)
    }
  })

  test('reports the live sidecar v2 readiness contract when the sidecar is available', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let document: CreatedRecord | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      document = await createDocument(
        request,
        adminToken,
        `TC-DOCUMENTS-009 readiness ${stamp}`,
        null,
      )
      const tokenResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(document.id)}/collab-token`,
        { token: adminToken },
      )
      const tokenBody = await readJsonSafe<CollabTokenBody>(tokenResponse)
      expect(tokenResponse.status()).toBe(200)
      test.skip(!tokenBody?.url, 'Documents collaboration sidecar URL is not configured')

      const healthResponse = await request
        .get(healthUrlFromWebSocketUrl(tokenBody?.url as string))
        .catch(() => null)
      test.skip(!healthResponse, 'Documents collaboration sidecar is not reachable')
      expect(healthResponse?.status()).toBe(200)
      await expect(readJsonSafe<Record<string, unknown>>(healthResponse!)).resolves.toEqual({
        status: 'ok',
        service: 'documents-collab',
        capabilityTokenVersion: 2,
      })
      expect(healthResponse?.headers()['cache-control']).toBe('no-store')
    } finally {
      await deleteDocumentIfExists(request, adminToken, document)
    }
  })
})
