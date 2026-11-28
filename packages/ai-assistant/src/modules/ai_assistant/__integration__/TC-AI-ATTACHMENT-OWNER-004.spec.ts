import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

type ReadAttachmentResponse = {
  success?: boolean
  result?: { found?: boolean; attachmentId?: string; id?: string }
}

type ListAttachmentsResponse = {
  success?: boolean
  result?: { items?: Array<{ id: string }>; total?: number }
}

/**
 * TC-AI-ATTACHMENT-OWNER-004: the `attachments.*` AI tools never reach an
 * attachment of another organization or another tenant. Copies of a library
 * file (no owner policy, so only the scope boundary can refuse them) and of a
 * Documents file are placed in a second organization of the same tenant and in
 * an organization of a second tenant. Users, the administrator and an API key
 * of the first organization read them as `found: false` and list nothing on
 * their records, while the original library file stays readable; every foreign
 * row is unchanged afterwards.
 */
test('TC-AI-ATTACHMENT-OWNER-004: AI attachment tools refuse attachments of another organization or tenant', async ({ request }) => {
  test.slow()
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const libraryRecordId = randomUUID()
    const libraryFile = await fixture.upload(libraryRecordId, 'library-ai', { entityId: 'attachments:library' })
    const documentFile = await fixture.upload(fixture.visible, 'visible-foreign-ai')
    const foreign = [
      await fixture.foreignCopy(libraryFile, 'organization'),
      await fixture.foreignCopy(libraryFile, 'tenant'),
      await fixture.foreignCopy(documentFile, 'organization', { recordId: fixture.visible }),
      await fixture.foreignCopy(documentFile, 'tenant', { recordId: fixture.visible }),
    ]
    const before = await Promise.all(foreign.map((row) => readAttachmentRowInDb(row.id)))
    expect(before.every((row) => row !== null)).toBe(true)

    const key = await fixture.key()
    const callers = [
      { label: 'unshared user', token: await fixture.unshared.refreshToken(), scheme: 'Bearer' as const, seesDocument: false },
      { label: 'shared recipient', token: await fixture.recipient.refreshToken(), scheme: 'Bearer' as const, seesDocument: true },
      { label: 'administrator', token: fixture.admin, scheme: 'Bearer' as const, seesDocument: true },
      { label: 'API key', token: key.secret, scheme: 'ApiKey' as const, seesDocument: false },
    ]
    const listIds = async (caller: (typeof callers)[number], entityType: string, recordId: string) => {
      const list = await ownerPolicyRequest<ListAttachmentsResponse>('POST', '/api/ai_assistant/tools/execute', caller.token, {
        toolName: 'attachments.list_record_attachments',
        args: { entityType, recordId },
      }, caller.scheme)
      expect(list.status, caller.label).toBe(200)
      return list.body?.result?.items?.map((item) => item.id) ?? []
    }

    for (const caller of callers) {
      const own = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', caller.token, {
        toolName: 'attachments.read_attachment',
        args: { attachmentId: libraryFile },
      }, caller.scheme)
      expect(own.status, caller.label).toBe(200)
      expect(own.body?.result?.found, `${caller.label} reads the library file of its own organization`).toBe(true)
      expect(await listIds(caller, 'attachments:library', libraryRecordId), `${caller.label} lists the library file of its own organization`).toContain(libraryFile)
      const documentIds = await listIds(caller, 'documents:document', fixture.visible)
      if (caller.seesDocument) expect(documentIds, `${caller.label} lists the document file of its own organization`).toContain(documentFile)
      else expect(documentIds, `${caller.label} cannot list the document file`).not.toContain(documentFile)

      for (const row of foreign) {
        const read = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', caller.token, {
          toolName: 'attachments.read_attachment',
          args: { attachmentId: row.id, includeExtractedText: true },
        }, caller.scheme)
        expect(read.status, caller.label).toBe(200)
        expect(read.body?.result, `${caller.label} cannot read a foreign row`).toEqual({ found: false, attachmentId: row.id })

        const entityType = row.recordId === fixture.visible ? 'documents:document' : 'attachments:library'
        expect(await listIds(caller, entityType, row.recordId), `${caller.label} lists no foreign row`).not.toContain(row.id)
      }
    }

    const after = await Promise.all(foreign.map((row) => readAttachmentRowInDb(row.id)))
    expect(after, 'foreign rows are unchanged').toEqual(before)
  })
})
