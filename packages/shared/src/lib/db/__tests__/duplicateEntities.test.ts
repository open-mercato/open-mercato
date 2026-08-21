import 'reflect-metadata'
import { EntitySchema, MetadataStorage } from '@mikro-orm/core'
import { findDuplicateRegisteredEntityClassNames } from '../duplicateEntities'
import { Invoice as InvoiceBilling } from './fixtures/invoiceBilling'
import { Invoice as InvoiceSubscriptions } from './fixtures/invoiceSubscriptions'
import { Ledger as LedgerBilling } from './fixtures/ledgerBilling'
import { Ledger as LedgerSubscriptions } from './fixtures/ledgerSubscriptions'
import { Ledger as LedgerReporting } from './fixtures/ledgerReporting'

function readSourcePath(entity: unknown): string {
  return (entity as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
}

/**
 * Mirrors `enhanceEntities()` in the generated entity registry, which stamps
 * `<moduleId>.<ExportName>` onto every entity export. The generator marks the property
 * configurable, so tests can restamp between cases.
 */
function stampModuleId(entity: unknown, stamp: string): void {
  Object.defineProperty(entity, 'entityName', {
    value: stamp,
    configurable: true,
    enumerable: false,
    writable: false,
  })
}

function clearModuleIdStamp(entity: unknown): void {
  delete (entity as Record<string, unknown>).entityName
}

describe('MikroORM name-based resolution (upstream behaviour pin)', () => {
  // Pins the @mikro-orm/core 7.1.9 behaviour this guard exists for. MetadataStorage
  // keeps a constructor-keyed map and a name-keyed one, and `find()` falls through to
  // the name-keyed one. If a future MikroORM starts detecting class-name collisions
  // itself, this test fails and the guard can be reconsidered.
  it('silently aliases a second entity class onto the first one sharing its name', () => {
    expect(InvoiceBilling).not.toBe(InvoiceSubscriptions)
    expect(InvoiceBilling.name).toBe('Invoice')
    expect(InvoiceSubscriptions.name).toBe('Invoice')

    const storage = new MetadataStorage()
    storage.get(InvoiceBilling, true)
    storage.get(InvoiceSubscriptions, true)

    expect(storage.find(InvoiceBilling)?.class).toBe(InvoiceBilling)
    // The collision: the second class never gets its own metadata, it resolves the
    // first one's — so it would be mapped to the first class's table.
    expect(storage.find(InvoiceSubscriptions)?.class).toBe(InvoiceBilling)
    expect(storage.find('Invoice')?.class).toBe(InvoiceBilling)
  })
})

describe('findDuplicateRegisteredEntityClassNames', () => {
  afterEach(() => {
    for (const entity of [InvoiceBilling, InvoiceSubscriptions, LedgerBilling, LedgerSubscriptions, LedgerReporting]) {
      clearModuleIdStamp(entity)
    }
  })

  it('reports nothing for an empty registration', () => {
    expect(findDuplicateRegisteredEntityClassNames([])).toEqual([])
  })

  it('ignores non-entity exports that share a name', () => {
    // The generated registry spreads every function export of a module's entity file,
    // so plain helpers travel alongside entities and must never be reported.
    const first = function helper(): void {}
    const second = function helper(): void {}
    const values = [first, second, { name: 'TestEntity' }, { name: 'TestEntity' }, null, undefined, 'Invoice']

    expect(findDuplicateRegisteredEntityClassNames(values)).toEqual([])
  })

  it('ignores the same class registered twice (re-export or HMR re-registration)', () => {
    expect(findDuplicateRegisteredEntityClassNames([InvoiceBilling, InvoiceBilling])).toEqual([])
  })

  it('reports two distinct classes sharing a name, with module ids and source paths', () => {
    stampModuleId(InvoiceBilling, 'billing.Invoice')
    stampModuleId(InvoiceSubscriptions, 'subscriptions.Invoice')

    const groups = findDuplicateRegisteredEntityClassNames([InvoiceBilling, InvoiceSubscriptions])

    expect(groups).toHaveLength(1)
    expect(groups[0].className).toBe('Invoice')
    expect(groups[0].sources).toEqual([
      { moduleId: 'billing', sourcePath: readSourcePath(InvoiceBilling) },
      { moduleId: 'subscriptions', sourcePath: readSourcePath(InvoiceSubscriptions) },
    ])
  })

  it('recovers module ids that contain dots', () => {
    stampModuleId(InvoiceBilling, 'acme.billing.Invoice')
    stampModuleId(InvoiceSubscriptions, 'subscriptions.Invoice')

    const groups = findDuplicateRegisteredEntityClassNames([InvoiceBilling, InvoiceSubscriptions])

    expect(groups[0].sources.map((source) => source.moduleId)).toEqual(['acme.billing', 'subscriptions'])
  })

  it('still reports a collision when no module id stamp is present', () => {
    const groups = findDuplicateRegisteredEntityClassNames([InvoiceBilling, InvoiceSubscriptions])

    expect(groups).toHaveLength(1)
    expect(groups[0].sources.map((source) => source.moduleId)).toEqual([undefined, undefined])
    expect(groups[0].sources.map((source) => source.sourcePath)).toEqual([
      readSourcePath(InvoiceBilling),
      readSourcePath(InvoiceSubscriptions),
    ])
  })

  it('detects collisions between EntitySchema instances', () => {
    const first = new EntitySchema({ name: 'Invoice', properties: {} })
    const second = new EntitySchema({ name: 'Invoice', properties: {} })

    const groups = findDuplicateRegisteredEntityClassNames([first, second])

    expect(groups).toHaveLength(1)
    expect(groups[0].className).toBe('Invoice')
  })

  it('detects a collision between a decorated class and an EntitySchema', () => {
    const schema = new EntitySchema({ name: 'Invoice', properties: {} })

    const groups = findDuplicateRegisteredEntityClassNames([InvoiceBilling, schema])

    expect(groups).toHaveLength(1)
    expect(groups[0].sources).toHaveLength(2)
  })

  it('reports every colliding name in one pass, including three-way collisions', () => {
    const groups = findDuplicateRegisteredEntityClassNames([
      InvoiceBilling,
      InvoiceSubscriptions,
      LedgerBilling,
      LedgerSubscriptions,
      LedgerReporting,
    ])

    expect(groups.map((group) => group.className).sort()).toEqual(['Invoice', 'Ledger'])
    expect(groups.find((group) => group.className === 'Ledger')?.sources).toHaveLength(3)
  })
})

describe('resilience', () => {
  // The check is a diagnostic; a hostile or exotic export must never be able to turn it
  // into a bootstrap failure.
  it('skips an entity whose name getter throws', () => {
    const hostile = function () {} as unknown as Record<string, unknown>
    Object.defineProperty(hostile, MetadataStorage.PATH_SYMBOL, { value: '/hostile.ts' })
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error('name is not readable')
      },
    })

    expect(() => findDuplicateRegisteredEntityClassNames([hostile])).not.toThrow()
  })

  it('skips an entity whose module id stamp throws', () => {
    const hostile = function Invoice() {} as unknown as Record<string, unknown>
    Object.defineProperty(hostile, MetadataStorage.PATH_SYMBOL, { value: '/hostile.ts' })
    Object.defineProperty(hostile, 'entityName', {
      get() {
        throw new Error('entityName is not readable')
      },
    })

    expect(() => findDuplicateRegisteredEntityClassNames([hostile])).not.toThrow()
  })

  it('skips a proxy that throws on every trap', () => {
    const hostile = new Proxy(function Invoice() {}, {
      get() {
        throw new Error('trapped')
      },
      has() {
        throw new Error('trapped')
      },
      getOwnPropertyDescriptor() {
        throw new Error('trapped')
      },
    })

    expect(() => findDuplicateRegisteredEntityClassNames([hostile])).not.toThrow()
  })

  it('still finds a real collision alongside a hostile export', () => {
    const hostile = function () {} as unknown as Record<string, unknown>
    Object.defineProperty(hostile, MetadataStorage.PATH_SYMBOL, { value: '/hostile.ts' })
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error('name is not readable')
      },
    })

    const groups = findDuplicateRegisteredEntityClassNames([hostile, InvoiceBilling, InvoiceSubscriptions])

    expect(groups.map((group) => group.className)).toEqual(['Invoice'])
  })

  it('tolerates values that are not entities at all', () => {
    expect(() =>
      findDuplicateRegisteredEntityClassNames([
        null,
        undefined,
        0,
        '',
        Symbol('entity'),
        Object.create(null),
        [],
        new Map(),
      ]),
    ).not.toThrow()
  })
})
