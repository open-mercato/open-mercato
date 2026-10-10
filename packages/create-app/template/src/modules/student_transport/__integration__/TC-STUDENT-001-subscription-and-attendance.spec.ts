import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createStudentSubscriptionFixture,
  createSubscriptionPlanFixture,
  deleteModuleEntityIfExists,
  fetchModuleList,
  fetchModuleRow,
  isoDayOffset,
  runModuleAction,
  uniqueModuleSuffix,
} from '@open-mercato/core/helpers/integration/moduleFixtures'

export const integrationMeta = {
  dependsOnModules: ['student_transport', 'customers'],
}

const PLANS = '/api/student_transport/plans'
const SUBSCRIPTIONS = '/api/student_transport/subscriptions'
const ATTENDANCE = '/api/student_transport/attendance'
const CHILDREN = '/api/student_transport/children'

/**
 * TC-STUDENT-001: the subscription book and the daily run.
 *
 * The invariants: the direction decides which plan price is snapshotted onto the
 * subscription; a one-way rider appears on exactly one leg of the board; the
 * board upserts one row per child, day and leg; and an absence reported by the
 * family is recorded with `origin: parent` so it stays distinguishable from an
 * unexcused one.
 */
test.describe('TC-STUDENT-001: subscription pricing, the run board and reported absences', () => {
  test('prices the subscription by direction and marks the run', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueModuleSuffix()
    const parentCompany = await createCompanyFixture(request, token, `Parent TC ${suffix}`)
    const snapshot = { id: parentCompany, kind: 'company' as const, displayName: `Parent TC ${suffix}` }
    const tripDate = isoDayOffset(0)

    let planId: string | null = null
    let twoWayId: string | null = null
    let oneWayId: string | null = null
    try {
      planId = await createSubscriptionPlanFixture(request, token, { priceTwoWay: '900', priceOneWay: '520' })

      const twoWay = await createStudentSubscriptionFixture(request, token, {
        customerId: parentCompany,
        customerSnapshot: snapshot,
        planId,
        direction: 'two_way',
      })
      twoWayId = twoWay.id
      const oneWay = await createStudentSubscriptionFixture(request, token, {
        customerId: parentCompany,
        customerSnapshot: snapshot,
        planId,
        direction: 'one_way_pickup',
      })
      oneWayId = oneWay.id

      // The plan's price for the chosen direction is snapshotted on create.
      const twoWayRow = await fetchModuleRow(request, token, SUBSCRIPTIONS, twoWayId)
      expect(Number(twoWayRow?.period_price)).toBe(900)
      const oneWayRow = await fetchModuleRow(request, token, SUBSCRIPTIONS, oneWayId)
      expect(Number(oneWayRow?.period_price)).toBe(520)

      // A draft subscription is not on the run until it is activated.
      const beforeActivation = await fetchModuleList(request, token, ATTENDANCE, { tripDate })
      expect(beforeActivation.items.some((row) => row.subscriptionId === twoWayId)).toBe(false)

      expect((await runModuleAction(request, token, `${SUBSCRIPTIONS}/activate`, { id: twoWayId })).ok).toBeTruthy()
      expect((await runModuleAction(request, token, `${SUBSCRIPTIONS}/activate`, { id: oneWayId })).ok).toBeTruthy()

      const board = await fetchModuleList(request, token, ATTENDANCE, { tripDate })
      const twoWayLegs = board.items.filter((row) => row.subscriptionId === twoWayId).map((row) => row.leg).sort()
      const oneWayLegs = board.items.filter((row) => row.subscriptionId === oneWayId).map((row) => row.leg)
      expect(twoWayLegs).toEqual(['dropoff', 'pickup'])
      expect(oneWayLegs).toEqual(['pickup'])
      expect(board.items.every((row) => row.status === null)).toBe(true)

      // Boarding, then correcting the same slot: one row, updated in place.
      expect((await runModuleAction(request, token, ATTENDANCE, {
        subscriptionId: twoWayId,
        tripDate,
        leg: 'pickup',
        status: 'boarded',
      })).ok).toBeTruthy()
      expect((await runModuleAction(request, token, ATTENDANCE, {
        subscriptionId: twoWayId,
        tripDate,
        leg: 'pickup',
        status: 'absent_unnotified',
      })).ok).toBeTruthy()

      const marked = await fetchModuleList(request, token, ATTENDANCE, { tripDate, subscriptionId: twoWayId, leg: 'pickup' })
      expect(marked.items.length).toBe(1)
      expect(marked.items[0]?.status).toBe('absent_unnotified')

      // A family-reported absence carries its origin, so the office can tell it
      // apart from an unexcused one.
      expect((await runModuleAction(request, token, ATTENDANCE, {
        subscriptionId: oneWayId,
        tripDate,
        leg: 'pickup',
        status: 'absent_notified',
        origin: 'parent',
        notes: 'Doctor appointment',
      })).ok).toBeTruthy()

      const history = await apiRequest(request, 'GET', `${ATTENDANCE}?mode=history&subscriptionId=${oneWayId}`, { token })
      const historyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(history)
      expect(historyBody?.items?.[0]?.status).toBe('absent_notified')
      expect(historyBody?.items?.[0]?.origin).toBe('parent')

      // The family's own view shows both children with their legs.
      const children = await apiRequest(request, 'GET', `${CHILDREN}?tripDate=${tripDate}&customerId=${parentCompany}`, { token })
      const childrenBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(children)
      const ids = (childrenBody?.items ?? []).map((row) => row.subscriptionId)
      expect(ids).toContain(twoWayId)
      expect(ids).toContain(oneWayId)

      // An ended subscription takes no further attendance.
      expect((await runModuleAction(request, token, `${SUBSCRIPTIONS}/end`, { id: oneWayId })).ok).toBeTruthy()
      const afterEnd = await runModuleAction(request, token, ATTENDANCE, {
        subscriptionId: oneWayId,
        tripDate,
        leg: 'pickup',
        status: 'boarded',
      })
      expect(afterEnd.status).toBe(409)
    } finally {
      // The subscriptions deliberately survive: a subscription that carries
      // attendance cannot be deleted (the command refuses), which is the product
      // rule this spec exercises. The plan is removed because nothing keeps it.
      await deleteModuleEntityIfExists(request, token, PLANS, planId)
    }
  })
})
