import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEAL_CUSTOM_FIELD_ENTITY_ID,
  DEAL_RESOURCE_KIND,
  NOT_FOUND_BODY,
  createQaDeal,
  createScopedUser,
  deleteQaDealIfExists,
  deleteScopedUser,
  explainRecord,
  getExplainDescriptors,
  uniqueSuffix,
  type ScopedUserFixture,
} from './helpers/explainApi'

const CUSTOMERS_RESOURCE_KINDS = ['customers.company', 'customers.deal', 'customers.person']

/**
 * TC-INS-017: Descriptors follow the caller's features
 * Covers:
 *   - GET /api/insights/explain/descriptors
 *   - GET /api/insights/explain (resource-level feature gate)
 *
 * The admin sees the customers resources with their declared fields and custom
 * field entity. A user holding only `insights.explain.view` gets no customers
 * resources, and explaining a deal answers the generic not-found body.
 */
test.describe('TC-INS-017: explain descriptors are filtered by features', () => {
  test('lists customers resources for the admin and omits them without customers features', async ({ request }) => {
    let adminToken: string | null = null
    let dealId: string | null = null
    const userFixture: ScopedUserFixture = { roleId: null, userId: null }

    try {
      adminToken = await getAuthToken(request, 'admin')
      const adminDescriptors = await getExplainDescriptors(request, adminToken)
      expect(adminDescriptors.status, `admin descriptors should return 200: ${adminDescriptors.text}`).toBe(200)
      const adminKinds = (adminDescriptors.body?.resources ?? []).map((resource) => resource.resourceKind)
      expect(adminKinds).toEqual(expect.arrayContaining(CUSTOMERS_RESOURCE_KINDS))

      const deal = adminDescriptors.body?.resources.find((resource) => resource.resourceKind === DEAL_RESOURCE_KIND)
      expect(deal?.fields.map((field) => field.key)).toEqual(
        expect.arrayContaining(['status', 'pipelineStageId', 'valueAmount', 'ownerUserId']),
      )
      expect(deal?.customFields?.entityId).toBe(DEAL_CUSTOM_FIELD_ENTITY_ID)
      expect(deal?.noHistory).toBeNull()

      const suffix = uniqueSuffix()
      dealId = await createQaDeal(request, adminToken, { title: `QA INS-017 ${suffix}`, status: 'open' })
      const limited = await createScopedUser(request, adminToken, userFixture, {
        label: 'INS-017 explain only',
        features: ['insights.explain.view'],
      })

      const limitedDescriptors = await getExplainDescriptors(request, limited.token)
      expect(limitedDescriptors.status, `limited descriptors should return 200: ${limitedDescriptors.text}`).toBe(200)
      const limitedKinds = (limitedDescriptors.body?.resources ?? []).map((resource) => resource.resourceKind)
      for (const kind of CUSTOMERS_RESOURCE_KINDS) {
        expect(limitedKinds, `${kind} is omitted without customers features`).not.toContain(kind)
      }

      const denied = await explainRecord(request, limited.token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: dealId,
        field: 'status',
      })
      expect(denied.status, 'a resource the caller cannot read is not found').toBe(404)
      expect(denied.body).toEqual(NOT_FOUND_BODY)
    } finally {
      await deleteQaDealIfExists(request, adminToken, dealId)
      await deleteScopedUser(request, adminToken, userFixture)
    }
  })
})
