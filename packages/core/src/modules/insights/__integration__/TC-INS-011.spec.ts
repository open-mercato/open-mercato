import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEAL_RESOURCE_KIND,
  DEAL_UPDATE_COMMAND_ID,
  createQaDeal,
  deleteQaDealIfExists,
  explainFieldOk,
  setDealStatusBypassingAudit,
  updateQaDeal,
  uniqueSuffix,
} from './helpers/explainApi'

const RECENT_WRITE_AGE_SECONDS = 5
const OUTSIDE_GRACE_AGE_SECONDS = 5 * 60

/**
 * TC-INS-011: A value written outside the command bus is never attributed to a cause
 * Covers:
 *   - PUT /api/customers/deals (status) followed by a raw SQL status write
 *   - GET /api/insights/explain?resourceKind=customers.deal&field=status
 *
 * Right after an audited API update the verdict is `explained`. Once the status is
 * changed directly in the database (no audit row), the engine reports `pending`
 * while `updated_at` is inside the 2-minute grace window and `unexplained` with a
 * `current_differs` gap outside it. The newest chain entry stays the API change: the
 * raw value is never attributed to it ("a false cause is worse than unknown").
 */
test.describe('TC-INS-011: explain a status changed outside the audit log', () => {
  test('reports explained after the API write and unexplained after a raw database write', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      const apiStatus = `qa_api_${suffix}`
      const rawStatus = `qa_raw_${suffix}`
      dealId = await createQaDeal(request, token, { title: `QA INS-011 ${suffix}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: apiStatus })
      const query = { resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId, field: 'status' }

      const afterApi = await explainFieldOk(request, token, query)
      expect(afterApi.verdict, 'an audited API write is explained immediately').toBe('explained')
      expect(afterApi.confidence).toBe('proven')
      expect(afterApi.current.value).toBe(apiStatus)
      expect(afterApi.gaps).toEqual([])
      const apiEntry = afterApi.chain[0]
      expect(apiEntry.commandId).toBe(DEAL_UPDATE_COMMAND_ID)
      expect(apiEntry.to?.value).toBe(apiStatus)

      await setDealStatusBypassingAudit(dealId, rawStatus, RECENT_WRITE_AGE_SECONDS)
      const recent = await explainFieldOk(request, token, query)
      expect(recent.current.value).toBe(rawStatus)
      expect(recent.verdict, 'a fresh unlogged difference is still inside the grace window').toBe('pending')
      expect(recent.confidence).toBe('unknown')
      expect(recent.hints.map((hint) => hint.key)).toContain('insights.explain.hints.pending')

      await setDealStatusBypassingAudit(dealId, rawStatus, OUTSIDE_GRACE_AGE_SECONDS)
      const stale = await explainFieldOk(request, token, query)
      expect(stale.current.value, 'the current value is always the record value').toBe(rawStatus)
      expect(stale.verdict).toBe('unexplained')
      expect(stale.confidence).toBe('unknown')
      expect(stale.summary.key).toBe('insights.explain.summary.unexplained')

      const newest = stale.chain[0]
      expect(newest.logId, 'the newest entry is still the audited API change').toBe(apiEntry.logId)
      expect(newest.to?.value, 'the raw value is not attributed to the API change').toBe(apiStatus)
      expect(newest.confidence).not.toBe('proven')
      expect(
        stale.chain.some((entry) => entry.to?.value === rawStatus || entry.from?.value === rawStatus),
        'no chain entry claims to have written the raw value',
      ).toBe(false)

      expect(stale.gaps[0]).toEqual(expect.objectContaining({
        reason: 'current_differs',
        afterLogId: apiEntry.logId,
        beforeLogId: null,
      }))
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
