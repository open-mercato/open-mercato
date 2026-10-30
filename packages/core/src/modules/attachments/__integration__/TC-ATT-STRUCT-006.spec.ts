import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createRoleFixture,
  createUserFixture,
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
  dependsOnModules: ['attachments', 'search'],
}

/**
 * TC-ATT-STRUCT-006: document sections are searchable only from partitions that opt in
 * Source spec: .ai/specs/2026-10-21-document-structure-extraction.md (section search)
 * Surfaces: POST/PUT /api/attachments/partitions (indexDocumentSections), DELETE /api/attachments,
 * GET /api/search/search with entityTypes=attachments:attachment_document_section.
 *
 * Indexing runs on queue workers after extraction completes, toggling the partition flag
 * enqueues a partition-wide sync, and deleting an attachment purges its section records,
 * so every assertion polls.
 */

const SECTION_ENTITY = 'attachments:attachment_document_section'
const SEARCH_TEST_TIMEOUT_MS = 480_000
const SEARCH_POLL_TIMEOUT_MS = 120_000
const SEARCH_POLL_INTERVALS_MS = [1_000, 2_000, 3_000]
const VALID_PASSWORD = 'Valid1!Pass'

type SearchResultItem = {
  entityId?: string
  recordId?: string
  presenter?: { title?: string } | null
}

type SearchBody = {
  results?: SearchResultItem[]
}

type SearchRead = { status: number; results: SearchResultItem[] }

function sectionSearchPath(query: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: '100',
    entityTypes: SECTION_ENTITY,
    strategies: 'tokens',
  })
  return `/api/search/search?${params.toString()}`
}

async function searchSections(request: APIRequestContext, token: string): Promise<SearchRead> {
  const response = await apiRequest(request, 'GET', sectionSearchPath(PAST_PERFORMANCE_PHRASE), { token })
  const body = (await readJsonSafe<SearchBody>(response)) ?? {}
  return { status: response.status(), results: Array.isArray(body.results) ? body.results : [] }
}

function findHit(results: SearchResultItem[], sectionId: string): SearchResultItem | null {
  return results.find((result) => result.entityId === SECTION_ENTITY && result.recordId === sectionId) ?? null
}

async function expectHitState(
  request: APIRequestContext,
  token: string,
  sectionId: string,
  expected: 'present' | 'absent',
  message: string,
): Promise<SearchResultItem | null> {
  let lastHit: SearchResultItem | null = null
  await expect
    .poll(
      async () => {
        const { status, results } = await searchSections(request, token)
        if (status !== 200) return `status:${status}`
        lastHit = findHit(results, sectionId)
        return lastHit ? 'present' : 'absent'
      },
      { message, timeout: SEARCH_POLL_TIMEOUT_MS, intervals: SEARCH_POLL_INTERVALS_MS },
    )
    .toBe(expected)
  return lastHit
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

async function setPartitionIndexing(
  request: APIRequestContext,
  token: string,
  partition: StructurePartition,
  indexDocumentSections: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/attachments/partitions', {
    token,
    data: {
      id: partition.partitionId,
      code: partition.partitionCode,
      title: 'QA structure section search',
      isPublic: false,
      extractDocumentStructure: true,
      indexDocumentSections,
    },
  })
  expect(response.status(), 'PUT /api/attachments/partitions should return 200').toBe(200)
}

test.describe('TC-ATT-STRUCT-006: document section search', () => {
  test('indexes opted-in partitions only and removes records on toggle-off, delete and missing ACL', async ({ request }) => {
    test.setTimeout(SEARCH_TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-006-${Date.now()}`

    const probe = await searchSections(request, adminToken)
    test.skip(probe.status === 404 || probe.status === 503, `search API unavailable (status ${probe.status})`)
    expect(probe.status, 'admin should be allowed to call the search API').toBe(200)

    let indexedPartition: StructurePartition | null = null
    let plainPartition: StructurePartition | null = null
    let deletedAttachmentId: string | null = null
    let toggledAttachmentId: string | null = null
    let plainAttachmentId: string | null = null
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null

    try {
      indexedPartition = await prepareStructurePartition(request, adminToken, 'search_on', { indexDocumentSections: true })
      test.skip(!indexedPartition.partitionId, 'attachment partitions are locked by the environment; section indexing cannot be enabled')
      plainPartition = await prepareStructurePartition(request, adminToken, 'search_off')

      const pdf = await buildRulebookPdf()
      deletedAttachmentId = await uploadStructureDocument(request, adminToken, indexedPartition, {
        fileName: `${stamp}-deleted.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })
      toggledAttachmentId = await uploadStructureDocument(request, adminToken, indexedPartition, {
        fileName: `${stamp}-toggled.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })
      plainAttachmentId = await uploadStructureDocument(request, adminToken, plainPartition, {
        fileName: `${stamp}-plain.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })

      const extractions = [
        await extractAndWait(request, adminToken, deletedAttachmentId, indexedPartition),
        await extractAndWait(request, adminToken, toggledAttachmentId, indexedPartition),
        await extractAndWait(request, adminToken, plainAttachmentId, plainPartition),
      ]
      const unsupported = extractions.find((structure) => structure.extraction?.status !== 'completed')
      test.skip(
        Boolean(unsupported),
        `document structure extraction is not supported here (status ${unsupported?.extraction?.status ?? 'none'})`,
      )

      const deletedSection = await readPastPerformanceSection(request, adminToken, deletedAttachmentId)
      const toggledSection = await readPastPerformanceSection(request, adminToken, toggledAttachmentId)
      const plainSection = await readPastPerformanceSection(request, adminToken, plainAttachmentId)

      const deletedHit = await expectHitState(request, adminToken, deletedSection.id, 'present', 'indexed partition section should become searchable')
      expect(deletedHit?.presenter?.title, 'section hit title should be the section citation').toBe(deletedSection.citation)
      expect(deletedHit?.presenter?.title).toContain('8.12 Past performance')
      const toggledHit = await expectHitState(request, adminToken, toggledSection.id, 'present', 'second indexed section should become searchable')
      expect(toggledHit?.presenter?.title).toBe(toggledSection.citation)

      const afterIndexing = await searchSections(request, adminToken)
      expect(afterIndexing.status).toBe(200)
      expect(findHit(afterIndexing.results, plainSection.id), 'partition without indexing must not produce section hits').toBeNull()

      viewerRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Section Search ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewerRoleId,
        features: ['search.view'],
        organizations: [organizationId],
      })
      const viewerEmail = `${stamp}-search@test.invalid`
      viewerUserId = await createUserFixture(request, superadminToken, {
        email: viewerEmail,
        password: VALID_PASSWORD,
        organizationId,
        roles: [viewerRoleId],
        name: `QA Section Search ${stamp}`,
      })
      const viewerToken = await getAuthToken(request, viewerEmail, VALID_PASSWORD)
      const viewerSearch = await searchSections(request, viewerToken)
      expect(viewerSearch.status, 'search.view without attachments.view keeps the 200 contract').toBe(200)
      expect(
        viewerSearch.results.filter((result) => result.entityId === SECTION_ENTITY),
        'a caller without attachments.view must not see section results',
      ).toEqual([])

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/attachments?id=${encodeURIComponent(deletedAttachmentId)}`,
        { token: adminToken },
      )
      expect(deleteResponse.status(), 'DELETE /api/attachments should return 200').toBe(200)
      deletedAttachmentId = null
      await expectHitState(request, adminToken, deletedSection.id, 'absent', 'deleting the attachment should remove its section records')
      await expectHitState(request, adminToken, toggledSection.id, 'present', 'other attachments keep their section records')

      await setPartitionIndexing(request, adminToken, indexedPartition, false)
      await expectHitState(request, adminToken, toggledSection.id, 'absent', 'turning indexing off should remove the partition section records')
    } finally {
      await deleteAttachmentIfExists(request, adminToken, deletedAttachmentId)
      await deleteAttachmentIfExists(request, adminToken, toggledAttachmentId)
      await deleteAttachmentIfExists(request, adminToken, plainAttachmentId)
      await deletePartitionQuietly(request, adminToken, indexedPartition)
      await deletePartitionQuietly(request, adminToken, plainPartition)
      await deleteUserIfExists(request, superadminToken, viewerUserId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
    }
  })
})
