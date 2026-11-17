import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, clearAuthTokenCache, getAuthToken, withCredentialIsolatedRequest } from './api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from './authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from './attachmentsFixtures'
import { createOrganizationInDb, withClient } from './dbFixtures'
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

/** Every stored column of an attachment row, read straight from the database. */
export type AttachmentRowSnapshot = {
  id: string
  entity_id: string
  record_id: string
  tenant_id: string | null
  organization_id: string | null
  partition_code: string
  file_name: string
  mime_type: string
  file_size: number
  storage_driver: string
  storage_path: string
  storage_metadata: unknown
  url: string
  content: string | null
  created_at: Date
}
export type ForeignAttachmentScope = 'organization' | 'tenant'
export type ForeignAttachment = { id: string; tenantId: string; organizationId: string; recordId: string }

const ATTACHMENT_ROW_COLUMNS = [
  'id', 'entity_id', 'record_id', 'tenant_id', 'organization_id', 'partition_code', 'file_name', 'mime_type',
  'file_size', 'storage_driver', 'storage_path', 'storage_metadata', 'url', 'content', 'created_at',
].join(', ')

export async function readAttachmentRowInDb(attachmentId: string): Promise<AttachmentRowSnapshot | null> {
  return withClient(async (client) => {
    const result = await client.query<AttachmentRowSnapshot>(
      `select ${ATTACHMENT_ROW_COLUMNS} from attachments where id = $1`, [attachmentId],
    )
    return result.rows[0] ?? null
  })
}

export async function ownerPolicyRequest<Body = { error?: string }>(
  method: string, path: string, token: string, data?: unknown, scheme: 'Bearer' | 'ApiKey' = 'Bearer',
  headers: Record<string, string> = {},
) {
  return withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.fetch(path, {
      method, headers: { ...headers, Authorization: `${scheme} ${token}`, 'Content-Type': 'application/json' },
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
  unshare: (documentId: string, share: Share, token?: string) => Promise<void>
  /**
   * Copies an uploaded row into another organization of this tenant, or into an
   * organization of a second tenant, straight in the database. Both scopes are
   * created on first use and removed with the copies in teardown.
   */
  foreignCopy: (attachmentId: string, scope: ForeignAttachmentScope, options?: { entityId?: string; recordId?: string }) => Promise<ForeignAttachment>
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
  const foreignAttachments: string[] = [], foreignOrganizations: string[] = [], foreignTenants: string[] = []
  const foreignScopes = new Map<ForeignAttachmentScope, { tenantId: string; organizationId: string }>()
  let roleId: string | null = null
  let runFailed = false
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
    const unshare: AttachmentOwnerFixture['unshare'] = async (documentId, revoked, token = admin) => {
      const response = await apiRequest(request, 'DELETE', `/api/documents/${documentId}/shares`, { token, data: { id: revoked.id } })
      expect(response.status()).toBe(200)
    }
    const foreignScope = async (kind: ForeignAttachmentScope) => {
      const existing = foreignScopes.get(kind)
      if (existing) return existing
      let tenantId = scope.tenantId
      if (kind === 'tenant') {
        tenantId = randomUUID()
        await withClient((client) => client.query(
          'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
          [tenantId, `${prefix}-tenant`],
        ))
        foreignTenants.push(tenantId)
      }
      const organizationId = await createOrganizationInDb({ name: `${prefix}-${kind}`, tenantId })
      foreignOrganizations.push(organizationId)
      const created = { tenantId, organizationId }
      foreignScopes.set(kind, created)
      return created
    }
    const foreignCopy: AttachmentOwnerFixture['foreignCopy'] = async (attachmentId, kind, options = {}) => {
      const target = await foreignScope(kind)
      const id = randomUUID()
      const recordId = options.recordId ?? randomUUID()
      const inserted = await withClient((client) => client.query<{ id: string }>(
        `insert into attachments (id, entity_id, record_id, tenant_id, organization_id, partition_code, file_name, mime_type,
           file_size, storage_driver, storage_path, storage_metadata, url, content, created_at)
         select $2, coalesce($3, entity_id), $4, $5, $6, partition_code, file_name, mime_type,
           file_size, storage_driver, storage_path, storage_metadata, url, content, created_at
         from attachments where id = $1
         returning id`,
        [attachmentId, id, options.entityId ?? null, recordId, target.tenantId, target.organizationId],
      ))
      expect(inserted.rows).toHaveLength(1)
      foreignAttachments.push(id)
      return { id, recordId, ...target }
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
    await run({
      admin, roleId, prefix, recipient, unshared, visible, hidden, destination,
      document, share, unshare, foreignCopy, upload, uploadProxy, uploadPublicImage, key,
    })
  } catch (error) {
    runFailed = true
    throw error
  } finally {
    const foreignCleanupErrors: unknown[] = []
    if (foreignAttachments.length > 0 || foreignOrganizations.length > 0 || foreignTenants.length > 0) {
      await withClient(async (client) => {
        const cleanups: Array<[string, string[]]> = [
          ['delete from attachments where id = any($1::uuid[])', foreignAttachments],
          ['delete from organizations where id = any($1::uuid[])', foreignOrganizations],
          ['delete from tenants where id = any($1::uuid[])', foreignTenants],
        ]
        for (const [statement, ids] of cleanups) {
          if (ids.length === 0) continue
          await client.query(statement, [ids]).catch((error: unknown) => { foreignCleanupErrors.push(error) })
        }
      }).catch((error: unknown) => { foreignCleanupErrors.push(error) })
    }
    for (const id of keys) await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${id}`, { token: admin }).catch(() => undefined)
    for (const id of attachments) await deleteAttachmentIfExists(request, admin, id)
    for (const id of documents.reverse()) await apiRequest(request, 'DELETE', `/api/documents/${id}`, { token: admin }).catch(() => undefined)
    for (const id of users) await deleteUserIfExists(request, admin, id)
    await deleteRoleIfExists(request, admin, roleId)
    if (foreignCleanupErrors.length > 0 && !runFailed) {
      throw new AggregateError(foreignCleanupErrors, '[internal] Attachment owner fixture could not remove its foreign-scope rows')
    }
  }
}
