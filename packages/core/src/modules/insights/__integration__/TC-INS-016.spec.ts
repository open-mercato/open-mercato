import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures'
import {
  explainFieldOk,
  explainRecord,
  uniqueSuffix,
  type ExplainOverviewBody,
} from './helpers/explainApi'

export const integrationMeta = {
  dependsOnModules: ['customer_groups'],
}

const GROUP_RESOURCE_KIND = 'customer_groups.group'
const NO_HISTORY_REASON_KEY = 'customer_groups.insights.noHistory'

/**
 * TC-INS-016: Modules that record no history say so instead of guessing
 * Covers:
 *   - POST /api/customer_groups/customer-groups
 *   - GET  /api/insights/explain?resourceKind=customer_groups.group (field and overview)
 *
 * Customer groups are written outside the audit log. Explaining a group field
 * returns `no_history` with the module's own reason key, an empty chain and an
 * `unknown` confidence, while the current value is still shown.
 */
test.describe('TC-INS-016: explain a customer group (module without history)', () => {
  test('returns no_history with the customer_groups reason key', async ({ request }) => {
    let token: string | null = null
    let groupId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      const name = `QA INS-016 ${suffix}`
      groupId = await createCustomerGroupFixture(request, token, { code: `qa_ins016_${suffix}`, name })

      const body = await explainFieldOk(request, token, { resourceKind: GROUP_RESOURCE_KIND, resourceId: groupId, field: 'name' })
      expect(body.current.value, 'the current value is shown').toBe(name)
      expect(body.verdict).toBe('no_history')
      expect(body.confidence).toBe('unknown')
      expect(body.chain).toEqual([])
      expect(body.summary).toEqual({
        key: 'insights.explain.summary.noHistoryModule',
        params: { reasonKey: NO_HISTORY_REASON_KEY },
      })
      expect(body.hints).toContainEqual(expect.objectContaining({
        key: 'insights.explain.hints.noHistoryModule',
        params: { reasonKey: NO_HISTORY_REASON_KEY },
      }))

      const overview = await explainRecord<ExplainOverviewBody>(request, token, {
        resourceKind: GROUP_RESOURCE_KIND,
        resourceId: groupId,
      })
      expect(overview.status, `overview should return 200: ${overview.text}`).toBe(200)
      expect(overview.body?.coverage.noHistory).toEqual({ reasonKey: NO_HISTORY_REASON_KEY })
      expect(overview.body?.fields.length, 'the overview lists the declared group fields').toBeGreaterThan(0)
      for (const field of overview.body?.fields ?? []) {
        expect(field.verdict, `${field.field} has no history`).toBe('no_history')
      }
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId)
    }
  })
})
