import 'reflect-metadata'
import { MetadataStorage } from '@mikro-orm/core'
import { Invoice as InvoiceBilling } from './fixtures/invoiceBilling'
import { Invoice as InvoiceSubscriptions } from './fixtures/invoiceSubscriptions'
import { Invoice as InvoiceReporting } from './fixtures/invoiceReporting'
import { Ledger as LedgerBilling } from './fixtures/ledgerBilling'
import { Ledger as LedgerSubscriptions } from './fixtures/ledgerSubscriptions'

const warn = jest.fn()

jest.mock('../../logger', () => ({
  createLogger: () => ({
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() }),
  }),
}))

const GLOBAL_ENTITIES_KEY = '__openMercatoOrmEntities__'
const GLOBAL_REPORTED_KEY = '__openMercatoReportedDuplicateEntityClassNames__'

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
    // Collisions are reported once per process; start each case from a clean slate.
    delete (globalThis as Record<string, unknown>)[GLOBAL_REPORTED_KEY]
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
    // The structured-logging contract keeps the message constant and the dynamic values
    // in queryable fields.
    const [message, fields] = warn.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toBe('Duplicate entity class names across enabled modules')
    expect(fields.classNames).toEqual(['Invoice'])
    expect(fields.duplicates).toEqual([
      {
        className: 'Invoice',
        sources: [
          { moduleId: 'billing', sourcePath: readSourcePath(InvoiceBilling) },
          { moduleId: 'subscriptions', sourcePath: readSourcePath(InvoiceSubscriptions) },
        ],
      },
    ])
    expect(typeof fields.remediation).toBe('string')
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

  it('reports a standing collision once, not on every HMR re-registration', async () => {
    stampModuleId(InvoiceBilling, 'billing.Invoice')
    stampModuleId(InvoiceSubscriptions, 'subscriptions.Invoice')
    const entities = [InvoiceBilling, InvoiceSubscriptions]
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities(entities)
    registerOrmEntities(entities)
    registerOrmEntities(entities)

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reports a newly introduced collision even after an earlier one was reported', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([InvoiceBilling, InvoiceSubscriptions])
    expect(warn).toHaveBeenCalledTimes(1)

    registerOrmEntities([InvoiceBilling, InvoiceSubscriptions, LedgerBilling, LedgerSubscriptions])

    expect(warn).toHaveBeenCalledTimes(2)
    // The already-reported name is not repeated.
    expect(warn.mock.calls[1][1].classNames).toEqual(['Ledger'])
  })

  it('reports a collision again after it was fixed and reintroduced', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([InvoiceBilling, InvoiceSubscriptions])
    expect(warn).toHaveBeenCalledTimes(1)

    // The developer renames one of them; the next reload is clean.
    registerOrmEntities([InvoiceBilling])
    expect(warn).toHaveBeenCalledTimes(1)

    // Reverting the rename must warn again rather than stay silent forever.
    registerOrmEntities([InvoiceBilling, InvoiceSubscriptions])

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[1][1].classNames).toEqual(['Invoice'])
  })

  it('reports again when the same class name starts colliding with a different module', async () => {
    const { registerOrmEntities } = await import('../mikro')

    registerOrmEntities([InvoiceBilling, InvoiceSubscriptions])
    expect(warn).toHaveBeenCalledTimes(1)

    registerOrmEntities([InvoiceBilling, InvoiceReporting])

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[1][1].classNames).toEqual(['Invoice'])
  })
})
