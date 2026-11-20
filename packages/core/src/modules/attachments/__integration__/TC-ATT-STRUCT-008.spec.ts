import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  PAST_PERFORMANCE_PHRASE,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  uploadStructureDocument,
  type StructurePartition,
  type StructureSection,
} from './helpers/documentStructure'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'search', 'ai_assistant'],
}

/**
 * TC-ATT-STRUCT-008: agent search tools return document section hits under the caller's open rule
 * Source: PR #9648 item B-8 (per-section search for agents); spec .ai/specs/2026-10-21-document-structure-extraction.md
 * Surfaces: POST /api/ai_assistant/tools/execute with `search_query` and `search.hybrid_search`
 * (session and API-key callers), GET /api/search/search as the human baseline.
 *
 * The tools must apply the same per-record visibility as the human search route: a section
 * is returned only when the caller may open its attachment (attachments.view, organization
 * scope, owner access). Before B-8 the tools passed no viewer, so every section was dropped.
 */

const SECTION_ENTITY = 'attachments:attachment_document_section'
const TEST_TIMEOUT_MS = 480_000
const POLL_TIMEOUT_MS = 120_000
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000]
const VALID_PASSWORD = 'Valid1!Pass'
const AGENT_SEARCH_FEATURES = ['ai_assistant.view', 'search.global', 'search.view', 'attachments.view']

type Caller = { token: string } | { apiKey: string }

type ToolHit = { entityId?: string; entityType?: string; recordId?: string }

type ToolRead = { status: number; hits: ToolHit[] }

function callerOptions(caller: Caller): { token: string; headers?: Record<string, string> } {
  if ('token' in caller) return { token: caller.token }
  return { token: '', headers: { Authorization: `ApiKey ${caller.apiKey}` } }
}

async function executeSearchTool(
  request: APIRequestContext,
  caller: Caller,
  toolName: 'search_query' | 'search.hybrid_search',
): Promise<ToolRead> {
  const args = toolName === 'search_query'
    ? { query: PAST_PERFORMANCE_PHRASE, limit: 100, entityTypes: [SECTION_ENTITY], strategies: ['tokens'] }
    : { q: PAST_PERFORMANCE_PHRASE, limit: 100, entityTypes: [SECTION_ENTITY], strategies: ['tokens'] }
  const response = await apiRequest(request, 'POST', '/api/ai_assistant/tools/execute', {
    ...callerOptions(caller),
    data: { toolName, args },
  })
  const body = (await readJsonSafe<{ result?: { results?: ToolHit[] } }>(response)) ?? {}
  const hits = Array.isArray(body.result?.results) ? body.result!.results! : []
  return { status: response.status(), hits }
}

function sectionHitIds(hits: ToolHit[]): string[] {
  return hits
    .filter((hit) => (hit.entityId ?? hit.entityType) === SECTION_ENTITY)
    .map((hit) => hit.recordId ?? '')
}

async function humanSearchFinds(request: APIRequestContext, token: string, sectionId: string): Promise<boolean> {
  const params = new URLSearchParams({
    q: PAST_PERFORMANCE_PHRASE,
    limit: '100',
    entityTypes: SECTION_ENTITY,
    strategies: 'tokens',
  })
  const response = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  if (response.status() !== 200) return false
  const body = (await readJsonSafe<{ results?: ToolHit[] }>(response)) ?? {}
  return sectionHitIds(Array.isArray(body.results) ? body.results : []).includes(sectionId)
}

async function readPastPerformanceSection(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
): Promise<StructureSection> {
  const lookup = await readSections(request, token, attachmentId, '?numberLabel=8.12&includeText=false')
  expect(lookup.status, 'GET sections should return 200').toBe(200)
  expect(lookup.body?.items, 'clause 8.12 should be extracted').toHaveLength(1)
  return lookup.body!.items[0]
}

async function createOwnerDocument(request: APIRequestContext, token: string, title: string): Promise<string | null> {
  const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title, folderId: null } })
  if (response.status() === 404) return null
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, 'document id').toBe('string')
  return body!.id!
}

async function expectToolSees(
  request: APIRequestContext,
  caller: Caller,
  sectionId: string,
  label: string,
): Promise<void> {
  for (const toolName of ['search_query', 'search.hybrid_search'] as const) {
    const read = await executeSearchTool(request, caller, toolName)
    expect(read.status, `${label}: ${toolName} should return 200`).toBe(200)
    expect(sectionHitIds(read.hits), `${label}: ${toolName} should return the section hit`).toContain(sectionId)
  }
}

async function expectToolHides(
  request: APIRequestContext,
  caller: Caller,
  sectionId: string,
  label: string,
): Promise<void> {
  for (const toolName of ['search_query', 'search.hybrid_search'] as const) {
    const read = await executeSearchTool(request, caller, toolName)
    expect(read.status, `${label}: ${toolName} should keep the 200 contract`).toBe(200)
    expect(sectionHitIds(read.hits), `${label}: ${toolName} must not return the section hit`).not.toContain(sectionId)
  }
}

test.describe('TC-ATT-STRUCT-008: agent search tools and document sections', () => {
  test('return section hits the caller may open, and hide them across organizations, without attachments.view and for owner-protected files', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-008-${Date.now()}`

    const probe = await executeSearchTool(request, { token: adminToken }, 'search_query')
    test.skip(probe.status === 404 || probe.status === 503, `AI tools API unavailable (status ${probe.status})`)

    let partition: StructurePartition | null = null
    let libraryAttachmentId: string | null = null
    let ownedAttachmentId: string | null = null
    let ownerDocumentId: string | null = null
    let otherOrganizationId: string | null = null
    let apiKeyId: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []

    const createCaller = async (name: string, features: string[], callerOrganizationId: string) => {
      const roleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA ${name} ${stamp}` })
      roleIds.push(roleId)
      await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [callerOrganizationId] })
      const email = `${stamp}-${name.toLowerCase().replace(/\s+/g, '-')}@test.invalid`
      const userId = await createUserFixture(request, superadminToken, {
        email,
        password: VALID_PASSWORD,
        organizationId: callerOrganizationId,
        roles: [roleId],
        name: `QA ${name} ${stamp}`,
      })
      userIds.push(userId)
      return { roleId, token: await getAuthToken(request, email, VALID_PASSWORD) }
    }

    try {
      partition = await prepareStructurePartition(request, adminToken, 'agent_search', { indexDocumentSections: true })
      test.skip(!partition.partitionId, 'attachment partitions are locked by the environment; section indexing cannot be enabled')

      const pdf = await buildRulebookPdf()
      libraryAttachmentId = await uploadStructureDocument(request, adminToken, partition, {
        fileName: `${stamp}-library.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })
      const structure = await extractAndWait(request, adminToken, libraryAttachmentId, partition)
      test.skip(
        structure.extraction?.status !== 'completed',
        `document structure extraction is not supported here (status ${structure.extraction?.status ?? 'none'})`,
      )
      const librarySection = await readPastPerformanceSection(request, adminToken, libraryAttachmentId)

      await expect
        .poll(() => humanSearchFinds(request, adminToken, librarySection.id), {
          message: 'the human search route should find the indexed section first',
          timeout: POLL_TIMEOUT_MS,
          intervals: POLL_INTERVALS_MS,
        })
        .toBe(true)

      await expectToolSees(request, { token: adminToken }, librarySection.id, 'admin session')

      const reader = await createCaller('Agent Section Reader', AGENT_SEARCH_FEATURES, organizationId)
      await expectToolSees(request, { token: reader.token }, librarySection.id, 'attachments.view reader')

      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `QA ${stamp}`, roles: [reader.roleId], organizationId },
      })
      expect(keyResponse.status(), 'POST /api/api_keys/keys should return 201').toBe(201)
      const createdKey = (await readJsonSafe<{ id?: string; secret?: string }>(keyResponse)) ?? {}
      apiKeyId = createdKey.id ?? null
      expect(typeof createdKey.secret, 'the new API key secret is returned once').toBe('string')
      await expectToolSees(request, { apiKey: createdKey.secret! }, librarySection.id, 'API key with the reader role')

      const blind = await createCaller('Agent Section Blind', ['ai_assistant.view', 'search.global', 'search.view'], organizationId)
      await expectToolHides(request, { token: blind.token }, librarySection.id, 'caller without attachments.view')

      otherOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QA Other Org ${stamp}`, tenantId })
      const outsider = await createCaller('Agent Section Outsider', AGENT_SEARCH_FEATURES, otherOrganizationId)
      await expectToolHides(request, { token: outsider.token }, librarySection.id, 'caller in another organization')

      ownerDocumentId = await createOwnerDocument(request, adminToken, `${stamp}-owner`)
      if (!ownerDocumentId) {
        test.info().annotations.push({ type: 'skip-part', description: 'documents module unavailable; owner-access section filter not exercised' })
      } else {
        const owned = await uploadAttachmentFixture(request, adminToken, {
          entityId: 'documents:document',
          recordId: ownerDocumentId,
          fileName: `${stamp}-owned.pdf`,
          mimeType: 'application/pdf',
          buffer: pdf,
          partitionCode: partition.partitionCode,
        })
        ownedAttachmentId = owned.id
        const ownedStructure = await extractAndWait(request, adminToken, ownedAttachmentId, partition)
        expect(ownedStructure.extraction?.status, 'owned document extraction should complete').toBe('completed')
        const ownedSection = await readPastPerformanceSection(request, adminToken, ownedAttachmentId)
        await expect
          .poll(() => humanSearchFinds(request, adminToken, ownedSection.id), {
            message: 'the document owner should find the owned section',
            timeout: POLL_TIMEOUT_MS,
            intervals: POLL_INTERVALS_MS,
          })
          .toBe(true)
        await expectToolSees(request, { token: adminToken }, ownedSection.id, 'document owner')
        await expectToolHides(request, { token: reader.token }, ownedSection.id, 'reader who cannot open the owned file')
      }
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
      for (const userId of userIds) await deleteUserIfExists(request, superadminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
    }
  })
})
