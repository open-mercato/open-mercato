import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteEntityByPathIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type RuleItem = { id?: string }

const INVALID_WINDOW_MESSAGE = 'Window times must be between 00:00 and 23:59, with the end after the start.'

async function listRuleSetRules(request: APIRequestContext, token: string, ruleSetId: string): Promise<RuleItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}&pageSize=100&probe=${Date.now()}`,
    { token },
  )
  expect(response.status(), 'GET /api/planner/availability should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: RuleItem[] }>(response)
  return body?.items ?? []
}

test.describe('TC-PLAN-007: availability replace rejects a window whose end is not after its start', () => {
  test('availability controls respect viewer and wildcard manager grants', async ({ request, browser }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)
    const roles: string[] = []
    const users: string[] = []
    const scheduleName = `QA viewer schedule ${Date.now()}`
    let ruleSetId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/planner/availability-rule-sets', {
        token,
        data: { name: scheduleName, timezone: 'UTC' },
      })
      expect(created.status()).toBe(201)
      ruleSetId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'Rule set id')
      for (const features of [['planner.view'], ['planner.*']]) {
        const roleId = await createRoleFixture(request, token, { name: `QA planner role ${Date.now()}` })
        roles.push(roleId)
        const acl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token,
          data: { roleId, features, organizations: [organizationId] },
        })
        expect(acl.status()).toBe(200)
        const email = `qa-planner-viewer-${Date.now()}@example.com`
        const password = 'QA-Planner-Viewer-2026!'
        users.push(await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] }))
        const context = await browser.newContext({ baseURL: process.env.BASE_URL })
        try {
          const login = await context.request.post(`${process.env.BASE_URL}/api/auth/login`, { form: { email, password } })
          expect(login.status()).toBe(200)
          const page = await context.newPage()
          const permissionCheck = page.waitForResponse((response) => (
            response.url().includes('/api/auth/feature-check')
            && response.request().postData()?.includes('planner.manage_availability') === true
          ))
          await page.goto(`/backend/planner/availability-rulesets/${ruleSetId}`)
          await permissionCheck
          const nameInput = page.getByRole('main').getByRole('textbox').first()
          await expect(nameInput).toHaveValue(scheduleName)
          await expect(nameInput).toBeFocused()
          const tab = page.getByRole('tab', { name: 'Availability', exact: true })
          await expect(tab).toBeVisible()
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          const addHours = page.getByRole('button', { name: 'Add hours', exact: true })
          const isViewer = features[0] === 'planner.view'
          if (isViewer) {
            await expect(addHours).toBeDisabled()
            const actorToken = (await readJsonSafe<{ token: string }>(login))?.token ?? ''
            expect(actorToken).toBeTruthy()
            const denied = await apiRequest(request, 'POST', '/api/planner/availability-weekly', {
              token: actorToken,
              data: { subjectType: 'ruleset', subjectId: ruleSetId, timezone: 'UTC', windows: [] },
            })
            expect(denied.status()).toBe(403)
          } else {
            await expect(addHours).toBeEnabled()
          }
        } finally {
          await context.close()
        }
      }
    } finally {
      if (ruleSetId) await deleteEntityByPathIfExists(request, token, `/api/planner/availability-rule-sets?id=${ruleSetId}`)
      for (const userId of users.reverse()) await deleteUserIfExists(request, token, userId)
      for (const roleId of roles.reverse()) await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('weekly and date-specific replace return 400 and keep the existing hours', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    let ruleSetId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/planner/availability-rule-sets', {
        token,
        data: { name: `QA inverted window ${Date.now()}`, timezone: 'UTC' },
      })
      expect(createResponse.status(), 'POST /api/planner/availability-rule-sets should return 201').toBe(201)
      ruleSetId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'Rule set id')

      const weeklyBase = { subjectType: 'ruleset', subjectId: ruleSetId, timezone: 'UTC' }
      const weeklyOk = await apiRequest(request, 'POST', '/api/planner/availability-weekly', {
        token,
        data: { ...weeklyBase, windows: [{ weekday: 1, start: '09:00', end: '10:00' }] },
      })
      expect(weeklyOk.status(), 'Valid weekly replace should return 200').toBe(200)

      const dateOk = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
        token,
        data: { ...weeklyBase, dates: [date], kind: 'availability', windows: [{ start: '08:00', end: '12:00' }] },
      })
      expect(dateOk.status(), 'Valid date-specific replace should return 200').toBe(200)

      const before = await listRuleSetRules(request, token, ruleSetId)
      expect(before, 'One weekly and one date-specific rule should exist').toHaveLength(2)

      for (const window of [{ start: '09:00', end: '09:00' }, { start: '17:00', end: '09:00' }, { start: '08:00', end: '24:00' }]) {
        const weeklyBad = await apiRequest(request, 'POST', '/api/planner/availability-weekly', {
          token,
          data: { ...weeklyBase, windows: [{ weekday: 1, ...window }] },
        })
        expect(weeklyBad.status(), `Weekly ${window.start}-${window.end} should return 400`).toBe(400)
        expect((await readJsonSafe<{ error?: string }>(weeklyBad))?.error).toBe(INVALID_WINDOW_MESSAGE)

        const dateBad = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
          token,
          data: { ...weeklyBase, dates: [date], kind: 'availability', windows: [window] },
        })
        expect(dateBad.status(), `Date-specific ${window.start}-${window.end} should return 400`).toBe(400)
        expect((await readJsonSafe<{ error?: string }>(dateBad))?.error).toBe(INVALID_WINDOW_MESSAGE)
      }

      const after = await listRuleSetRules(request, token, ruleSetId)
      expect(after.map((rule) => rule.id).sort(), 'Rejected requests must not delete existing rules').toEqual(
        before.map((rule) => rule.id).sort(),
      )

      const dayOff = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
        token,
        data: { ...weeklyBase, dates: [date], kind: 'unavailability', windows: [{ start: '17:00', end: '09:00' }] },
      })
      expect(dayOff.status(), 'Unavailability ignores its windows and should still return 200').toBe(200)
    } finally {
      if (ruleSetId) {
        const leftovers = await listRuleSetRules(request, token, ruleSetId).catch(() => [] as RuleItem[])
        for (const rule of leftovers) {
          if (rule.id) await deleteEntityByPathIfExists(request, token, `/api/planner/availability?id=${encodeURIComponent(rule.id)}`)
        }
        await deleteEntityByPathIfExists(request, token, `/api/planner/availability-rule-sets?id=${encodeURIComponent(ruleSetId)}`)
      }
    }
  })
})
