import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, clearAuthTokenCache, getAuthToken, withCredentialIsolatedRequest } from './api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from './authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from './attachmentsFixtures'
import { expectId, getTokenContext, readJsonSafe } from './generalFixtures'

export const OWNER_ACCESS_FEATURES = [
  'documents.view', 'documents.edit', 'documents.create', 'documents.share', 'documents.delete',
  'attachments.view', 'attachments.manage',
]
export const OWNER_ACCESS_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMwSpn2H4QZYAwASOwIrfM45AsAAAAASUVORK5CYII=',
  'base64',
)

export type OwnerAccessItem = { id: string; tags?: string[]; assignments?: Array<{ type: string; id: string; label?: string | null }> }
export type OwnerAccessList = { items: OwnerAccessItem[]; total?: number; availableTags?: string[] }
export type OwnerAccessActor = { id: string; token: string; refreshToken: () => Promise<string> }
type Assignment = { type: string; id: string; label?: string }
type Share = { id: string; updatedAt: string }

export async function ownerPolicyRequest<Body = { error?: string }>(
  method: string, path: string, token: string, data?: unknown, scheme: 'Bearer' | 'ApiKey' = 'Bearer',
) {
  return withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.fetch(path, {
      method, headers: { Authorization: `${scheme} ${token}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { data }),
    })
    return {
      status: response.status(), headers: response.headers(),
      body: await readJsonSafe<Body>(response), bytes: await response.body(),
    }
  })
}

export type AttachmentOwnerFixture = {
  admin: string
  roleId: string
  prefix: string
  recipient: OwnerAccessActor
  unshared: OwnerAccessActor
  visible: string
  hidden: string
  destination: string
  document: (label: string, token?: string) => Promise<string>
  share: (documentId: string, permission: 'viewer' | 'editor', principalType?: 'user' | 'role', principalId?: string, token?: string) => Promise<Share>
  upload: (documentId: string, label: string, options?: { entityId?: string; assignments?: Assignment[]; tags?: string[] }) => Promise<string>
  uploadProxy: (documentId: string) => Promise<{ attachmentId: string; url: string }>
  uploadPublicImage: (documentId: string) => Promise<string>
  key: () => Promise<{ id: string; secret: string }>
}

export async function withAttachmentOwnerFixture(
  request: APIRequestContext, run: (fixture: AttachmentOwnerFixture) => Promise<void>,
): Promise<void> {
  const admin = await getAuthToken(request, 'admin')
  const scope = getTokenContext(admin)
  const prefix = `attachment-owner-${randomUUID()}`
  const users: string[] = [], documents: string[] = [], attachments: string[] = [], keys: string[] = []
  let roleId: string | null = null
  try {
    roleId = await createRoleFixture(request, admin, { name: prefix, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, admin, { roleId, features: OWNER_ACCESS_FEATURES })
    const actor = async (label: string): Promise<OwnerAccessActor> => {
      const email = `${prefix}-${label}@example.com`, password = `Owner1!${randomUUID()}`
      const id = await createUserFixture(request, admin, {
        email, password, organizationId: scope.organizationId, roles: [roleId!], name: label,
      })
      users.push(id)
      return { id, token: await getAuthToken(request, email, password), refreshToken: async () => {
        clearAuthTokenCache()
        return getAuthToken(request, email, password)
      } }
    }
    const recipient = await actor('recipient'), unshared = await actor('unshared')
    const document = async (label: string, token = admin): Promise<string> => {
      const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title: `${prefix}-${label}`, folderId: null } })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ id: string }>(response)
      const id = expectId(body?.id, 'Fixture response must include id'); documents.push(id); return id
    }
    const share: AttachmentOwnerFixture['share'] = async (documentId, permission, principalType = 'user', principalId = recipient.id, token = admin) => {
      const response = await apiRequest(request, 'POST', `/api/documents/${documentId}/shares`, {
        token, data: { principalType, principalId, permission },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<Share>(response)
      expect(body?.updatedAt).toBeTruthy()
      return { id: expectId(body?.id, 'Fixture response must include id'), updatedAt: body!.updatedAt }
    }
    const upload: AttachmentOwnerFixture['upload'] = async (documentId, label, options = {}) => {
      const file = await uploadAttachmentFixture(request, admin, {
        entityId: options.entityId ?? 'documents:document', recordId: documentId,
        fileName: `${prefix}-${label}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`${prefix}-${label}-content`),
        assignments: options.assignments, tags: options.tags,
      })
      attachments.push(file.id); return file.id
    }
    const uploadProxy = async (documentId: string) => {
      const route = `/api/documents/${documentId}/attachments`
      const response = await request.fetch(process.env.BASE_URL?.trim() ? `${process.env.BASE_URL.trim()}${route}` : route, {
        method: 'POST', headers: { Authorization: `Bearer ${admin}` },
        multipart: { file: { name: `${prefix}-proxy.png`, mimeType: 'image/png', buffer: OWNER_ACCESS_PNG } },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ attachmentId: string; url: string }>(response)
      return { attachmentId: expectId(body?.attachmentId, 'Document upload must include attachmentId'), url: String(body?.url) }
    }
    const key = async () => {
      const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: admin, data: { name: prefix, tenantId: scope.tenantId, organizationId: scope.organizationId, roles: [roleId] },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ id: string; secret: string }>(response)
      const id = expectId(body?.id, 'Fixture response must include id'); keys.push(id)
      expect(body?.secret).toMatch(/^omk_/)
      return { id, secret: body!.secret }
    }
    const uploadPublicImage = async (documentId: string) => {
      const file = await uploadAttachmentFixture(request, admin, {
        entityId: 'catalog:catalog_product', recordId: randomUUID(),
        fileName: `${prefix}-public.png`, mimeType: 'image/png', buffer: OWNER_ACCESS_PNG,
        assignments: [{ type: 'documents:document', id: documentId }],
      })
      attachments.push(file.id)
      expect(file.partitionCode).toBe('productsMedia')
      return file.id
    }
    const visible = await document('visible'), hidden = await document('hidden'), destination = await document('destination')
    await share(visible, 'viewer')
    await run({ admin, roleId, prefix, recipient, unshared, visible, hidden, destination, document, share, upload, uploadProxy, uploadPublicImage, key })
  } finally {
    for (const id of keys) await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${id}`, { token: admin }).catch(() => undefined)
    for (const id of attachments) await deleteAttachmentIfExists(request, admin, id)
    for (const id of documents.reverse()) await apiRequest(request, 'DELETE', `/api/documents/${id}`, { token: admin }).catch(() => undefined)
    for (const id of users) await deleteUserIfExists(request, admin, id)
    await deleteRoleIfExists(request, admin, roleId)
  }
}
