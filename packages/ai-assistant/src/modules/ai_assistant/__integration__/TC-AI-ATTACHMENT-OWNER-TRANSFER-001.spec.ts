import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
  type AttachmentRowSnapshot,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  deleteSessionKeysInDb,
  issueSessionToken,
  startMcpHttpServer,
  type McpHttpServerHandle,
} from './helpers/mcpHttpServer'

export const integrationMeta = { dependsOnModules: ['documents'] }

type TransferPayload = { transferred?: number; attachmentIds?: string[]; error?: string; code?: string }

const TOOL = 'attachments.transfer_record_attachments'
const DOCUMENT = 'documents:document'

function transferDeniedMessage(): string {
  const localePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'en.json')
  const messages = JSON.parse(readFileSync(localePath, 'utf-8')) as Record<string, string>
  const message = messages['ai_assistant.errors.attachmentTransferDenied']
  if (!message) throw new Error('[internal] ai_assistant.errors.attachmentTransferDenied is missing from en.json')
  return message
}

async function readRows(ids: string[]): Promise<Array<AttachmentRowSnapshot | null>> {
  return Promise.all(ids.map((id) => readAttachmentRowInDb(id)))
}

/**
 * TC-AI-ATTACHMENT-OWNER-TRANSFER-001: `attachments.transfer_record_attachments`
 * refuses to move files into or out of a Documents document the caller cannot
 * edit. `tools/execute` refuses every mutation tool and no shipped agent lists
 * this one for confirmation, so the spec reaches it where it is callable: the
 * HTTP MCP server (`mcp:serve-http`, its own process against the app's
 * database), with the chat session token of a user who edits two documents,
 * views a third and has no share on the others. A transfer into a document the
 * user cannot edit, or out of one they only view, answers the localized
 * `ai_assistant.errors.attachmentTransferDenied` and leaves every row as it
 * was; a library record cannot be moved into a document; files of a document
 * the user cannot see are not moved; a transfer between the two editable
 * documents moves their files and leaves copies in another organization and
 * another tenant untouched.
 */
test('TC-AI-ATTACHMENT-OWNER-TRANSFER-001: transferring attachments refuses protected documents the caller cannot edit', async ({ request }) => {
  test.setTimeout(300_000)
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const { tenantId } = getTokenContext(fixture.admin)
    const source = await fixture.document('transfer-source')
    const target = await fixture.document('transfer-target')
    await fixture.share(source, 'editor')
    await fixture.share(target, 'editor')
    const sourceFiles = [await fixture.upload(source, 'transfer-a'), await fixture.upload(source, 'transfer-b')]
    const viewedFile = await fixture.upload(fixture.visible, 'transfer-viewed')
    const hiddenFile = await fixture.upload(fixture.hidden, 'transfer-hidden')
    const libraryRecordId = randomUUID()
    const libraryFile = await fixture.upload(libraryRecordId, 'transfer-library', { entityId: 'attachments:library' })
    const foreign = [
      await fixture.foreignCopy(sourceFiles[0], 'organization', { recordId: source }),
      await fixture.foreignCopy(sourceFiles[0], 'tenant', { recordId: source }),
    ]
    const foreignIds = foreign.map((row) => row.id)
    const allIds = [...sourceFiles, viewedFile, hiddenFile, libraryFile, ...foreignIds]
    const before = await readRows(allIds)
    expect(before.every((row) => row !== null)).toBe(true)
    const deniedMessage = transferDeniedMessage()

    const sessionUsers = [fixture.recipient.id]
    let server: McpHttpServerHandle | null = null
    try {
      const serverKey = await fixture.key()
      const session = await issueSessionToken(request, await fixture.recipient.refreshToken())
      server = await startMcpHttpServer()
      const mcp = server
      const transfer = async (input: Record<string, unknown>) => {
        const outcome = await mcp.callTool(serverKey.secret, TOOL, { ...input, _sessionToken: session })
        return { isError: outcome.isError, payload: outcome.payload as TransferPayload }
      }
      const expectDenied = async (label: string, input: Record<string, unknown>) => {
        const refused = await transfer(input)
        expect(refused.isError, label).toBe(true)
        expect(refused.payload, label).toEqual({ error: deniedMessage, code: 'EXECUTION_ERROR' })
        expect(await readRows(allIds), `${label}: every row is unchanged`).toEqual(before)
      }

      await expectDenied('into a document the caller cannot see', {
        fromEntityType: DOCUMENT, fromRecordId: source, toEntityType: DOCUMENT, toRecordId: fixture.destination,
      })
      await expectDenied('a subset into a document the caller only views', {
        fromEntityType: DOCUMENT, fromRecordId: source, toEntityType: DOCUMENT, toRecordId: fixture.visible,
        attachmentIds: [sourceFiles[0]],
      })
      await expectDenied('out of a document the caller only views', {
        fromEntityType: DOCUMENT, fromRecordId: fixture.visible, toEntityType: DOCUMENT, toRecordId: target,
      })

      const crossType = await transfer({
        fromEntityType: 'attachments:library', fromRecordId: libraryRecordId, toEntityType: DOCUMENT, toRecordId: fixture.destination,
      })
      expect(crossType.isError, 'a library record cannot be moved into a document').toBe(true)
      expect(crossType.payload.error).toContain('requires fromEntityType and toEntityType to match')
      expect(await readRows(allIds), 'the library row is unchanged').toEqual(before)

      const unseen = await transfer({
        fromEntityType: DOCUMENT, fromRecordId: fixture.hidden, toEntityType: DOCUMENT, toRecordId: target,
      })
      expect(unseen.isError, JSON.stringify(unseen.payload)).toBe(false)
      expect(unseen.payload.transferred, 'files of a document the caller cannot see are not moved').toBe(0)
      expect(await readRows(allIds), 'the hidden file is unchanged').toEqual(before)

      const moved = await transfer({
        fromEntityType: DOCUMENT, fromRecordId: source, toEntityType: DOCUMENT, toRecordId: target,
      })
      expect(moved.isError, JSON.stringify(moved.payload)).toBe(false)
      expect(moved.payload.transferred).toBe(2)
      expect([...(moved.payload.attachmentIds ?? [])].sort()).toEqual([...sourceFiles].sort())

      const after = await readRows(allIds)
      for (const [index, id] of allIds.entries()) {
        const previous = before[index]!
        const current = after[index]
        if (sourceFiles.includes(id)) {
          expect(current?.record_id, 'the editable file moved to the target document').toBe(target)
          expect({ ...current, record_id: previous.record_id, storage_metadata: previous.storage_metadata })
            .toEqual(previous)
        } else {
          expect(current, 'rows outside the transfer are unchanged').toEqual(previous)
        }
      }
    } finally {
      if (server) await server.stop()
      await deleteSessionKeysInDb(sessionUsers, tenantId)
    }
  })
})
