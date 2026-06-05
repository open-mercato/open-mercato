import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteAttachmentPartitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

/**
 * TC-ATT-012: Partition uniqueness — duplicate code rejected with 409
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments/partitions (POST, GET)
 *
 * Partition mutations are locked when DEMO_MODE/self-service onboarding is active
 * (the common case), in which POST returns 403. When unlocked, creating a duplicate
 * code returns 409 while a distinct code still succeeds.
 */
test.describe('TC-ATT-012: Attachment partition uniqueness', () => {
  test('should reject duplicate partition codes with 409 when partitions are unlocked', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const code = `qa_unique_012_${stamp}`
    const otherCode = `qa_unique_012b_${stamp}`

    let partitionId: string | null = null
    let otherPartitionId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: { code, title: 'QA Unique 012' },
      })

      // Environment-locked deployments manage partitions via env and return 403.
      if (createResponse.status() === 403) {
        test.skip(true, 'Attachment partitions are environment-locked (DEMO_MODE/onboarding); skipping uniqueness checks.')
      }

      expect(createResponse.status(), 'first partition create should be 201').toBe(201)
      const createBody = await readJsonSafe<{ item?: { id?: string; code?: string } }>(createResponse)
      partitionId = createBody?.item?.id ?? null
      expect(createBody?.item?.code).toBe(code)

      // Duplicate code → 409 with a uniqueness message.
      const duplicateResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: { code, title: 'QA Unique 012 Duplicate' },
      })
      expect(duplicateResponse.status(), 'duplicate code should be 409').toBe(409)
      const duplicateBody = await readJsonSafe<{ error?: string }>(duplicateResponse)
      expect(duplicateBody?.error ?? '').toMatch(/already exists/i)

      // A distinct code still succeeds (no interference).
      const otherResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: { code: otherCode, title: 'QA Unique 012 Other' },
      })
      expect(otherResponse.status(), 'distinct code create should be 201').toBe(201)
      const otherBody = await readJsonSafe<{ item?: { id?: string } }>(otherResponse)
      otherPartitionId = otherBody?.item?.id ?? null

      // Listing includes both new partitions.
      const listResponse = await apiRequest(request, 'GET', '/api/attachments/partitions', { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ code?: string }> }>(listResponse)
      const codes = new Set((listBody?.items ?? []).map((entry) => entry.code))
      expect(codes.has(code)).toBe(true)
      expect(codes.has(otherCode)).toBe(true)
    } finally {
      await deleteAttachmentPartitionIfExists(request, token, partitionId)
      await deleteAttachmentPartitionIfExists(request, token, otherPartitionId)
    }
  })
})
