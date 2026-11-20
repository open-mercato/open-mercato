import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  pollTickScheduleId,
  stableScheduleUuid,
} from '@open-mercato/core/modules/communication_channels/lib/automatic-sync'

/**
 * TC-CHANNEL-API-012 — GET /me/channels reports whether the caller's organization is polled.
 *
 * Regression for https://github.com/open-mercato/open-mercato/issues/8804: the profile
 * page reads `automaticSyncEnabled` to warn when no scheduled job polls the user's
 * mailboxes. Self-contained: a fresh organization gets its poll tick from
 * `onOrganizationCreated`, so a user homed there must see `true`; disabling that tick
 * through the scheduler API must flip the flag to `false`. Every fixture — the
 * organization, every schedule its onOrganizationCreated hooks registered (this module's
 * and other modules'), the role and the user — is removed afterwards.
 */
const SCHEDULER_JOBS_PATH = '/api/scheduler/jobs'

async function readAutomaticSyncEnabled(request: APIRequestContext, token: string): Promise<boolean | undefined> {
  const response = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
  expect(response.status(), 'GET /me/channels should return 200').toBe(200)
  const body = await readJsonSafe<{ automaticSyncEnabled?: boolean }>(response)
  return body?.automaticSyncEnabled
}

async function deleteScheduleIfExists(
  request: APIRequestContext,
  token: string | null,
  scheduleId: string | null,
): Promise<void> {
  if (!token || !scheduleId) return
  await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, { token, data: { id: scheduleId } }).catch(() => undefined)
}

async function deleteOrganizationSchedules(
  request: APIRequestContext,
  token: string | null,
  organizationId: string,
): Promise<void> {
  if (!token) return
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    `${SCHEDULER_JOBS_PATH}?scopeType=organization&pageSize=100`,
    { token, selectedOrgId: organizationId },
  ).catch(() => null)
  if (!response || !response.ok()) return
  const body = await readJsonSafe<{ items?: Array<{ id?: string; organizationId?: string | null }> }>(response)
  for (const item of body?.items ?? []) {
    if (item.id && item.organizationId === organizationId) {
      await deleteScheduleIfExists(request, token, item.id)
    }
  }
}

test.describe('TC-CHANNEL-API-012: me/channels reports automatic sync per organization', () => {
  test('reports the organization poll tick and flips when the tick is disabled', async ({ request }) => {
    // onOrganizationCreated runs in a persistent subscriber; on a cold app the events
    // worker starts lazily, so the new organization's tick can take a while to appear.
    test.setTimeout(180_000)
    const stamp = Date.now()
    let adminToken: string | null = null
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      organizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA Channel API 012 ${stamp}`,
        tenantId: scope.tenantId,
      })

      const roleName = `qa_channel_api_012_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['communication_channels.connect_user_channel'],
      })

      const userEmail = `qa-channel-api-012-${stamp}@acme.com`
      const userPassword = 'Valid1!Pass'
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId,
        roles: [roleName],
        name: 'QA Channel API 012 User',
      })
      const userToken = await getAuthToken(request, userEmail, userPassword)

      await expect
        .poll(() => readAutomaticSyncEnabled(request, userToken), {
          message: 'the new organization receives its poll tick from onOrganizationCreated',
          timeout: 120_000,
        })
        .toBe(true)

      const disable = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token: adminToken,
        data: { id: pollTickScheduleId(organizationId), isEnabled: false },
      })
      expect(disable.status(), 'disabling the poll tick should succeed').toBe(200)

      expect(
        await readAutomaticSyncEnabled(request, userToken),
        'a disabled poll tick no longer counts as automatic sync',
      ).toBe(false)
    } finally {
      if (organizationId) {
        await deleteOrganizationSchedules(request, adminToken, organizationId)
        await deleteScheduleIfExists(request, adminToken, pollTickScheduleId(organizationId))
        await deleteScheduleIfExists(
          request,
          adminToken,
          stableScheduleUuid(`communication_channels:gmail-renew-watch:${organizationId}`),
        )
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, organizationId)
    }
  })
})
