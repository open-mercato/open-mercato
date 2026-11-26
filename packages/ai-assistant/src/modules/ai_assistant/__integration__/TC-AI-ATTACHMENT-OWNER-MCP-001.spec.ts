import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  deleteSessionKeysInDb,
  issueSessionToken,
  startMcpHttpServer,
  type McpHttpServerHandle,
} from './helpers/mcpHttpServer'

export const integrationMeta = { dependsOnModules: ['documents'] }

type ReadPayload = { found?: boolean; attachmentId?: string; id?: string }
type ListPayload = { items?: Array<{ id: string }>; total?: number }
type SectionsPayload = { status?: string }

const SECTION_STATUSES_OF_A_VISIBLE_FILE = ['not_extracted', 'pending', 'processing', 'completed', 'partial', 'failed', 'skipped']

/**
 * TC-AI-ATTACHMENT-OWNER-MCP-001: the HTTP MCP server (`mcp:serve-http`, run
 * as its own process against the app's database) evaluates owner access for
 * the user behind a chat session token. With `_sessionToken` issued by `POST
 * /api/ai_assistant/session-key`, `attachments.read_attachment` and
 * `attachments.list_record_attachments` return a Documents file to a user the
 * document is shared with and refuse it to a user without the share, and after
 * the share is revoked; copies in another organization and another tenant are
 * refused to both. HTTP tool calls without a session token are rejected
 * before attachment access is evaluated, even with a valid server key.
 * `attachments.get_document_sections` answers `not_found` to session callers
 * who cannot read the file. Every row is unchanged.
 */
test('TC-AI-ATTACHMENT-OWNER-MCP-001: HTTP MCP session tokens apply attachment owner access', async ({ request }) => {
  test.setTimeout(300_000)
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const { tenantId } = getTokenContext(fixture.admin)
    const document = await fixture.document('mcp')
    const userShare = await fixture.share(document, 'viewer')
    const file = await fixture.upload(document, 'mcp-file')
    const libraryRecordId = randomUUID()
    const libraryFile = await fixture.upload(libraryRecordId, 'mcp-library', { entityId: 'attachments:library' })
    const foreign = [
      await fixture.foreignCopy(file, 'organization', { recordId: document }),
      await fixture.foreignCopy(file, 'tenant', { recordId: document }),
      await fixture.foreignCopy(libraryFile, 'organization', { recordId: libraryRecordId }),
      await fixture.foreignCopy(libraryFile, 'tenant', { recordId: libraryRecordId }),
    ]
    const rowIds = [file, libraryFile, ...foreign.map((row) => row.id)]
    const before = await Promise.all(rowIds.map((id) => readAttachmentRowInDb(id)))
    expect(before.every((row) => row !== null)).toBe(true)

    const sessionUsers = [fixture.recipient.id, fixture.unshared.id]
    let server: McpHttpServerHandle | null = null
    try {
      const serverKey = await fixture.key()
      const recipientSession = await issueSessionToken(request, await fixture.recipient.refreshToken())
      const unsharedSession = await issueSessionToken(request, await fixture.unshared.refreshToken())
      server = await startMcpHttpServer()
      const mcp = server

      const read = async (attachmentId: string, sessionToken: string) => {
        const outcome = await mcp.callTool(serverKey.secret, 'attachments.read_attachment', {
          attachmentId, includeExtractedText: true, _sessionToken: sessionToken,
        })
        expect(outcome.isError, JSON.stringify(outcome.payload)).toBe(false)
        return outcome.payload as ReadPayload
      }
      const list = async (entityType: string, recordId: string, sessionToken: string) => {
        const outcome = await mcp.callTool(serverKey.secret, 'attachments.list_record_attachments', {
          entityType, recordId, _sessionToken: sessionToken,
        })
        expect(outcome.isError, JSON.stringify(outcome.payload)).toBe(false)
        return ((outcome.payload as ListPayload).items ?? []).map((item) => item.id)
      }
      const sectionsStatus = async (attachmentId: string, sessionToken: string) => {
        const outcome = await mcp.callTool(serverKey.secret, 'attachments.get_document_sections', {
          attachmentId, includeText: false, _sessionToken: sessionToken,
        })
        expect(outcome.isError, JSON.stringify(outcome.payload)).toBe(false)
        return (outcome.payload as SectionsPayload).status
      }

      const shared = await read(file, recipientSession)
      expect(shared.found, 'the session token of the shared user reads the file').toBe(true)
      expect(shared.id).toBe(file)
      expect(await list('documents:document', document, recipientSession), 'the shared user lists the file').toEqual([file])
      expect(SECTION_STATUSES_OF_A_VISIBLE_FILE, 'the shared user reaches the document structure')
        .toContain(await sectionsStatus(file, recipientSession))

      expect(await read(file, unsharedSession), 'the session token of a user without the share is refused')
        .toEqual({ found: false, attachmentId: file })
      expect(await list('documents:document', document, unsharedSession), 'the user without the share lists nothing').toEqual([])
      expect(await sectionsStatus(file, unsharedSession), 'the user without the share gets no document structure')
        .toBe('not_found')

      const callsWithoutSession = [
        { name: 'attachments.read_attachment', args: { attachmentId: file, includeExtractedText: true } },
        { name: 'attachments.read_attachment', args: { attachmentId: libraryFile, includeExtractedText: true } },
        { name: 'attachments.list_record_attachments', args: { entityType: 'documents:document', recordId: document } },
        { name: 'attachments.get_document_sections', args: { attachmentId: file, includeText: false } },
      ]
      for (const { name, args } of callsWithoutSession) {
        expect(await mcp.callTool(serverKey.secret, name, args), `${name} requires a user session`).toMatchObject({
          isError: true,
          payload: { code: 'UNAUTHORIZED' },
        })
      }

      for (const session of [recipientSession, unsharedSession]) {
        expect((await read(libraryFile, session)).found, 'the unprotected library file stays readable').toBe(true)
        expect(await list('attachments:library', libraryRecordId, session)).toEqual([libraryFile])
        for (const row of foreign) {
          expect(await read(row.id, session), 'a foreign row is refused').toEqual({ found: false, attachmentId: row.id })
        }
      }

      await fixture.unshare(document, userShare)
      expect(await read(file, recipientSession), 'the session token loses access with its user')
        .toEqual({ found: false, attachmentId: file })
      expect(await list('documents:document', document, recipientSession)).toEqual([])
      expect(await sectionsStatus(file, recipientSession), 'the document structure is refused with the share')
        .toBe('not_found')

      const after = await Promise.all(rowIds.map((id) => readAttachmentRowInDb(id)))
      expect(after, 'every row is unchanged').toEqual(before)
    } finally {
      if (server) await server.stop()
      await deleteSessionKeysInDb(sessionUsers, tenantId)
    }
  })
})
