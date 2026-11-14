import { expect, type APIResponse } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

async function waitForBlockedStatement(blockerPid: number, statement: string, table: string): Promise<number> {
  let waitingPid = 0
  await expect.poll(async () => withClient(async (observer) => {
    const result = await observer.query<{ pid: number }>(
      `select activity.pid
       from pg_stat_activity activity
       where $1 = any(pg_blocking_pids(activity.pid))
         and lower(activity.query) like $2
       order by activity.query_start`,
      [blockerPid, `%${statement}%"${table}"%`],
    )
    waitingPid = result.rows[0]?.pid ?? 0
    return waitingPid
  }), { message: `Expected ${statement} on ${table} to reach the controlled database lock` }).toBeGreaterThan(0)
  return waitingPid
}

export async function runSignInRevocationRace(input: {
  userId: string
  first: 'deactivation' | 'session'
  signIn: () => Promise<APIResponse>
  deactivate: () => Promise<APIResponse>
}): Promise<{ deactivated: APIResponse; racedLogin: APIResponse }> {
  return withClient(async (blocker) => {
    const { rows } = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
    const blockerPid = rows[0].pid
    const pending: Promise<APIResponse>[] = []
    let committed = false
    await blocker.query('begin')
    try {
      if (input.first === 'deactivation') {
        const locked = await blocker.query('select id from sessions where user_id = $1 for update', [input.userId])
        expect(locked.rowCount).toBeGreaterThan(0)
      } else {
        await blocker.query('lock table sessions in share mode')
      }
      const firstRequest = input.first === 'deactivation' ? input.deactivate() : input.signIn()
      pending.push(firstRequest)
      void firstRequest.catch(() => undefined)
      const firstPid = await waitForBlockedStatement(blockerPid, input.first === 'deactivation' ? 'delete' : 'insert', 'sessions')
      const secondRequest = input.first === 'deactivation' ? input.signIn() : input.deactivate()
      pending.push(secondRequest)
      void secondRequest.catch(() => undefined)
      await waitForBlockedStatement(firstPid, input.first === 'deactivation' ? 'update' : 'select', 'users')
      await blocker.query('commit')
      committed = true
      const [firstResponse, secondResponse] = await Promise.all(pending)
      return input.first === 'deactivation'
        ? { deactivated: firstResponse, racedLogin: secondResponse }
        : { deactivated: secondResponse, racedLogin: firstResponse }
    } finally {
      if (!committed) await blocker.query('rollback')
      await Promise.allSettled(pending)
    }
  })
}
