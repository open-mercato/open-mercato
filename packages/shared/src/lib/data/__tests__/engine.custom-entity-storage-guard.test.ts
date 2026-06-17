import { DefaultDataEngine, assertCustomEntityStorageEntityId } from '../engine'
import { isCrudHttpError } from '../../crud/errors'
import { registerEntityIds } from '../../encryption/entityIds'

function buildEm(classTables: Record<string, string>): any {
  return {
    getKysely: () => {
      throw new Error('[internal] storage must not be touched for rejected entity ids')
    },
    getMetadata: () => ({
      find: (className: string) => (classTables[className] ? { tableName: classTables[className] } : undefined),
      getAll: () => Object.values(classTables).map((tableName) => ({ tableName })),
    }),
  }
}

function expectSystemEntityRejection(err: unknown) {
  expect(isCrudHttpError(err)).toBe(true)
  const httpError = err as { status: number; body: { code?: string } }
  expect(httpError.status).toBe(400)
  expect(httpError.body.code).toBe('system_entity_records_blocked')
}

describe('custom-entity storage guard (#2939 hardening)', () => {
  beforeEach(() => {
    registerEntityIds({
      customers: { customer_deal: 'customers:customer_deal' },
      example: { todo: 'example:todo', calendar_entity: 'example:calendar_entity' },
    })
  })

  afterEach(() => {
    registerEntityIds({})
  })

  test('assertCustomEntityStorageEntityId rejects module-declared ids backed by a registered ORM table', () => {
    const em = buildEm({ CustomerDeal: 'customer_deals' })
    try {
      assertCustomEntityStorageEntityId(em, 'customers:customer_deal')
      throw new Error('[internal] expected the guard to throw')
    } catch (err) {
      expectSystemEntityRejection(err)
    }
  })

  test('assertCustomEntityStorageEntityId allows module-declared ids without a registered ORM table', () => {
    const em = buildEm({})
    expect(() => assertCustomEntityStorageEntityId(em, 'example:calendar_entity')).not.toThrow()
  })

  test('a runtime entity whose name collides with an ORM class name is NOT classified as system', () => {
    const em = buildEm({ Todo: 'todos' })
    expect(() => assertCustomEntityStorageEntityId(em, 'user:todo')).not.toThrow()
  })

  test('falls back to the ORM-table check when the entity-id registry is not populated', () => {
    registerEntityIds({})
    const em = buildEm({ CustomerDeal: 'customer_deals' })
    try {
      assertCustomEntityStorageEntityId(em, 'customers:customer_deal')
      throw new Error('[internal] expected the guard to throw')
    } catch (err) {
      expectSystemEntityRejection(err)
    }
  })

  test.each([
    ['createCustomEntityRecord', (engine: DefaultDataEngine) => engine.createCustomEntityRecord({ entityId: 'customers:customer_deal', values: {} })],
    ['updateCustomEntityRecord', (engine: DefaultDataEngine) => engine.updateCustomEntityRecord({ entityId: 'customers:customer_deal', recordId: '11111111-1111-4111-8111-111111111111', values: {} })],
    ['deleteCustomEntityRecord', (engine: DefaultDataEngine) => engine.deleteCustomEntityRecord({ entityId: 'customers:customer_deal', recordId: '11111111-1111-4111-8111-111111111111' })],
  ])('%s rejects a table-backed system entity id before touching storage', async (_name, run) => {
    const engine = new DefaultDataEngine(buildEm({ CustomerDeal: 'customer_deals' }) as any, {} as any)
    await expect(run(engine)).rejects.toMatchObject({
      status: 400,
      body: { code: 'system_entity_records_blocked' },
    })
  })
})
