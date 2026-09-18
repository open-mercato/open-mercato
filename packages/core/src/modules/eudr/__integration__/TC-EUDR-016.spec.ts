import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
  setUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'notifications'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const RISK_PATH = '/api/eudr/risk-assessments'
const MITIGATION_PATH = '/api/eudr/mitigation-actions'
const POLL_TIMEOUT_MS = 20_000
const COUNT_INCREASE_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 1_000
const STABLE_COUNT_DURATION_MS = 4_000
const TEST_PASSWORD = 'Valid1!Pass'

type NotificationItem = {
  type?: string
  title?: string | null
  body?: string | null
  linkHref?: string | null
  bodyVariables?: Record<string, string> | null
}

async function createJson(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `create at ${path} failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `create response at ${path} should include id`)
}

async function putJson(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', path, { token, data })
  expect(response.status(), `update at ${path} failed: ${response.status()}`).toBe(200)
}

async function pollForNotification(
  request: APIRequestContext,
  token: string,
  type: string,
  matcher: (item: NotificationItem) => boolean,
): Promise<NotificationItem | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { items } = await listNotifications(request, token, { type, pageSize: 50 })
    const match = (items as NotificationItem[]).find(matcher)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return null
}

async function expectNoNotification(
  request: APIRequestContext,
  token: string,
  type: string,
  matcher: (item: NotificationItem) => boolean,
): Promise<void> {
  await expectMatchingNotificationCountToStay(
    request,
    token,
    type,
    matcher,
    0,
    'org-restricted user must not receive the notification',
  )
}

async function countMatchingNotifications(
  request: APIRequestContext,
  token: string,
  type: string,
  matcher: (item: NotificationItem) => boolean,
): Promise<number> {
  const { items } = await listNotifications(request, token, { type, pageSize: 50 })
  return (items as NotificationItem[]).filter(matcher).length
}

async function pollForMatchingNotificationCountIncrease(
  request: APIRequestContext,
  token: string,
  type: string,
  matcher: (item: NotificationItem) => boolean,
  previousCount: number,
): Promise<number> {
  const deadline = Date.now() + COUNT_INCREASE_TIMEOUT_MS
  let count = await countMatchingNotifications(request, token, type, matcher)

  while (count <= previousCount && Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remainingMs)))
    count = await countMatchingNotifications(request, token, type, matcher)
  }

  return count
}

async function expectMatchingNotificationCountToStay(
  request: APIRequestContext,
  token: string,
  type: string,
  matcher: (item: NotificationItem) => boolean,
  expectedCount: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + STABLE_COUNT_DURATION_MS

  while (true) {
    const count = await countMatchingNotifications(request, token, type, matcher)
    expect(count, message).toBe(expectedCount)

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remainingMs)))
  }
}

/**
 * TC-EUDR-016: lifecycle notifications with org-restricted fan-out.
 *
 * Exercises every emission path via API as an admin (statement submit /
 * reference issue / withdraw through the SME-trader gate path; risk concluded
 * on create-as-non-negligible and on a negligible→non_negligible update flip
 * with a no-change update producing nothing new; mitigation completed on both
 * the update transition and create-as-completed), polling the notifications
 * list API for each. A same-tenant user whose ACL is organization-restricted
 * to a different organization receives nothing.
 */
test.describe('TC-EUDR-016: lifecycle notifications', () => {
  test('notifies every lifecycle path exactly once, org-restricted users excluded', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const tenantId = expectId(scope.tenantId || null, 'admin token should carry a tenant id')
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const title = `TC-EUDR-016 ${stamp}`
    const refNumber = `TC16REF${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`.toUpperCase()
    const restrictedEmail = `tc-eudr-016-${stamp}@example.com`

    let statementId: string | null = null
    let riskId: string | null = null
    let flipRiskId: string | null = null
    let mitigationAId: string | null = null
    let mitigationBId: string | null = null
    let otherOrgId: string | null = null
    let restrictedUserId: string | null = null

    try {
      statementId = await createJson(request, token, STATEMENTS_PATH, {
        title,
        commodity: 'coffee',
        actorRole: 'sme_trader',
        referencedStatements: [{ referenceNumber: `UP${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`.toUpperCase() }],
      })

      otherOrgId = await createOrganizationInDb({ name: `TC-EUDR-016 Other Org ${stamp}`, tenantId })
      restrictedUserId = await createUserFixture(request, token, {
        email: restrictedEmail,
        password: TEST_PASSWORD,
        organizationId: otherOrgId,
        roles: ['admin'],
      })
      await setUserAclInDb({
        userId: restrictedUserId,
        tenantId,
        features: ['eudr.statements.manage', 'eudr.risk.manage', 'notifications.view'],
        organizations: [otherOrgId],
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, TEST_PASSWORD)

      await putJson(request, token, STATEMENTS_PATH, { id: statementId, status: 'submitted' })
      const submittedNotification = await pollForNotification(
        request,
        token,
        'eudr.statement.submitted',
        (item) => (item.linkHref ?? '').includes(statementId ?? ''),
      )
      expect(submittedNotification, 'submitted notification should arrive').toBeTruthy()
      expect(submittedNotification?.linkHref ?? '').toContain(`/backend/eudr/statements/${statementId}`)

      await putJson(request, token, STATEMENTS_PATH, {
        id: statementId,
        status: 'available',
        referenceNumber: refNumber,
        verificationNumber: 'ABCD1234',
      })
      const referenceNotification = await pollForNotification(
        request,
        token,
        'eudr.statement.reference_issued',
        (item) => (item.linkHref ?? '').includes(statementId ?? '') && item.bodyVariables?.referenceNumber === refNumber,
      )
      expect(referenceNotification, 'reference-issued notification should carry the reference number').toBeTruthy()

      await putJson(request, token, STATEMENTS_PATH, { id: statementId, status: 'withdrawn' })
      const withdrawnNotification = await pollForNotification(
        request,
        token,
        'eudr.statement.withdrawn',
        (item) => (item.linkHref ?? '').includes(statementId ?? ''),
      )
      expect(withdrawnNotification, 'withdrawn notification should arrive').toBeTruthy()

      riskId = await createJson(request, token, RISK_PATH, {
        statementId,
        criteria: {},
        conclusion: 'non_negligible',
      })
      const concludedOnCreate = await pollForNotification(
        request,
        token,
        'eudr.risk.non_negligible',
        (item) => (item.linkHref ?? '').includes(statementId ?? ''),
      )
      expect(concludedOnCreate, 'create-as-non-negligible should notify').toBeTruthy()

      flipRiskId = await createJson(request, token, RISK_PATH, {
        statementId,
        criteria: {},
        conclusion: 'negligible',
      })
      const riskNotificationMatcher = (item: NotificationItem) => (item.linkHref ?? '').includes(statementId ?? '')
      const preFlipCount = await countMatchingNotifications(
        request,
        token,
        'eudr.risk.non_negligible',
        riskNotificationMatcher,
      )
      await putJson(request, token, RISK_PATH, { id: flipRiskId, conclusion: 'non_negligible' })
      const postFlipCount = await pollForMatchingNotificationCountIncrease(
        request,
        token,
        'eudr.risk.non_negligible',
        riskNotificationMatcher,
        preFlipCount,
      )
      expect(
        postFlipCount,
        'the negligible→non_negligible flip should increase the matching notification count',
      ).toBeGreaterThan(preFlipCount)

      await putJson(request, token, RISK_PATH, { id: flipRiskId, notes: 'no conclusion change' })
      await expectMatchingNotificationCountToStay(
        request,
        token,
        'eudr.risk.non_negligible',
        riskNotificationMatcher,
        postFlipCount,
        'a no-change update must not add a notification',
      )

      mitigationAId = await createJson(request, token, MITIGATION_PATH, {
        riskAssessmentId: riskId,
        title: `TC-EUDR-016 Action A ${stamp}`,
        status: 'planned',
      })
      await putJson(request, token, MITIGATION_PATH, { id: mitigationAId, status: 'completed' })
      const completedOnUpdate = await pollForNotification(
        request,
        token,
        'eudr.mitigation.completed',
        (item) => (item.linkHref ?? '').includes(riskId ?? '') && (item.bodyVariables?.actionTitle ?? '').includes(`Action A ${stamp}`),
      )
      expect(completedOnUpdate, 'update-to-completed should notify').toBeTruthy()

      mitigationBId = await createJson(request, token, MITIGATION_PATH, {
        riskAssessmentId: riskId,
        title: `TC-EUDR-016 Action B ${stamp}`,
        status: 'completed',
      })
      const completedOnCreate = await pollForNotification(
        request,
        token,
        'eudr.mitigation.completed',
        (item) => (item.linkHref ?? '').includes(riskId ?? '') && (item.bodyVariables?.actionTitle ?? '').includes(`Action B ${stamp}`),
      )
      expect(completedOnCreate, 'create-as-completed should notify').toBeTruthy()

      await expectNoNotification(
        request,
        restrictedToken,
        'eudr.statement.submitted',
        (item) => (item.linkHref ?? '').includes(statementId ?? ''),
      )
    } finally {
      if (mitigationBId) await apiRequest(request, 'DELETE', `${MITIGATION_PATH}?id=${encodeURIComponent(mitigationBId)}`, { token }).catch(() => undefined)
      if (mitigationAId) await apiRequest(request, 'DELETE', `${MITIGATION_PATH}?id=${encodeURIComponent(mitigationAId)}`, { token }).catch(() => undefined)
      if (flipRiskId) await apiRequest(request, 'DELETE', `${RISK_PATH}?id=${encodeURIComponent(flipRiskId)}`, { token }).catch(() => undefined)
      if (riskId) await apiRequest(request, 'DELETE', `${RISK_PATH}?id=${encodeURIComponent(riskId)}`, { token }).catch(() => undefined)
      if (statementId) await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(statementId)}`, { token }).catch(() => undefined)
      await deleteUserIfExists(request, token, restrictedUserId)
      if (restrictedUserId) await deleteUserAclInDb(restrictedUserId)
      await deleteOrganizationInDb(otherOrgId)
    }
  })
})
