import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import {
  beginTransactionLifetime,
  completeTransactionLifetime,
  onTransactionLifetimeComplete,
} from '../../commands/transaction-lifetime'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
  encryptCustomEntityRecordDocument: jest.fn(async (_em: unknown, opts: { doc: unknown }) => opts.doc),
}))

jest.mock('@open-mercato/core/modules/entities/lib/validation', () => ({
  validateCustomFieldValuesServer: jest.fn(async () => ({ ok: true, fieldErrors: {} })),
}))

jest.mock('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer', () => ({
  sanitizeCustomFieldHtmlRichTextValuesServer: jest.fn(async (_em: unknown, opts: { values: unknown }) => opts.values),
}))

const { DefaultDataEngine, __resetUndeclaredEventWarningsForTests } = require('../engine')

const loggerWarn = createLogger('shared').warn as jest.Mock

type EmittedEvent = { name: string; payload: unknown; options?: unknown }

function makeFixture() {
  const emitted: EmittedEvent[] = []
  const bus = {
    emitEvent: jest.fn(async (name: string, payload: unknown, options?: unknown) => {
      emitted.push({ name, payload, options })
    }),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'eventBus') return bus
      throw new Error(`[internal] ${name} not registered`)
    },
  } as unknown as AwilixContainer
  const engine = new DefaultDataEngine({} as unknown as EntityManager, container)
  return { engine, container, emitted }
}

describe('DataEngine.setCustomFields change signal', () => {
  beforeEach(() => {
    __resetUndeclaredEventWarningsForTests()
    loggerWarn.mockClear()
  })

  it.each([
    'catalog:catalog_product',
    'catalog:catalog_product_variant',
    'customers:customer_deal',
    'customers:customer_activity',
    'user:runtime_custom_entity',
  ])('emits the entity-keyed signal for %s without an undeclared-event warning', async (entityId) => {
    const { engine, emitted } = makeFixture()
    const [mod, ent] = entityId.split(':')

    await engine.setCustomFields({
      entityId,
      recordId: 'rec-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { priority: 3 },
    })

    expect(emitted).toEqual([
      {
        name: `${mod}.${ent}.updated`,
        payload: { id: 'rec-1', organizationId: 'org-1', tenantId: 'tenant-1' },
        options: { persistent: true, tenantId: 'tenant-1', organizationId: 'org-1', emitterModuleId: mod },
      },
    ])
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('emits nothing when notify is false', async () => {
    const { engine, emitted } = makeFixture()

    await engine.setCustomFields({
      entityId: 'catalog:catalog_product',
      recordId: 'rec-1',
      values: { priority: 3 },
      notify: false,
    })

    expect(emitted).toEqual([])
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it.each([
    ['committed', 1],
    ['rolled_back', 0],
  ] as const)('uses the explicit manager and handles a %s standalone transaction', async (outcome, expectedSignals) => {
    const { engine, emitted } = makeFixture()
    const manager = { isInTransaction: () => true } as unknown as EntityManager
    const lifetime = beginTransactionLifetime(manager)
    const fields = { entityId: 'catalog:catalog_product', recordId: 'rec-1', values: { priority: 3 } }

    await engine.setCustomFields({ ...fields, transactionalEm: manager })
    expect(setRecordCustomFields).toHaveBeenLastCalledWith(manager, expect.objectContaining(fields))
    expect(emitted).toHaveLength(0)

    await completeTransactionLifetime(manager, lifetime, outcome)
    expect(emitted).toHaveLength(expectedSignals)
  })

  it.each([
    ['committed', false, 1],
    ['committed', true, 0],
    ['rolled_back', false, 0],
  ] as const)('keeps the explicit manager in the %s command scope with skipEvents=%s', async (outcome, skipEvents, expectedSignals) => {
    const { engine, container, emitted } = makeFixture()
    const manager = { isInTransaction: () => true } as unknown as EntityManager
    const lifetime = beginTransactionLifetime(manager)
    const scope = engine.createCommandTransactionScope(manager, container)
    onTransactionLifetimeComplete(manager, (result) => scope.complete(result, { skipEvents }))

    await scope.dataEngine.setCustomFields({
      entityId: 'catalog:catalog_product',
      recordId: 'rec-1',
      values: { priority: 3 },
      transactionalEm: manager,
    })
    expect(emitted).toHaveLength(0)

    await completeTransactionLifetime(manager, lifetime, outcome)
    expect(emitted).toHaveLength(expectedSignals)
  })
})
