import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

export const integrationMeta = { dependsOnModules: ['attachments', 'documents', 'staff'] }

const membersPath = '/api/staff/team-members'
const entriesPath = '/api/staff/timesheets/time-entries'

async function createRecord(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>) {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `POST ${path} should create a fixture`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `POST ${path} should return an id`)
}

async function relationOptions(request: APIRequestContext, token: string, entityId: string, search: string) {
  const params = new URLSearchParams({ entityId, q: search })
  const response = await apiRequest(request, 'GET', `/api/entities/relations/options?${params}`, { token })
  expect(response.status(), `Lookup should be available for ${entityId}`).toBe(200)
  return response.json() as Promise<{ items: Array<{ value: string; label: string }> }>
}

test('TC-ENTITIES-9106: owner policy restricts staff time entry and attachment relation labels', async ({ request }) => {
  const admin = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(admin)
  const stamp = `Relation-QA-${randomUUID()}`
  const ownEntryLabel = `${stamp}-mine`
  const otherEntryLabel = `${stamp}-colleague`
  const libraryLabel = `${stamp}-library.txt`
  const documentLabel = `${stamp}-document.txt`
  const records: Array<{ path: string; id: string }> = []
  let roleId: string | null = null
  let userId: string | null = null
  let documentId: string | null = null
  let libraryAttachmentId: string | null = null
  let documentAttachmentId: string | null = null

  await withCredentialIsolatedRequest(async (provisioning) => {
    const superadmin = await getAuthToken(provisioning, 'superadmin')
    try {
      roleId = await createRoleFixture(provisioning, superadmin, { name: stamp, tenantId })
      await setRoleAclFeatures(provisioning, superadmin, {
        roleId, features: ['entities.definitions.view', 'attachments.view', 'documents.view', 'staff.timesheets.view'],
        organizations: [organizationId],
      })
      const email = `relation-${randomUUID()}@example.test`
      const password = `Test-${randomUUID()}!aA1`
      userId = await createUserFixture(provisioning, superadmin, { email, password, organizationId, roles: [roleId] })
      const ownMember = await createRecord(request, admin, membersPath, { displayName: `${stamp} Viewer`, userId })
      records.push({ path: membersPath, id: ownMember })
      const otherMember = await createRecord(request, admin, membersPath, { displayName: `${stamp} Colleague` })
      records.push({ path: membersPath, id: otherMember })

      const createEntry = async (staffMemberId: string, notes: string) => {
        const id = await createRecord(request, admin, entriesPath, {
          staffMemberId, notes, date: new Date().toISOString().slice(0, 10), durationMinutes: 15, source: 'manual',
        })
        records.push({ path: entriesPath, id })
        return id
      }
      const ownEntryId = await createEntry(ownMember, ownEntryLabel)
      const otherEntryId = await createEntry(otherMember, otherEntryLabel)

      documentId = await createRecord(request, admin, '/api/documents', { title: stamp, folderId: null })
      const upload = (entityId: string, recordId: string, fileName: string) => uploadAttachmentFixture(request, admin, {
        entityId, recordId, fileName, mimeType: 'text/plain', buffer: Buffer.from('Synthetic relation fixture'),
      })
      libraryAttachmentId = (await upload('attachments:library', randomUUID(), libraryLabel)).id
      documentAttachmentId = (await upload('documents:document', documentId, documentLabel)).id

      const staffEntity = 'staff:staff_time_entry'
      const attachmentEntity = 'attachments:attachment'
      const adminEntries = await relationOptions(request, admin, staffEntity, stamp)
      expect(adminEntries.items).toHaveLength(2)
      expect(adminEntries.items).toEqual(expect.arrayContaining([
        { value: ownEntryId, label: ownEntryLabel }, { value: otherEntryId, label: otherEntryLabel },
      ]))
      const adminAttachments = await relationOptions(request, admin, attachmentEntity, stamp)
      expect(adminAttachments.items).toHaveLength(2)
      expect(adminAttachments.items).toEqual(expect.arrayContaining([
        { value: libraryAttachmentId, label: libraryLabel }, { value: documentAttachmentId, label: documentLabel },
      ]))

      await withCredentialIsolatedRequest(async (viewer) => {
        const token = await getAuthToken(viewer, email, password)
        expect(await relationOptions(viewer, token, staffEntity, stamp)).toEqual({
          items: [{ value: ownEntryId, label: ownEntryLabel }],
        })
        expect(await relationOptions(viewer, token, attachmentEntity, stamp)).toEqual({
          items: [{ value: libraryAttachmentId, label: libraryLabel }],
        })
      })
    } finally {
      await deleteAttachmentIfExists(request, admin, documentAttachmentId)
      await deleteAttachmentIfExists(request, admin, libraryAttachmentId)
      if (documentId) await apiRequest(request, 'DELETE', `/api/documents/${documentId}`, { token: admin }).catch(() => undefined)
      for (const { path, id } of records.reverse()) await deleteStaffEntityIfExists(request, admin, path, id)
      await deleteUserIfExists(provisioning, superadmin, userId)
      await deleteRoleIfExists(provisioning, superadmin, roleId)
    }
  })
})
