import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { accessPayload, waitForBlockedAuditQuery, withOverloadRuntime } from './helpers/overloadRuntime'

export const integrationMeta = { dependsOnModules: ['audit_logs'] }

test('TC-AUD-016: blocked real retention does not delay another tenant and flush waits for release', async () => {
  await withOverloadRuntime(async ({ orm, service, flushAccessLog }) => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()
    const organizationId = randomUUID()
    const expiredId = randomUUID()
    await orm.em.getConnection().execute(
      `insert into access_logs (id, tenant_id, organization_id, resource_kind, resource_id, access_type, created_at)
       values (?, ?, ?, 'audit_overload.fixture', ?, 'read', now() - interval '100 years')`,
      [expiredId, tenantA, organizationId, randomUUID()],
    )
    const blocker = orm.em.fork()
    const pending: Array<Promise<unknown>> = []
    await blocker.begin()
    try {
      const [{ pid }] = await blocker.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
      await blocker.execute('select id from access_logs where id = ? for update', [expiredId])
      const first = service.log(accessPayload(tenantA, organizationId))
      pending.push(first)
      await waitForBlockedAuditQuery(orm, pid, 'delete')
      expect(await service.log(accessPayload(tenantB, organizationId))).not.toBeNull()
      let flushed = false
      const flushing = flushAccessLog().then(() => { flushed = true })
      pending.push(flushing)
      await Promise.resolve()
      expect(flushed).toBe(false)
      const blockedRows = await orm.em.getConnection().execute<Array<{ id: string }>>('select id from access_logs where id = ?', [expiredId])
      expect(blockedRows).toHaveLength(1)
      await blocker.rollback()
      await Promise.all(pending)
      expect(flushed).toBe(true)
      const remaining = await orm.em.getConnection().execute<Array<{ id: string }>>('select id from access_logs where id = ?', [expiredId])
      expect(remaining).toEqual([])
      expect((await service.list({ tenantId: tenantA, organizationId })).items).toHaveLength(1)
      expect((await service.list({ tenantId: tenantB, organizationId })).items).toHaveLength(1)
    } finally {
      if (blocker.isInTransaction()) await blocker.rollback()
      await Promise.allSettled(pending)
    }
  })
})
