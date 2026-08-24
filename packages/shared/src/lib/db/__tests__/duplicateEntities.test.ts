import 'reflect-metadata'
import { EntitySchema, MetadataStorage } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
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
  // Pins the @mikro-orm/core 7.1.9 behaviour this guard exists for, through real
  // discovery rather than bare MetadataStorage calls. Discovery keeps one metadata entry
  // per constructor, so class-based lookups stay correct; the name-keyed map holds only
  // one of the same-named classes, so everything resolved by name silently picks a
  // winner. If a future MikroORM starts detecting class-name collisions itself, this
  // test fails and the guard can be reconsidered.
  //
  // `connect: false` keeps it DB-free: discovery and metadata validation run in full,
  // no connection is opened.
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [InvoiceBilling, InvoiceSubscriptions],
      metadataProvider: ReflectMetadataProvider,
      dbName: 'duplicate-entity-class-names-probe',
      connect: false,
      discovery: { warnWhenNoEntities: false },
      allowGlobalContext: true,
    })
  })

  afterAll(async () => {
    await orm?.close(true)
  })

  it('accepts both same-named classes without any duplicate error', () => {
    expect(InvoiceBilling).not.toBe(InvoiceSubscriptions)
    expect(InvoiceBilling.name).toBe('Invoice')
    expect(InvoiceSubscriptions.name).toBe('Invoice')
  })

  it('keeps class-based lookups correct, which is why this never fails loudly', () => {
    const metadata = orm.getMetadata()

    expect(metadata.find(InvoiceBilling)?.tableName).toBe('duplicate_entity_fixture_billing')
    expect(metadata.find(InvoiceSubscriptions)?.tableName).toBe('duplicate_entity_fixture_subscriptions')
  })

  it('resolves the name to exactly one of them, so the other is unreachable by name', () => {
    const metadata = orm.getMetadata()
    const byName = metadata.find('Invoice')

    expect(byName).toBeDefined()
    // Registration order decides the winner; the point is that one of the two is simply
    // gone from every name-based path.
    expect([
      'duplicate_entity_fixture_billing',
      'duplicate_entity_fixture_subscriptions',
    ]).toContain(byName?.tableName)
    expect(metadata.find(InvoiceBilling)?.tableName === byName?.tableName).not.toBe(
      metadata.find(InvoiceSubscriptions)?.tableName === byName?.tableName,
    )
  })

  it('hands a name-based repository the winner regardless of which module asked', () => {
    const repositoryTable = orm.em.getRepository('Invoice').getEntityManager().getMetadata().find('Invoice')?.tableName

    expect(repositoryTable).toBe(orm.getMetadata().find('Invoice')?.tableName)
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
