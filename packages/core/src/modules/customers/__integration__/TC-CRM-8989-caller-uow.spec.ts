import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-CRM-8989: flushing one caller does not flush another caller dirty entity', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const scope = getTokenContext(token)
  let personId: string | null = null
  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'Caller', lastName: 'Isolation', displayName: `tc8989-${randomUUID()}`,
    })
    const [{ bootstrapFromAppRoot }, { createRequestContainer, getProcessContainerStats, isProcessContainerRootEnabled }, { runInRequestScope }, { CustomerEntity }] = await Promise.all([
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/container')>('@open-mercato/shared/lib/di/container'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/request-scope')>('@open-mercato/shared/lib/di/request-scope'),
      importFromAppRuntime<typeof import('@open-mercato/core/modules/customers/data/entities')>('@open-mercato/core/modules/customers/data/entities'),
    ])
    await bootstrapFromAppRoot(resolveAppRoot())
    await runInRequestScope(async () => {
      const before = getProcessContainerStats()
      const first = await createRequestContainer()
      const second = await createRequestContainer()
      const firstEm = first.resolve<EntityManager>('em')
      const secondEm = second.resolve<EntityManager>('em')
      try {
        const after = getProcessContainerStats()
        if (isProcessContainerRootEnabled()) {
          expect(after.compatibilityReason).toBeNull()
          expect(after.callerScopes - before.callerScopes).toBe(2)
          expect(after.legacyContainers).toBe(before.legacyContainers)
          expect(after.rootInitializations - before.rootInitializations).toBeLessThanOrEqual(1)
        } else {
          expect(after.legacyContainers - before.legacyContainers).toBe(2)
        }
        expect(firstEm).not.toBe(secondEm)
        const where = { id: personId!, tenantId: scope.tenantId, organizationId: scope.organizationId }
        const firstPerson = await firstEm.findOneOrFail(CustomerEntity, where)
        const secondPerson = await secondEm.findOneOrFail(CustomerEntity, where)
        expect(firstPerson).not.toBe(secondPerson)
        firstPerson.isActive = false
        secondPerson.temperature = 'hot'
        await secondEm.flush()
        const readStored = () => withClient(async (client) => {
          const result = await client.query<{ is_active: boolean; temperature: string }>(
            'select is_active, temperature from customer_entities where id = $1 and tenant_id = $2 and organization_id = $3',
            [personId, scope.tenantId, scope.organizationId],
          )
          return result.rows[0]
        })
        expect(await readStored()).toEqual({ is_active: true, temperature: 'hot' })
        await firstEm.flush()
        expect(await readStored()).toEqual({ is_active: false, temperature: 'hot' })
      } finally {
        firstEm.clear()
        secondEm.clear()
        await first.dispose()
        await second.dispose()
      }
    })
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
