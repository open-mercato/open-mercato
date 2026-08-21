import 'reflect-metadata'
import { MetadataStorage } from '@mikro-orm/core'
import { Invoice as InvoiceBilling } from './fixtures/invoiceBilling'
import { Invoice as InvoiceSubscriptions } from './fixtures/invoiceSubscriptions'

const warn = jest.fn()

jest.mock('../../logger', () => ({
  createLogger: () => ({
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() }),
  }),
}))

const GLOBAL_ENTITIES_KEY = '__openMercatoOrmEntities__'

function readSourcePath(entity: unknown): string {
  return (entity as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
}

function stampModuleId(entity: unknown, stamp: string): void {
  Object.defineProperty(entity, 'entityName', {
    value: stamp,
    configurable: true,
    enumerable: false,
    writable: false,
  })
}

describe('registerOrmEntities duplicate class name reporting', () => {
  const originalEntities = (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]

  beforeEach(() => {
    warn.mockClear()
  })

  afterEach(() => {
    for (const entity of [InvoiceBilling, InvoiceSubscriptions]) {
      delete (entity as Record<string, unknown>).entityName
    }
    if (typeof originalEntities === 'undefined') {
      delete (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]
      return
    }
    ;(globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY] = originalEntities
  })

  it('warns and still registers when two modules contribute the same class name', async () => {
    stampModuleId(InvoiceBilling, 'billing.Invoice')
    stampModuleId(InvoiceSubscriptions, 'subscriptions.Invoice')
    const entities = [InvoiceBilling, InvoiceSubscriptions]
    const { registerOrmEntities, getOrmEntities } = await import('../mikro')

    registerOrmEntities(entities)

    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('[Bootstrap] Duplicate entity class name(s)')
    expect(message).toContain('Invoice')
    expect(message).toContain('billing')
    expect(message).toContain('subscriptions')
    expect(message).toContain(readSourcePath(InvoiceBilling))
    expect(message).toContain(readSourcePath(InvoiceSubscriptions))
    // Warning-only by design: registration must still complete.
    expect(getOrmEntities()).toBe(entities)
  })

  it('stays silent for a registration with unique class names', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([InvoiceBilling])

    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent when the same class is registered twice', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([InvoiceBilling, InvoiceBilling])

    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent for non-entity exports that share a name', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([
      function helper(): void {},
      function helper(): void {},
      { name: 'TestEntity' },
      { name: 'TestEntity' },
    ])

    expect(warn).not.toHaveBeenCalled()
  })
})
