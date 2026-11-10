import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['staff', 'messages', 'planner', 'api_keys'] }

async function state(requestId: string, memberId: string, messageId: string) {
  return withClient(async (client) => {
    const leave = await client.query('select to_jsonb(r) as value from staff_leave_requests r where id = $1', [requestId])
    const rules = await client.query('select id from planner_availability_rules where subject_id = $1 order by id', [memberId])
    const message = await client.query('select action_taken, action_taken_at, action_taken_by_user_id, action_result from messages where id = $1', [messageId])
    return { leave: leave.rows, rules: rules.rows, message: message.rows }
  })
}

async function scenario(request: APIRequestContext, decision: 'accept' | 'reject', grant: string | null, foreignScope?: 'tenant' | 'organization', asApiKey = false, checkNativeVersion = false) {
  const adminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(await getAuthToken(request, 'admin'))
  const stamp = randomUUID()
  const memberId = randomUUID()
  const requestId = randomUUID()
  const password = `${randomUUID()}Aa1!`
  const roleName = `qa_staff_decision_${stamp}`
  let roleId: string | null = null
  let userId: string | null = null
  let messageId: string | null = null
  let keyId: string | null = null
  try {
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: ['messages.view', 'messages.compose', 'messages.actions', ...(grant ? [grant] : [])],
    })
    const email = `qa-staff-decision-${stamp}@example.com`
    userId = await createUserFixture(request, adminToken, {
      email, password, organizationId: scope.organizationId, roles: [roleName], name: 'Staff decision regression',
    })
    const token = await getAuthToken(request, email, password)
    await withClient(async (client) => {
      await client.query(
        'insert into staff_team_members (id, tenant_id, organization_id, display_name, user_id, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())',
        [memberId, scope.tenantId, scope.organizationId, 'Synthetic own leave member', userId],
      )
      await client.query(
        `insert into staff_leave_requests (id, tenant_id, organization_id, member_id, start_date, end_date, timezone, status, submitted_by_user_id, created_at, updated_at)
         values ($1, $2, $3, $4, '2030-01-10', '2030-01-10', 'UTC', 'pending', $5, now(), now())`,
        [requestId, foreignScope === 'tenant' ? randomUUID() : scope.tenantId,
          foreignScope === 'organization' ? randomUUID() : scope.organizationId, memberId, userId],
      )
    })
    const response = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        recipients: [{ userId, type: 'to' }], subject: `Staff leave decision ${stamp}`, body: 'Synthetic approval request',
        sendViaEmail: false, sourceEntityId: requestId,
        actionData: { actions: [
          { id: decision, label: 'Decide', commandId: `staff.leave-requests.${decision}`, isTerminal: true },
          { id: 'ack', label: 'Acknowledge', href: '/backend/messages', isTerminal: true },
        ] },
      },
    })
    expect(response.status()).toBe(201)
    const composed = await readJsonSafe<{ id: string }>(response)
    expect(composed?.id).toBeTruthy()
    messageId = composed!.id
    const before = await state(requestId, memberId, messageId)
    if (checkNativeVersion) {
      const endpoint = `/api/staff/leave-requests/${decision}`
      const stale = await apiRequest(request, 'POST', endpoint, {
        token, data: { id: requestId },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2000-01-01T00:00:00.000Z' },
      })
      expect(stale.status()).toBe(409)
      expect(await readJsonSafe<{ code?: string }>(stale)).toMatchObject({ code: 'optimistic_lock_conflict' })
      expect(await state(requestId, memberId, messageId)).toEqual(before)
      const currentVersion = z.object({ updated_at: z.string() }).parse(before.leave[0]?.value).updated_at
      const current = await apiRequest(request, 'POST', endpoint, {
        token, data: { id: requestId }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: currentVersion },
      })
      expect(current.status()).toBe(200)
      const after = await state(requestId, memberId, messageId)
      expect(after.leave[0]).toMatchObject({ value: { status: decision === 'accept' ? 'approved' : 'rejected' } })
      expect(after.rules).toHaveLength(decision === 'accept' ? 1 : 0)
      expect(after.message).toEqual(before.message)
      return
    }
    if (!grant) {
      const native = await apiRequest(request, 'POST', `/api/staff/leave-requests/${decision}`, { token, data: { id: requestId } })
      expect(native.status()).toBe(403)
    }
    let keySecret: string | undefined
    if (asApiKey) {
      const createdKey = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken, data: { name: `Staff decision key ${stamp}`, organizationId: scope.organizationId, roles: [roleId] },
      })
      expect(createdKey.status()).toBe(201)
      const key = await readJsonSafe<{ id: string; secret: string }>(createdKey)
      keyId = key!.id
      keySecret = key!.secret
      expect(keySecret).toBeTruthy()
    }
    const decide = () => asApiKey
      ? withCredentialIsolatedRequest((isolated) => isolated.post(`/api/staff/leave-requests/${decision}`, {
        headers: { 'x-api-key': keySecret! }, data: { id: requestId },
      }))
      : apiRequest(request, 'POST', `/api/messages/${messageId}/actions/${decision}`, { token, data: { id: requestId } })
    const result = await decide()
    if (!grant || foreignScope) {
      expect(result.status()).toBe(foreignScope ? 404 : 403)
      expect(await state(requestId, memberId, messageId)).toEqual(before)
      const retry = await decide()
      expect(retry.status()).toBe(result.status())
      expect(await state(requestId, memberId, messageId)).toEqual(before)
      const ordinary = await apiRequest(request, 'POST', `/api/messages/${messageId}/actions/ack`, { token, data: {} })
      expect(ordinary.status()).toBe(200)
    } else {
      expect(result.status()).toBe(200)
      const after = await state(requestId, memberId, messageId)
      expect(after.leave[0]).toMatchObject({ value: { status: decision === 'accept' ? 'approved' : 'rejected' } })
      expect(after.rules).toHaveLength(decision === 'accept' ? 1 : 0)
      expect(after.message[0]).toMatchObject(asApiKey
        ? { action_taken: null, action_taken_by_user_id: null }
        : { action_taken: decision, action_taken_by_user_id: userId })
    }
  } finally {
    if (keyId) await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${keyId}`, { token: adminToken })
    await withClient(async (client) => {
      if (messageId) await client.query('delete from messages where id = $1', [messageId])
      await client.query('delete from planner_availability_rules where subject_id = $1', [memberId])
      await client.query('delete from staff_leave_requests where id = $1', [requestId])
      await client.query('delete from staff_team_members where id = $1', [memberId])
    })
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
}

test.describe('TC-API-STAFF-8884: message leave decisions enforce staff authorization', () => {
  for (const decision of ['accept', 'reject'] as const) {
    test(`${decision}: native decisions reject a stale version and accept the current one`, async ({ request }) => {
      await scenario(request, decision, 'staff.leave_requests.manage', undefined, false, true)
    })
    for (const grant of [null, 'staff.leave_requests.manage', 'staff.*', '*']) {
      test(`${decision}: ${grant ?? 'ordinary recipient'} retains native permissions`, async ({ request }) => {
        await scenario(request, decision, grant)
      })
    }
    for (const grant of [null, 'staff.leave_requests.manage']) {
      test(`${decision}: API key ${grant ?? 'without decision permission'} uses its own ACL`, async ({ request }) => {
        await scenario(request, decision, grant, undefined, true)
      })
    }
    for (const foreignScope of ['tenant', 'organization'] as const) {
      test(`${decision}: wildcard manager cannot decide across ${foreignScope} scope`, async ({ request }) => {
        await scenario(request, decision, 'staff.*', foreignScope)
      })
    }
  }
})
