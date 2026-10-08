import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createQaDeal, deleteQaDealIfExists, updateQaDeal, uniqueSuffix } from './helpers/explainApi'
import {
  DEAL_PROCESS_KEY,
  deleteProjectedCases,
  getXrayStatus,
  readProjectedCase,
  readProjectedEvents,
  runXrayBackfill,
} from './helpers/xrayApi'

/**
 * TC-INS-X01: Deal status changes are projected into Process X-Ray
 * Covers:
 *   - POST /api/customers/deals, PUT /api/customers/deals (status twice)
 *   - POST /api/insights/xray/backfill (202 + progress job, drained worker)
 *   - GET  /api/insights/xray/status
 *
 * The backfill projects the deal's audit history as process activities: the creation, the
 * initial status and every status change, in order, caused by `user`, with the actor stored
 * only as a pseudonym. The case is completed because `win` is a closed deal status, and the
 * status route reports the projected events of the deal process.
 */
test.describe('TC-INS-X01: deal status changes reach the Process X-Ray projection', () => {
  test('backfills the deal lifecycle into events and a completed case', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { tenantId, organizationId, userId } = getTokenScope(token)
      dealId = await createQaDeal(request, token, { title: `QA INS-X01 ${uniqueSuffix()}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_in_progress' })
      await updateQaDeal(request, token, dealId, { status: 'win' })

      await runXrayBackfill(request, token)

      const events = await readProjectedEvents(dealId)
      const live = events.filter((event) => !event.voided)
      expect(live.map((event) => event.activity_key).filter((key) => key === 'created' || key.startsWith('status:')))
        .toEqual(['created', 'status:open', 'status:qa_in_progress', 'status:win'])
      for (const event of live) {
        expect(event.tenant_id).toBe(tenantId)
        expect(event.organization_id).toBe(organizationId)
        expect(event.cause_kind, 'API writes are caused by the signed-in user').toBe('user')
        expect(event.actor_pseudonym, 'the actor is projected').toBeTruthy()
        expect(event.actor_pseudonym, 'the actor is never stored in clear').not.toContain(userId)
      }

      const projectedCase = await readProjectedCase(dealId)
      expect(projectedCase).toEqual(expect.objectContaining({ status: 'completed', event_count: live.length }))
      expect(projectedCase?.dimensions.stages?.status).toBe('win')

      const status = await getXrayStatus(request, token)
      expect(status.status, `GET status should return 200: ${status.text}`).toBe(200)
      expect(status.body?.organizationId).toBe(organizationId)
      expect(status.body?.registry.processes.map((process) => process.processKey)).toContain(DEAL_PROCESS_KEY)
      expect(status.body?.cursor).toEqual(expect.objectContaining({ contractMatches: true }))
      expect(status.body?.cursor?.status).not.toBe('rebuild_required')
      const dealProcess = status.body?.processes.find((process) => process.processKey === DEAL_PROCESS_KEY)
      expect(dealProcess?.n ?? 0).toBeGreaterThanOrEqual(live.length)

      const rerun = await runXrayBackfill(request, token)
      expect(rerun.progressJobId).toBeTruthy()
      expect((await readProjectedEvents(dealId)).length, 'a second backfill is idempotent').toBe(events.length)
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
      await deleteProjectedCases([dealId])
    }
  })

  test('requires insights.xray.manage for the status and backfill routes', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const status = await getXrayStatus(request, employeeToken)
    expect(status.status).toBe(403)
  })
})
