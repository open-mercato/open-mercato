/** @jest-environment node */

import 'reflect-metadata'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerInteraction, CustomerTodoLink } from '../../data/entities'
import { countCustomerTodos } from '../todoCompatibility'

jest.mock('../interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(),
  loadCustomerSummaries: jest.fn(),
}))

const scope = {
  entityId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
}
const entityScope = {
  entity: scope.entityId,
  tenantId: scope.tenantId,
  organizationId: scope.organizationId,
}
const adapterScope = { ...entityScope, interactionType: 'task', source: 'adapter:todo' }

describe('countCustomerTodos', () => {
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [CustomerEntity, CustomerInteraction, CustomerTodoLink],
      metadataProvider: ReflectMetadataProvider,
      dbName: 'customer-todo-count-query-test',
      connect: false,
      allowGlobalContext: true,
    })
  })

  afterAll(async () => {
    await orm?.close(true)
  })

  it.each([
    { scenario: 'two adapter-created tasks without legacy links (#6068)', legacyTotal: 0, adapterTotal: 2, expected: 2 },
    { scenario: 'legacy links without adapter tasks', legacyTotal: 5, adapterTotal: 0, expected: 5 },
    { scenario: 'active bridges counted once and deleted bridges suppressed', legacyTotal: 1, adapterTotal: 1, expected: 2 },
    { scenario: 'deleted adapter tasks without resurrecting legacy links', legacyTotal: 0, adapterTotal: 0, expected: 0 },
    { scenario: 'adapter totals beyond the overview preview limit', legacyTotal: 2, adapterTotal: 125, expected: 127 },
  ])('counts $scenario using database aggregates', async ({ legacyTotal, adapterTotal, expected }) => {
    const em = orm.em.fork()
    const count = jest.spyOn(em, 'count').mockImplementation(async (entityName) => {
      return entityName === CustomerTodoLink ? legacyTotal : adapterTotal
    })
    const find = jest.spyOn(em, 'find')
    const createQueryBuilder = jest.spyOn(em, 'createQueryBuilder')

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(expected)

    const adapterIds = createQueryBuilder.mock.results[0].value
    expect(createQueryBuilder).toHaveBeenCalledWith(CustomerInteraction)
    expect(adapterIds.getParams()).toEqual([
      scope.entityId, scope.tenantId, scope.organizationId, 'task', 'adapter:todo',
    ])
    expect(adapterIds.getQuery()).not.toContain('deleted_at')
    expect(count).toHaveBeenCalledWith(CustomerTodoLink, {
      ...entityScope,
      todoId: { $nin: adapterIds },
    })
    expect(count).toHaveBeenCalledWith(CustomerInteraction, { ...adapterScope, deletedAt: null })
    expect(count).toHaveBeenCalledTimes(2)
    expect(find).not.toHaveBeenCalled()
  })

  it('compiles a scoped SQL exclusion subquery without materializing historical task IDs', async () => {
    const em = orm.em.fork()
    const execute = jest.spyOn(em.getConnection(), 'execute').mockResolvedValue({ count: 0 })

    try {
      await expect(countCustomerTodos(em, scope, false)).resolves.toBe(0)

      expect(execute).toHaveBeenCalledTimes(2)
      const legacyQuery = execute.mock.calls.find(([query]) => typeof query === 'string' && query.includes('customer_todo_links'))
      const adapterQuery = execute.mock.calls.find(([query]) => typeof query === 'string' && !query.includes('customer_todo_links'))
      expect(legacyQuery?.[0]).toBe(
        'select count(*) as "count" from "customer_todo_links" as "c0" where "c0"."entity_id" = ? and "c0"."tenant_id" = ? and "c0"."organization_id" = ? and "c0"."todo_id" not in (select "c0"."id" from "customer_interactions" as "c0" where "c0"."entity_id" = ? and "c0"."tenant_id" = ? and "c0"."organization_id" = ? and "c0"."interaction_type" = ? and "c0"."source" = ?)',
      )
      expect(legacyQuery?.[1]).toEqual([
        scope.entityId, scope.tenantId, scope.organizationId,
        scope.entityId, scope.tenantId, scope.organizationId, 'task', 'adapter:todo',
      ])
      expect(adapterQuery?.[0]).toBe(
        'select count(*) as "count" from "customer_interactions" as "c0" where "c0"."entity_id" = ? and "c0"."tenant_id" = ? and "c0"."organization_id" = ? and "c0"."interaction_type" = ? and "c0"."source" = ? and "c0"."deleted_at" is null',
      )
      expect(adapterQuery?.[1]).toEqual([
        scope.entityId, scope.tenantId, scope.organizationId, 'task', 'adapter:todo',
      ])
    } finally {
      execute.mockRestore()
    }
  })

  it('counts all active canonical task sources with explicit scope in unified mode', async () => {
    const em = orm.em.fork()
    const count = jest.spyOn(em, 'count').mockResolvedValue(205)
    const createQueryBuilder = jest.spyOn(em, 'createQueryBuilder')

    await expect(countCustomerTodos(em, scope, true)).resolves.toBe(205)

    expect(count).toHaveBeenCalledWith(CustomerInteraction, {
      ...entityScope,
      interactionType: 'task',
      deletedAt: null,
    })
    expect(count).toHaveBeenCalledTimes(1)
    expect(createQueryBuilder).not.toHaveBeenCalled()
  })
})
