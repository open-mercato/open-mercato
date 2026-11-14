import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
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
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  readStructure,
  structurePath,
  uploadStructureDocument,
  waitForStructure,
  type StructurePartition,
} from './helpers/documentStructure'

test.describe('TC-ATT-STRUCT-003: requesting extraction and access control', () => {
  test('queues re-extraction for managers, forbids viewers and hides the attachment from another organization', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: orgAId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-003-${Date.now()}`
    const password = 'Valid1!Pass'

    let partition: StructurePartition | null = null
    let attachmentId: string | null = null
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null
    let orgBId: string | null = null
    let orgBRoleId: string | null = null
    let orgBUserId: string | null = null

    try {
      partition = await prepareStructurePartition(request, adminToken, 'access')
      attachmentId = await uploadStructureDocument(request, adminToken, partition, {
        fileName: 'qa-rulebook-access.pdf',
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })
      const initial = await extractAndWait(request, adminToken, attachmentId, partition)
      const initialExtractionId = initial.extraction?.id
      expect(initialExtractionId).toBeTruthy()

      const current = await apiRequest(request, 'POST', structurePath(attachmentId), { token: adminToken, data: {} })
      expect(current.status(), 'a current extraction is returned without queueing').toBe(200)
      const currentBody = await readJsonSafe<{ extractionId?: string; status?: string }>(current)
      expect(currentBody).toMatchObject({ extractionId: initialExtractionId, status: 'completed' })

      const forced = await apiRequest(request, 'POST', structurePath(attachmentId), {
        token: adminToken,
        data: { force: true, ocr: 'never' },
      })
      expect(forced.status(), 'a forced request is queued').toBe(202)
      const forcedBody = await readJsonSafe<{ extractionId?: string | null; status?: string }>(forced)
      expect(forcedBody).toMatchObject({ extractionId: null, status: 'pending' })
      const reextracted = await waitForStructure(request, adminToken, attachmentId, { notExtractionId: initialExtractionId })
      expect(reextracted.extraction?.status).toBe('completed')
      expect(reextracted.outline.find((node) => node.numberLabel === '8.12')?.anchorKey).toBe(
        initial.outline.find((node) => node.numberLabel === '8.12')?.anchorKey,
      )

      const invalid = await apiRequest(request, 'POST', structurePath(attachmentId), {
        token: adminToken,
        data: { ocr: 'sometimes' },
      })
      expect(invalid.status()).toBe(400)

      viewerRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Struct Viewer ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewerRoleId,
        features: ['attachments.view'],
        organizations: [orgAId],
      })
      const viewerEmail = `${stamp}-viewer@test.invalid`
      viewerUserId = await createUserFixture(request, superadminToken, {
        email: viewerEmail,
        password,
        organizationId: orgAId,
        roles: [viewerRoleId],
        name: `QA Struct Viewer ${stamp}`,
      })
      const viewerToken = await getAuthToken(request, viewerEmail, password)
      const viewerRead = await readStructure(request, viewerToken, attachmentId)
      expect(viewerRead.status, 'attachments.view can read the structure').toBe(200)
      const viewerRequest = await apiRequest(request, 'POST', structurePath(attachmentId), {
        token: viewerToken,
        data: { force: true },
      })
      expect(viewerRequest.status(), 'requesting extraction requires attachments.manage').toBe(403)

      orgBId = await createOrganizationFixture(request, superadminToken, { tenantId, name: `QA Struct Org B ${stamp}` })
      orgBRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Struct Org B ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgBRoleId,
        features: ['attachments.view', 'attachments.manage'],
        organizations: [orgBId],
      })
      const orgBEmail = `${stamp}-orgb@test.invalid`
      orgBUserId = await createUserFixture(request, superadminToken, {
        email: orgBEmail,
        password,
        organizationId: orgBId,
        roles: [orgBRoleId],
        name: `QA Struct Org B ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, orgBEmail, password)
      expect(getTokenScope(orgBToken).organizationId).toBe(orgBId)

      expect((await readStructure(request, orgBToken, attachmentId)).status, 'GET structure hides other orgs').toBe(404)
      expect((await readSections(request, orgBToken, attachmentId)).status, 'GET sections hides other orgs').toBe(404)
      const orgBRequest = await apiRequest(request, 'POST', structurePath(attachmentId), {
        token: orgBToken,
        data: { force: true },
      })
      expect(orgBRequest.status(), 'POST structure hides other orgs').toBe(404)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deletePartitionQuietly(request, adminToken, partition)
      await deleteUserIfExists(request, superadminToken, viewerUserId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
      await deleteUserIfExists(request, superadminToken, orgBUserId)
      await deleteRoleIfExists(request, superadminToken, orgBRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
