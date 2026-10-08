import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEAL_RESOURCE_KIND,
  DEAL_UPDATE_COMMAND_ID,
  createQaDeal,
  deleteQaDealIfExists,
  explainFieldOk,
  listDealAuditActions,
  updateQaDeal,
  uniqueSuffix,
} from './helpers/explainApi'

/**
 * TC-INS-010: A field changed only through the API is explained with proof
 * Covers:
 *   - POST /api/customers/deals, PUT /api/customers/deals (status twice)
 *   - GET  /api/insights/explain?resourceKind=customers.deal&field=status
 *
 * Every change went through the command bus as the signed-in user, so the chain
 * lists both changes newest-first, each caused by `user`, the newest value matches
 * the record, and the overall confidence is `proven`.
 */
test.describe('TC-INS-010: explain a deal status changed twice via the API', () => {
  test('returns an explained, proven chain of user changes newest-first', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { userId } = getTokenScope(token)
      const suffix = uniqueSuffix()
      dealId = await createQaDeal(request, token, { title: `QA INS-010 ${suffix}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_in_progress' })
      await updateQaDeal(request, token, dealId, { status: 'qa_negotiation' })

      const updateLogIds = (await listDealAuditActions(request, token, dealId))
        .filter((item) => item.commandId === DEAL_UPDATE_COMMAND_ID)
        .map((item) => item.id)
      expect(updateLogIds, 'both status changes are audited').toHaveLength(2)

      const body = await explainFieldOk(request, token, { resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId, field: 'status' })

      expect(body.resourceKind).toBe(DEAL_RESOURCE_KIND)
      expect(body.resourceId).toBe(dealId)
      expect(body.field).toBe('status')
      expect(body.current.value, 'the current value is the record value').toBe('qa_negotiation')
      expect(body.verdict).toBe('explained')
      expect(body.confidence).toBe('proven')
      expect(body.summary.key).toBe('insights.explain.summary.explained')
      expect(body.gaps, 'API-only history has no gaps').toEqual([])
      expect(body.viewer).toEqual({ canSeeActors: true, canSeePastValues: true, canSeeOwnValues: true })

      const [newest, previous] = body.chain
      expect(body.chain.length, 'chain holds both updates (and the create)').toBeGreaterThanOrEqual(2)
      expect([newest.logId, previous.logId], 'the chain is ordered newest-first and links the audit rows').toEqual(updateLogIds)
      expect(Date.parse(newest.at)).toBeGreaterThanOrEqual(Date.parse(previous.at))

      expect(newest.from?.value).toBe('qa_in_progress')
      expect(newest.to?.value).toBe('qa_negotiation')
      expect(previous.from?.value).toBe('open')
      expect(previous.to?.value).toBe('qa_in_progress')

      for (const entry of [newest, previous]) {
        expect(entry.commandId).toBe(DEAL_UPDATE_COMMAND_ID)
        expect(entry.state).toBe('done')
        expect(entry.confidence, `${entry.logId} is proven`).toBe('proven')
        expect(entry.from?.redacted).toBe(false)
        expect(entry.to?.redacted).toBe(false)
        expect(entry.actor).toEqual(expect.objectContaining({ kind: 'user', id: userId, isSelf: true, redacted: false }))
      }
      for (const entry of body.chain) {
        expect(entry.cause.kind, `${entry.logId} is caused by the user`).toBe('user')
        expect(entry.cause.legacy).toBe(false)
        expect(entry.cause.derivedFromActor).toBe(false)
      }
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
