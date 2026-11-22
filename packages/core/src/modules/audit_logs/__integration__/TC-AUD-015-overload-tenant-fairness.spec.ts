import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { accessPayload, waitForBlockedAuditQuery, withOverloadRuntime } from './helpers/overloadRuntime'

export const integrationMeta = { dependsOnModules: ['audit_logs'] }

test('TC-AUD-015: real persisted writes reserve tenant capacity, reject mixed batches atomically and recover', async () => {
  await withOverloadRuntime(async ({ orm, schema, service, flushAccessLog }) => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()
    const organizationId = randomUUID()
    const gateKey = randomInt(1, 2_147_483_647)
    const blocker = orm.em.fork()
    const pending: Array<Promise<unknown>> = []
    await blocker.begin()
    try {
      const [{ pid }] = await blocker.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
      await blocker.execute('select pg_advisory_xact_lock(?)', [gateKey])
      await orm.em.getConnection().execute(
        `create function "${schema}".hold_tenant_write() returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(${gateKey});
           return new;
         end $$`,
      )
      await orm.em.getConnection().execute(
        `create trigger hold_tenant_write before insert on "${schema}".access_logs
           for each row when (new.tenant_id = '${tenantA}'::uuid)
           execute function "${schema}".hold_tenant_write()`,
      )
      pending.push(service.log(accessPayload(tenantA, organizationId)), service.log(accessPayload(tenantA, organizationId)))
      await waitForBlockedAuditQuery(orm, pid, 'insert', 2)
      expect(await service.log(accessPayload(tenantA, organizationId))).toBeNull()
      const rejectedA = accessPayload(tenantA, organizationId)
      const rejectedB = accessPayload(tenantB, organizationId)
      expect(await service.logMany([rejectedA, rejectedB])).toBe(0)
      const otherWrites = await Promise.all([
        service.log(accessPayload(tenantB, organizationId)),
        service.log(accessPayload(tenantB, organizationId)),
      ])
      expect(otherWrites.every((record) => record !== null)).toBe(true)
      const beforeRelease = await service.list({ tenantId: tenantB, organizationId })
      expect(beforeRelease.items).toHaveLength(2)
      expect(beforeRelease.items.every((record) => record.tenantId === tenantB)).toBe(true)
      expect(beforeRelease.items.some((record) => record.resourceId === rejectedB.resourceId)).toBe(false)
      await blocker.rollback()
      await Promise.all(pending)
      await flushAccessLog()
      expect(await service.log(accessPayload(tenantA, organizationId))).not.toBeNull()
      const recovered = await service.list({ tenantId: tenantA, organizationId })
      expect(recovered.items).toHaveLength(3)
      expect(recovered.items.every((record) => record.tenantId === tenantA)).toBe(true)
      expect(recovered.items.some((record) => record.resourceId === rejectedA.resourceId)).toBe(false)
      const [{ count }] = await orm.em.getConnection().execute<Array<{ count: string }>>('select count(*)::text as count from access_logs')
      expect(Number(count)).toBe(5)
    } finally {
      if (blocker.isInTransaction()) await blocker.rollback()
      await Promise.allSettled(pending)
    }
  })
})
