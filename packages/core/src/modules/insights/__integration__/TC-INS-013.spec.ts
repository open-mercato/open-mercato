import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEAL_RESOURCE_KIND,
  NOT_FOUND_BODY,
  createQaDeal,
  deleteQaDealIfExists,
  explainRecord,
  uniqueSuffix,
  type ApiResult,
  type ExplainFieldBody,
} from './helpers/explainApi'

/**
 * TC-INS-013: Out-of-scope records are indistinguishable from missing ones
 * Covers:
 *   - GET /api/insights/explain (field and overview) for a deal in another organization
 *
 * A deal that exists in an organization outside the caller's scope answers with
 * exactly the same 404 body (`{"error":"not_found"}`) as a random UUID or an
 * unknown resource kind, so explain never reveals that the record exists. Selecting
 * the deal's organization proves the record itself is explainable.
 */
test.describe('TC-INS-013: explain hides records from other organizations', () => {
  test('returns the identical not_found body for another organization, a random id and an unknown kind', async ({ request }) => {
    let token: string | null = null
    let otherOrgId: string | null = null
    let otherDealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { tenantId, organizationId: homeOrgId } = getTokenScope(token)
      const suffix = uniqueSuffix()
      otherOrgId = await createOrganizationInDb({ name: `QA INS-013 Org ${suffix}`, tenantId })
      otherDealId = await createQaDeal(request, token, {
        title: `QA INS-013 ${suffix}`,
        status: 'open',
        selectedOrgId: otherOrgId,
      })

      const inScope = await explainRecord(
        request,
        token,
        { resourceKind: DEAL_RESOURCE_KIND, resourceId: otherDealId, field: 'status' },
        { selectedOrgId: otherOrgId },
      )
      expect(inScope.status, `the deal is explainable inside its own organization: ${inScope.text}`).toBe(200)
      expect(inScope.body?.current.value).toBe('open')

      const expectNotFound = (result: ApiResult<unknown>, label: string) => {
        expect(result.status, `${label} answers 404`).toBe(404)
        expect(result.body, `${label} answers the generic body`).toEqual(NOT_FOUND_BODY)
      }

      const outOfScope = await explainRecord<ExplainFieldBody>(request, token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: otherDealId,
        field: 'status',
      })
      expectNotFound(outOfScope, 'another organization (home scope)')

      const homeSelected = await explainRecord(
        request,
        token,
        { resourceKind: DEAL_RESOURCE_KIND, resourceId: otherDealId, field: 'status' },
        { selectedOrgId: homeOrgId },
      )
      expectNotFound(homeSelected, 'another organization (home organization selected)')

      const overview = await explainRecord(request, token, { resourceKind: DEAL_RESOURCE_KIND, resourceId: otherDealId })
      expectNotFound(overview, 'another organization (overview)')

      const randomId = await explainRecord(request, token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: randomUUID(),
        field: 'status',
      })
      expectNotFound(randomId, 'a random id')

      const unknownKind = await explainRecord(request, token, {
        resourceKind: `qa_unknown.kind_${suffix}`,
        resourceId: otherDealId,
        field: 'status',
      })
      expectNotFound(unknownKind, 'an unknown resource kind')

      const bodies = new Set([outOfScope.text, homeSelected.text, overview.text, randomId.text, unknownKind.text])
      expect(bodies.size, 'every not-found response is byte-identical').toBe(1)
    } finally {
      await deleteQaDealIfExists(request, token, otherDealId, otherOrgId ? { selectedOrgId: otherOrgId } : {})
      await deleteOrganizationInDb(otherOrgId).catch(() => undefined)
    }
  })
})
