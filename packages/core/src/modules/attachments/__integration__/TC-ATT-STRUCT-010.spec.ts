import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  readStructure,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'ai_assistant', 'documents'],
}

/**
 * TC-ATT-STRUCT-010: document-section reads apply attachment owner access
 * Source: PR #9648 item B-15; spec .ai/specs/2026-10-21-document-structure-extraction.md
 * Surfaces: GET /api/attachments/structure/:id, GET /api/attachments/structure/:id/sections,
 * POST /api/ai_assistant/tools/execute with `attachments.get_document_sections`
 * (session and API-key callers), GET /api/attachments/file/:id as the baseline.
 *
 * A same-organization reader holding attachments.view must not read the sections of an
 * attachment owned by a protected record (documents:document) when the owner resolver
 * denies them, exactly as the file route already returns 404. The owner still reads.
 */

const TEST_TIMEOUT_MS = 300_000
const VALID_PASSWORD = 'QaValid1!Pass'
const READER_FEATURES = ['ai_assistant.view', 'attachments.view']
const TOOL_NAME = 'attachments.get_document_sections'

type Caller = { token: string } | { apiKey: string }

type ToolRead = { status: number; resultStatus: string | null; itemCount: number }

function callerOptions(caller: Caller): { token: string; headers?: Record<string, string> } {
  if ('token' in caller) return { token: caller.token }
  return { token: '', headers: { Authorization: `ApiKey ${caller.apiKey}` } }
}

async function executeSectionsTool(request: APIRequestContext, caller: Caller, attachmentId: string): Promise<ToolRead> {
  const response = await apiRequest(request, 'POST', '/api/ai_assistant/tools/execute', {
    ...callerOptions(caller),
    data: { toolName: TOOL_NAME, args: { attachmentId, numberLabel: '8.12', includeText: true } },
  })
  const body = (await readJsonSafe<{ result?: { status?: string; items?: unknown[] } }>(response)) ?? {}
  return {
    status: response.status(),
    resultStatus: typeof body.result?.status === 'string' ? body.result.status : null,
    itemCount: Array.isArray(body.result?.items) ? body.result!.items!.length : 0,
  }
}

async function fileStatus(request: APIRequestContext, token: string, attachmentId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', `/api/attachments/file/${attachmentId}`, { token })
  return response.status()
}

async function expectSectionsReadable(request: APIRequestContext, caller: Caller, attachmentId: string, label: string) {
  if ('token' in caller) {
    const sections = await readSections(request, caller.token, attachmentId, '?numberLabel=8.12')
    expect(sections.status, `${label}: GET sections should return 200`).toBe(200)
    expect(sections.body?.items?.[0]?.text ?? '', `${label}: section text is returned`).toContain('Past performance')
  }
  const tool = await executeSectionsTool(request, caller, attachmentId)
  expect(tool.status, `${label}: tool call should return 200`).toBe(200)
  expect(tool.resultStatus, `${label}: tool should report the extraction`).toBe('completed')
  expect(tool.itemCount, `${label}: tool should return clause 8.12`).toBe(1)
}

async function expectSectionsHidden(request: APIRequestContext, caller: Caller, attachmentId: string, label: string) {
  if ('token' in caller) {
    const structure = await readStructure(request, caller.token, attachmentId)
    expect(structure.status, `${label}: GET structure should return 404`).toBe(404)
    const sections = await readSections(request, caller.token, attachmentId, '?numberLabel=8.12')
    expect(sections.status, `${label}: GET sections should return 404`).toBe(404)
    expect(JSON.stringify(sections.body ?? {}), `${label}: no section text leaks`).not.toContain('Past performance')
  }
  const tool = await executeSectionsTool(request, caller, attachmentId)
  expect(tool.status, `${label}: tool call keeps the 200 contract`).toBe(200)
  expect(tool.resultStatus, `${label}: tool should report not_found`).toBe('not_found')
  expect(tool.itemCount, `${label}: tool returns no sections`).toBe(0)
}

test.describe('TC-ATT-STRUCT-010: document sections follow attachment owner access', () => {
  test('an attachments.view reader cannot read sections of an owner-protected document, the owner can', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-010-${Date.now()}`

    let partition: StructurePartition | null = null
    let libraryAttachmentId: string | null = null
    let ownedAttachmentId: string | null = null
    let ownerDocumentId: string | null = null
    let apiKeyId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      const documentResponse = await apiRequest(request, 'POST', '/api/documents', {
        token: adminToken,
        data: { title: `${stamp}-owner`, folderId: null },
      })
      test.skip(documentResponse.status() === 404, 'documents module unavailable; owner access cannot be exercised')
      expect(documentResponse.status(), 'POST /api/documents should return 201').toBe(201)
      ownerDocumentId = (await readJsonSafe<{ id?: string }>(documentResponse))?.id ?? null
      expect(typeof ownerDocumentId, 'document id').toBe('string')

      partition = await prepareStructurePartition(request, adminToken, 'owner_access')
      const pdf = await buildRulebookPdf()
      libraryAttachmentId = await uploadStructureDocument(request, adminToken, partition, {
        fileName: `${stamp}-library.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })
      const libraryStructure = await extractAndWait(request, adminToken, libraryAttachmentId, partition)
      test.skip(
        libraryStructure.extraction?.status !== 'completed',
        `document structure extraction is not supported here (status ${libraryStructure.extraction?.status ?? 'none'})`,
      )
      const owned = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'documents:document',
        recordId: ownerDocumentId!,
        fileName: `${stamp}-owned.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
        partitionCode: partition.partitionCode,
      })
      ownedAttachmentId = owned.id
      const ownedStructure = await extractAndWait(request, adminToken, ownedAttachmentId, partition)
      expect(ownedStructure.extraction?.status, 'owned document extraction should complete').toBe('completed')

      roleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Section Reader ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: READER_FEATURES, organizations: [organizationId] })
      const email = `${stamp}-reader@test.invalid`
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: VALID_PASSWORD,
        organizationId,
        roles: [roleId],
        name: `QA Section Reader ${stamp}`,
      })
      const readerToken = await getAuthToken(request, email, VALID_PASSWORD)

      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `QA ${stamp}`, roles: [roleId], organizationId },
      })
      expect(keyResponse.status(), 'POST /api/api_keys/keys should return 201').toBe(201)
      const createdKey = (await readJsonSafe<{ id?: string; secret?: string }>(keyResponse)) ?? {}
      apiKeyId = createdKey.id ?? null
      expect(typeof createdKey.secret, 'the new API key secret is returned once').toBe('string')
      const keyCaller: Caller = { apiKey: createdKey.secret! }

      await expectSectionsReadable(request, { token: adminToken }, ownedAttachmentId, 'document owner')

      await expectSectionsReadable(request, { token: readerToken }, libraryAttachmentId, 'reader on a library file')
      await expectSectionsReadable(request, keyCaller, libraryAttachmentId, 'reader API key on a library file')

      expect(await fileStatus(request, readerToken, ownedAttachmentId), 'baseline: file route hides the owned file').toBe(404)
      await expectSectionsHidden(request, { token: readerToken }, ownedAttachmentId, 'reader on the owned file')
      await expectSectionsHidden(request, keyCaller, ownedAttachmentId, 'reader API key on the owned file')
    } finally {
      await deleteAttachmentIfExists(request, adminToken, libraryAttachmentId)
      await deleteAttachmentIfExists(request, adminToken, ownedAttachmentId)
      if (ownerDocumentId) {
        await apiRequest(request, 'DELETE', `/api/documents/${ownerDocumentId}`, { token: adminToken }).catch(() => undefined)
      }
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, { token: adminToken }).catch(() => undefined)
      }
      await deletePartitionQuietly(request, adminToken, partition)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
