import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteMessageIfExists } from './helpers'

const limitedFeatures = ['messages.compose', 'messages.attach_files', 'messages.view', 'attachments.view']
type AttachmentRow = { id: string; entity_id: string; record_id: string; tenant_id: string; organization_id: string }

test.describe('TC-API-MSG-9017: message attachment source authorization', () => {
  let adminToken = ''
  let rootToken = ''
  let actorToken = ''
  let roleId: string | null = null
  let userId: string | null = null
  let scope: ReturnType<typeof getTokenScope>
  const uploaded: string[] = []
  const cloned: string[] = []
  const messages = new Map<string, string>()

  async function upload(request: APIRequestContext, token: string, entityId = 'attachments:library', recordId = `messages-composer:${randomUUID()}`) {
    const response = await request.post(`${process.env.BASE_URL}/api/attachments`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { entityId, recordId, file: { name: 'security-9017.txt', mimeType: 'text/plain', buffer: Buffer.from('private attachment security fixture') } },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await readJsonSafe<{ item?: { id?: string } }>(response)
    const id = expectId(body?.item?.id, 'upload returns attachment id')
    uploaded.push(id)
    return { id, recordId }
  }

  async function compose(request: APIRequestContext, token: string, extra: Record<string, unknown> = {}) {
    const response = await apiRequest(request, 'POST', '/api/messages', {
      token, data: { subject: 'Security 9017 fixture', body: 'Fixture body', isDraft: true, recipients: [], sendViaEmail: false, ...extra },
    })
    expect(response.status(), await response.text()).toBe(201)
    const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'compose returns message id')
    messages.set(id, token)
    return id
  }

  async function readAttachment(id: string) {
    return withClient(async (client) => (await client.query<AttachmentRow>('select id, entity_id, record_id, tenant_id, organization_id from attachments where id = $1', [id])).rows[0])
  }

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    rootToken = await getAuthToken(request, 'superadmin')
    scope = getTokenScope(adminToken)
    roleId = await createRoleFixture(request, rootToken, { name: `security9017_${randomUUID()}`, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, rootToken, { roleId, features: limitedFeatures, organizations: [scope.organizationId] })
    const email = `security9017-${randomUUID()}@test.invalid`
    const password = 'Msg9017!FixturePass'
    userId = await createUserFixture(request, rootToken, { email, password, organizationId: scope.organizationId, roles: [roleId] })
    actorToken = await getAuthToken(request, email, password)
  })

  test.afterAll(async ({ request }) => {
    if (uploaded.length || messages.size) {
      const cleanupIds = await withClient(async (client) => {
        if (cloned.length) await client.query('delete from attachments where id = any($1::uuid[])', [cloned])
        const rows = await client.query<{ id: string }>(
          'select id from attachments where tenant_id = $1 and organization_id = $2 and (id = any($3::uuid[]) or record_id = any($4::text[]) or storage_path in (select storage_path from attachments where id = any($3::uuid[])))',
          [scope.tenantId, scope.organizationId, uploaded, [...messages.keys()]],
        )
        const ids = rows.rows.map((row) => row.id)
        if (ids.length) await client.query("update attachments set entity_id = 'attachments:library', record_id = $2 where id = any($1::uuid[])", [ids, `security9017-cleanup:${randomUUID()}`])
        return ids
      })
      for (const id of cleanupIds) {
        const response = await apiRequest(request, 'DELETE', `/api/attachments/library/${id}`, { token: adminToken })
        expect(response.ok(), `attachment cleanup ${id}: ${response.status()}`).toBe(true)
      }
    }
    for (const [id, token] of messages) await deleteMessageIfExists(request, token, id)
    await deleteUserIfExists(request, rootToken, userId)
    await deleteRoleIfExists(request, rootToken, roleId)
  })

  test('compose-only callers cannot take, unlink or replace foreign sources through any linking entry point', async ({ request }) => {
    const orderRecordId = randomUUID()
    const foreignOwner = await upload(request, adminToken, 'sales:sales_order', orderRecordId)
    const foreignStaging = await upload(request, adminToken)
    const draftId = await compose(request, actorToken)
    const parentId = await compose(request, adminToken, { isDraft: false, recipients: [{ userId, type: 'to' }] })
    const before = await readAttachment(foreignOwner.id)
    for (const attachment of [foreignOwner, foreignStaging]) {
      const attempts: Array<[string, string, Record<string, unknown>]> = [
        ['POST', '/api/messages', { subject: 'Denied', body: 'Denied', isDraft: true, attachmentIds: [attachment.id] }],
        ['POST', '/api/messages', { subject: 'Denied staging', body: 'Denied', isDraft: true, attachmentRecordId: attachment.recordId }],
        ['PATCH', `/api/messages/${draftId}`, { attachmentIds: [attachment.id] }],
        ['POST', `/api/messages/${draftId}/attachments`, { attachmentIds: [attachment.id] }],
        ['POST', `/api/messages/${parentId}/reply`, { body: 'Denied', attachmentIds: [attachment.id] }],
        ['POST', `/api/messages/${parentId}/reply`, { body: 'Denied', attachmentRecordId: attachment.recordId }],
      ]
      for (const [method, path, data] of attempts) {
        if (attachment === foreignOwner && 'attachmentRecordId' in data) continue
        const response = await apiRequest(request, method, path, { token: actorToken, data })
        expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(403)
      }
      const unlink = await apiRequest(request, 'DELETE', `/api/messages/${draftId}/attachments`, { token: actorToken, data: { attachmentIds: [attachment.id] } })
      expect(unlink.ok()).toBe(true)
      expect((await readAttachment(attachment.id)).record_id).toBe(attachment.recordId)
    }
    const clear = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, { token: actorToken, data: { attachmentIds: [] } })
    expect(clear.ok()).toBe(true)
    expect(await readAttachment(foreignOwner.id)).toEqual(before)
  })

  test('new own staging, replies, forwarding, copy removal and internal draft send remain usable without email permission', async ({ request }) => {
    await setRoleAclFeatures(request, rootToken, { roleId: roleId!, features: [...limitedFeatures, 'attachments.manage'], organizations: [scope.organizationId] })
    const own = await upload(request, actorToken)
    const replyUpload = await upload(request, actorToken)
    const sourceFile = await upload(request, adminToken)
    await setRoleAclFeatures(request, rootToken, { roleId: roleId!, features: limitedFeatures, organizations: [scope.organizationId] })
    const sourceId = await compose(request, adminToken, { isDraft: false, recipients: [{ userId, type: 'to' }], attachmentIds: [sourceFile.id] })
    const draftId = await compose(request, actorToken, { attachmentIds: [own.id], attachmentRecordId: own.recordId })
    expect((await readAttachment(own.id)).record_id).toBe(draftId)
    const link = await apiRequest(request, 'POST', `/api/messages/${draftId}/attachments`, { token: actorToken, data: { attachmentIds: [sourceFile.id] } })
    expect(link.ok(), await link.text()).toBe(true)
    expect((await readAttachment(sourceFile.id)).record_id).toBe(sourceId)
    const clear = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, { token: actorToken, data: { attachmentIds: [own.id] } })
    expect(clear.ok(), await clear.text()).toBe(true)
    expect((await readAttachment(sourceFile.id)).record_id).toBe(sourceId)
    const unlink = await apiRequest(request, 'DELETE', `/api/messages/${draftId}/attachments`, { token: actorToken, data: { attachmentIds: [own.id] } })
    expect(unlink.ok(), await unlink.text()).toBe(true)
    expect((await readAttachment(own.id)).entity_id).toBe('attachments:library')
    const reply = await apiRequest(request, 'POST', `/api/messages/${sourceId}/reply`, { token: actorToken, data: { body: 'Legitimate reply', attachmentRecordId: replyUpload.recordId } })
    expect(reply.ok(), await reply.text()).toBe(true)
    messages.set(expectId((await readJsonSafe<{ id?: string }>(reply))?.id, 'reply id'), actorToken)
    const forward = await apiRequest(request, 'POST', `/api/messages/${sourceId}/forward`, { token: actorToken, data: { recipients: [{ userId: scope.userId, type: 'to' }], includeAttachments: true, sendViaEmail: false } })
    expect(forward.ok(), await forward.text()).toBe(true)
    messages.set(expectId((await readJsonSafe<{ id?: string }>(forward))?.id, 'forward id'), actorToken)
    expect((await readAttachment(sourceFile.id)).record_id).toBe(sourceId)
    const send = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, { token: actorToken, data: { isDraft: false, recipients: [{ userId: scope.userId, type: 'to' }], sendViaEmail: false } })
    expect(send.ok(), await send.text()).toBe(true)
  })

  test('enforces scope boundaries and refuses draft email sends using both new and persisted settings', async ({ request }) => {
    const original = await upload(request, adminToken)
    for (const column of ['tenant_id', 'organization_id']) {
      const id = randomUUID()
      cloned.push(id)
      await withClient(async (client) => {
        await client.query(
          `insert into attachments (id, entity_id, record_id, tenant_id, organization_id, partition_code, file_name, mime_type, file_size, storage_driver, storage_path, url, storage_metadata, created_at) select $1, entity_id, record_id, ${column === 'tenant_id' ? '$3' : 'tenant_id'}, ${column === 'organization_id' ? '$3' : 'organization_id'}, partition_code, file_name, mime_type, file_size, storage_driver, storage_path, url, storage_metadata, created_at from attachments where id = $2`,
          [id, original.id, randomUUID()],
        )
      })
      const response = await apiRequest(request, 'POST', '/api/messages', { token: actorToken, data: { isDraft: true, subject: 'Scope denial', body: 'Denied', attachmentIds: [id] } })
      expect(response.status()).toBe(403)
    }
    const draftId = await compose(request, actorToken, { visibility: 'internal', sendViaEmail: false })
    const saveEmail = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, { token: actorToken, data: { sendViaEmail: true, externalEmail: 'outside@test.invalid' } })
    expect(saveEmail.ok()).toBe(true)
    for (const data of [{ isDraft: false }, { isDraft: false, visibility: 'public' }, { isDraft: false, sendViaEmail: true }]) {
      const send = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, { token: actorToken, data })
      expect(send.status(), await send.text()).toBe(403)
    }
    const row = await withClient(async (client) => (await client.query<{ is_draft: boolean }>('select is_draft from messages where id = $1', [draftId])).rows[0])
    expect(row.is_draft).toBe(true)
  })
})
