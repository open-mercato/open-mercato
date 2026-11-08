import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  INBOUND_EMAIL_ENTITY_ID,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  textPart,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

type AttachmentRow = {
  id: string
  entity_id: string
  record_id: string
  organization_id: string | null
  tenant_id: string | null
  partition_code: string
  storage_path: string
  storage_metadata: Record<string, unknown> | null
}

type Assignment = { type: string; id: string } & Record<string, unknown>

const LIBRARY_ENTITY_ID = 'attachments:library'

async function readAttachment(client: IntegrationDbClient, id: string): Promise<AttachmentRow | null> {
  const result = await client.query<AttachmentRow>(
    `select id, entity_id, record_id, organization_id, tenant_id, partition_code, storage_path, storage_metadata
       from attachments where id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

/**
 * Plants an attachment row as a copy of `sourceId` (same tenant, partition, file columns) with the
 * given owner, organization, stored object and `storage_metadata`, the way other modules' copies
 * reuse `storage_path` (catalog variant media, message forwarding).
 */
async function plantAttachment(
  client: IntegrationDbClient,
  sourceId: string,
  row: { entityId: string; recordId: string; organizationId: string; storagePath: string; storageMetadata: Record<string, unknown> },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `with new_row as (select gen_random_uuid() as id)
     insert into attachments (id, entity_id, record_id, organization_id, tenant_id, partition_code, file_name, mime_type,
                              file_size, storage_driver, storage_path, storage_metadata, url, content, created_at)
     select new_row.id, $2, $3, $4::uuid, source.tenant_id, source.partition_code, source.file_name, source.mime_type,
            source.file_size, source.storage_driver, $5, $6::jsonb, '/api/attachments/file/' || new_row.id, null, now()
       from attachments as source, new_row
      where source.id = $1
     returning id`,
    [sourceId, row.entityId, row.recordId, row.organizationId, row.storagePath, JSON.stringify(row.storageMetadata)],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error('[internal] could not plant an attachment row')
  return id
}

function assignmentsOf(row: AttachmentRow | null): unknown {
  return row?.storage_metadata?.assignments
}

/**
 * TC-INBOX-ATT-011: `attachmentService.releaseOwnedScoped` against real Postgres. The email's own
 * stored part is released through `releaseScoped` first, so rows other modules attached to the
 * email are planted through SQL to reach `releaseOwnedScoped` with real rows: its locked
 * containment query on both `assignments` shapes, the storage-reference check and the scope filter.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-011: deleting an email removes its references from other attachment rows', () => {
  test('deletes, re-points or detaches rows referencing the email and leaves other scopes untouched', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const planted: string[] = []
    let libraryCopyId: string | null = null
    const run = uniqueRunId('TC-INBOX-ATT-011')
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Shared offer ${run}`,
        text: 'Offer attached.',
        attachments: [textPart(`${run}-offer.txt`, 'shared offer bytes')],
      })
      const [sourceId] = received.email.attachmentIds ?? []
      expect(sourceId, 'The ingested part should be stored').toBeTruthy()
      const emailId = received.emailId
      const messageId = randomUUID()
      const documentId = randomUUID()
      const otherOrganizationId = randomUUID()

      const ids = await withClient(async (client) => {
        const source = await readAttachment(client, sourceId)
        if (!source?.organization_id) throw new Error('[internal] the ingested attachment row is missing')
        // The shape `createScoped` really stores: one array entry for the owning email.
        const stored = assignmentsOf(source) as Assignment[]
        expect(stored).toEqual([expect.objectContaining({ type: INBOUND_EMAIL_ENTITY_ID, id: emailId })])
        const emailAssignment = stored[0]
        const organizationId = source.organization_id
        const fakePath = (name: string) => `${source.storage_path}.tc-inbox-att-011-${name}`

        // (1) email-owned, no other assignment, sharing the stored object with a library copy.
        const ownedShared = await plantAttachment(client, sourceId, {
          entityId: INBOUND_EMAIL_ENTITY_ID, recordId: emailId, organizationId,
          storagePath: source.storage_path, storageMetadata: { assignments: [emailAssignment] },
        })
        planted.push(ownedShared)
        libraryCopyId = await plantAttachment(client, sourceId, {
          entityId: LIBRARY_ENTITY_ID, recordId: run, organizationId,
          storagePath: source.storage_path, storageMetadata: { assignments: [{ type: LIBRARY_ENTITY_ID, id: run }] },
        })
        // (2) email-owned with another assignment.
        const ownedAssigned = await plantAttachment(client, sourceId, {
          entityId: INBOUND_EMAIL_ENTITY_ID, recordId: emailId, organizationId,
          storagePath: fakePath('assigned'),
          storageMetadata: { tags: [run], assignments: [emailAssignment, { type: 'messages:message', id: messageId }] },
        })
        planted.push(ownedAssigned)
        // (3) library-owned rows holding the email assignment, array and legacy object shape.
        const libraryArray = await plantAttachment(client, sourceId, {
          entityId: LIBRARY_ENTITY_ID, recordId: run, organizationId,
          storagePath: fakePath('library-array'),
          storageMetadata: { assignments: [{ type: 'documents:document', id: documentId }, emailAssignment] },
        })
        planted.push(libraryArray)
        const libraryLegacy = await plantAttachment(client, sourceId, {
          entityId: LIBRARY_ENTITY_ID, recordId: run, organizationId,
          storagePath: fakePath('library-legacy'),
          storageMetadata: { assignments: { type: INBOUND_EMAIL_ENTITY_ID, id: emailId } },
        })
        planted.push(libraryLegacy)
        // (4) the same owner and assignment in another organization.
        const otherScope = await plantAttachment(client, sourceId, {
          entityId: INBOUND_EMAIL_ENTITY_ID, recordId: emailId, organizationId: otherOrganizationId,
          storagePath: fakePath('other-org'), storageMetadata: { assignments: [emailAssignment] },
        })
        planted.push(otherScope)
        return { ownedShared, ownedAssigned, libraryArray, libraryLegacy, otherScope, otherScopeBefore: await readAttachment(client, otherScope) }
      })

      const deleted = await apiRequest(request, 'DELETE', `/api/inbox_ops/emails/${emailId}`, { token: admin })
      expect(deleted.status()).toBe(200)

      const after = await withClient(async (client) => ({
        source: await readAttachment(client, sourceId),
        ownedShared: await readAttachment(client, ids.ownedShared),
        libraryCopy: libraryCopyId ? await readAttachment(client, libraryCopyId) : null,
        ownedAssigned: await readAttachment(client, ids.ownedAssigned),
        libraryArray: await readAttachment(client, ids.libraryArray),
        libraryLegacy: await readAttachment(client, ids.libraryLegacy),
        otherScope: await readAttachment(client, ids.otherScope),
        email: (await client.query<{ released: boolean }>(
          'select attachments_released_at is not null as released from inbox_emails where id = $1',
          [emailId],
        )).rows[0],
      }))

      // (1) Deleted with the email's own part, while the stored bytes stay for the library copy.
      expect(after.source).toBeNull()
      expect(after.ownedShared).toBeNull()
      expect(after.libraryCopy).toMatchObject({ entity_id: LIBRARY_ENTITY_ID, record_id: run })
      const download = await ownerPolicyRequest('GET', `/api/attachments/file/${libraryCopyId}`, admin)
      expect(download.status, 'The library copy should still be readable').toBe(200)
      expect(download.bytes.toString('utf8')).toBe('shared offer bytes')
      // (2) Re-pointed to the remaining assignment.
      expect(after.ownedAssigned).toMatchObject({ entity_id: 'messages:message', record_id: messageId })
      expect(after.ownedAssigned?.storage_metadata).toMatchObject({ tags: [run], assignments: [{ type: 'messages:message', id: messageId }] })
      // (3) Only the email assignment removed, in both shapes.
      expect(after.libraryArray).toMatchObject({ entity_id: LIBRARY_ENTITY_ID, record_id: run })
      expect(assignmentsOf(after.libraryArray)).toEqual([{ type: 'documents:document', id: documentId }])
      expect(after.libraryLegacy).toMatchObject({ entity_id: LIBRARY_ENTITY_ID, record_id: run })
      expect(assignmentsOf(after.libraryLegacy)).toEqual([])
      // (4) Another organization is untouched.
      expect(after.otherScope).toEqual(ids.otherScopeBefore)
      expect(after.email).toEqual({ released: true })
    } finally {
      if (libraryCopyId) {
        // The library copy holds the last reference to the stored bytes: delete it through the API so they go too.
        await ownerPolicyRequest('DELETE', `/api/attachments?id=${libraryCopyId}`, admin).catch(() => undefined)
        planted.push(libraryCopyId)
      }
      if (planted.length) {
        await withClient((client) => client.query('delete from attachments where id = any($1::uuid[])', [planted])).catch(() => undefined)
      }
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
