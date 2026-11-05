import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

for (const firstWriter of ['assignment', 'deletion'] as const) {
  test(`TC-PORTAL-011: ${firstWriter} wins a concurrent portal role deletion and assignment`, async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const role = await createCustomerRoleFixture(request, adminToken)
    let userId: string | null = null
    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id
      await withClient(async (locker) => {
        await locker.query('begin')
        const identity = await locker.query<{ pid: number }>('select pg_backend_pid() as pid')
        const lockerPid = identity.rows[0].pid
        await locker.query('select id from customer_roles where id = $1 for update', [role.id])
        const pending: Array<ReturnType<typeof apiRequest>> = []
        const assign = () => apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${user.id}`, {
          token: adminToken,
          data: { roleIds: [role.id] },
        })
        const remove = () => apiRequest(request, 'DELETE', `/api/customer_accounts/admin/roles/${role.id}`, {
          token: adminToken,
        })
        const waitForBlockedWriters = async (count: number) => {
          await expect.poll(async () => withClient(async (observer) => {
            const result = await observer.query<{ count: string }>(
              'select count(*)::text as count from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
              [lockerPid],
            )
            return Number(result.rows[0].count)
          }), { timeout: 15_000 }).toBeGreaterThanOrEqual(count)
        }
        try {
          pending.push(firstWriter === 'assignment' ? assign() : remove())
          await waitForBlockedWriters(1)
          pending.push(firstWriter === 'assignment' ? remove() : assign())
          await waitForBlockedWriters(2)
        } finally {
          await locker.query('commit')
          await Promise.allSettled(pending)
        }
        const responses = await Promise.all(pending)
        const assignmentResponse = responses[firstWriter === 'assignment' ? 0 : 1]
        const deletionResponse = responses[firstWriter === 'deletion' ? 0 : 1]
        expect(assignmentResponse.status()).toBe(firstWriter === 'assignment' ? 200 : 400)
        expect(deletionResponse.status()).toBe(firstWriter === 'deletion' ? 200 : 400)
        const result = await locker.query<{ deleted_at: string | null; holders: string }>(
          `select roles.deleted_at, count(links.id)::text as holders
           from customer_roles roles
           left join customer_user_roles links on links.role_id = roles.id and links.deleted_at is null
           where roles.id = $1 group by roles.id`,
          [role.id],
        )
        expect(result.rows[0].holders).toBe(firstWriter === 'assignment' ? '1' : '0')
        expect(result.rows[0].deleted_at === null).toBe(firstWriter === 'assignment')
      })
    } finally {
      if (userId) {
        await apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${userId}`, {
          token: adminToken,
          data: { roleIds: [] },
        })
      }
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, role.id)
    }
  })
}
