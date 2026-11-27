import { LockMode } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createContainer } from 'awilix'
import { withAtomicFlush } from '../../../commands/flush'
import { registerOrmEntities } from '../../../db/mikro'
import { findOneWithDecryption } from '../../../encryption/find'
import { registerEntityIds } from '../../../encryption/entityIds'
import { bindCompiledCrudFormSink, type CompiledCrudFormSinkAssociation } from '../compiled-extensions'
import { persistCrudFormSectionSink, prepareCrudFormSectionSinks } from '../extension-sinks'
import { collectCrudFormSectionOutboxRuntimes } from '../outbox'
import { outboxColumns } from '../outbox-columns'

jest.mock('../../../encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

@Entity()
@Unique({ properties: ['tenantId', 'organizationId', 'hostId'] })
class ProductBrand {
  @PrimaryKey({ type: 'uuid' })
  id = 'brand-id'

  @Property({ type: 'uuid' })
  tenantId!: string

  @Property({ type: 'uuid' })
  organizationId!: string

  @Property({ type: 'uuid' })
  hostId!: string

  @Property({ type: Date })
  updatedAt!: Date

  @Property({ type: 'text' })
  brand!: string
}

@Entity()
@Unique({ properties: ['tenantId', 'organizationId', 'hostId'] })
class ProductMirror extends outboxColumns {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ type: 'uuid' })
  tenantId!: string

  @Property({ type: 'uuid' })
  organizationId!: string

  @Property({ type: 'uuid' })
  hostId!: string

  @Property({ type: Date })
  updatedAt!: Date

  @Property({ type: 'json', nullable: true })
  values!: Record<string, unknown> | null
}

const context = { scope: { tenantId: 'tenant-id', organizationId: 'org-id' }, hostResourceId: 'host-id',
  auth: { sub: 'actor', tenantId: 'tenant-id' }, container: createContainer() }
const address = { hostId: 'catalog.product', formVariant: 'edit', formOperation: 'update', sectionId: 'details' } as const
const binding = {
  ownerModuleId: 'example', capabilityId: 'example.brand.capability', id: 'example.brand', roundTripId: 'example.brand@v1',
  hostDetailEntityId: 'catalog.product', payloadPaths: ['extensions.example.brand'],
  fields: [{ key: 'brand', kind: 'text', required: true }],
  store: { kind: 'table', entityId: 'example:product_brand' },
  entityExports: { ProductBrand, ProductMirror },
} as const satisfies CompiledCrudFormSinkAssociation

beforeEach(() => {
  registerEntityIds({ example: { product_brand: 'example:product_brand', product_mirror: 'example:product_mirror' } })
  registerOrmEntities([ProductBrand, ProductMirror])
  jest.mocked(findOneWithDecryption).mockReset()
})

function setup() {
  const sink = bindCompiledCrudFormSink(binding, address)
  if (!sink) throw new Error('[internal] Expected a bound table store')
  let persisted: ProductBrand | null = null
  let pending: ProductBrand | null = null
  let active = false
  const fake = {
    begin: jest.fn(async () => { active = true; pending = persisted && { ...persisted, updatedAt: new Date(persisted.updatedAt.getTime()) } }),
    flush: jest.fn(async () => {}),
    commit: jest.fn(async () => { persisted = pending; active = false }),
    rollback: jest.fn(async () => { pending = null; active = false }),
    isInTransaction: () => active,
    create: jest.fn((_entity: unknown, value: Omit<ProductBrand, 'id'>) => { pending = { id: 'brand-id', ...value }; return pending }),
    assign: jest.fn((row: ProductBrand, value: Partial<ProductBrand>) => Object.assign(row, value)),
    remove: jest.fn(() => { pending = null }),
  }
  const em = fake as unknown as EntityManager
  jest.mocked(findOneWithDecryption).mockImplementation(async () => active ? pending : persisted)
  const write = (...[value, version]: [string, string | null]) =>
    withAtomicFlush(em, [async () => {
      await persistCrudFormSectionSink({ runtime: sink, values: { brand: value }, expectedUpdatedAt: version }, { ...context, em }, 'update')
    }], { transaction: true })
  const atomic = (operation: () => Promise<void>) => withAtomicFlush(em, [operation], { transaction: true })
  return { sink, em, fake, write, atomic, read: () => persisted }
}

it('binds a registered class from its exact generator-owned namespace and rejects a spoofed stamp or wrong owner', () => {
  expect(bindCompiledCrudFormSink(binding, address)?.fact).toMatchObject({
    targetEntityId: 'example:product_brand', atomicity: 'host-transaction', optimisticLock: 'sink-version', undo: 'snapshot',
  })
  class Spoof extends ProductBrand {}
  Object.defineProperty(Spoof, 'entityName', { value: 'example.ProductBrand' })
  registerOrmEntities([ProductBrand, Spoof])
  expect(bindCompiledCrudFormSink({ ...binding, entityExports: { ProductBrand: Spoof } }, address)).toBeNull()
  expect(bindCompiledCrudFormSink({ ...binding, entityExports: undefined }, address)).toBeNull()
  expect(bindCompiledCrudFormSink({ ...binding, ownerModuleId: 'other' }, address)).toBeNull()
})

it('keeps the scoped table write, version fence, delete and undo on the ambient transaction', async () => {
  const { sink, em, fake, write, atomic, read } = setup()
  await write('First', null)
  const first = read()!.updatedAt.toISOString()
  await write('Updated', first)
  const updated = read()!.updatedAt.toISOString()
  expect(updated > first).toBe(true)
  await expect(write('Stale', first)).rejects.toMatchObject({ status: 409 })
  expect(read()?.brand).toBe('Updated')
  expect(findOneWithDecryption).toHaveBeenCalledWith(em, ProductBrand,
    { tenantId: 'tenant-id', organizationId: 'org-id', hostId: 'host-id' },
    { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: 'tenant-id', organizationId: 'org-id', hostId: 'host-id' })
  await expect(sink.lockRow?.({ ...context, em })).rejects.toMatchObject({ status: 409 })
  await expect(sink.load({ ...context, em, userId: 'actor' })).resolves.toEqual({
    values: { brand: 'Updated' }, updatedAt: new Date(updated),
  })
  let deletion: Awaited<ReturnType<NonNullable<typeof sink.onHostDeleted>>> | undefined
  await atomic(async () => { deletion = await sink.onHostDeleted?.({ ...context, em }) })
  expect(read()).toBeNull()
  expect(deletion).toMatchObject({ before: { brand: 'Updated' }, after: null, tableAfterUpdatedAt: null, tableBeforeUpdatedAt: updated })
  await expect(write('Removed', updated)).rejects.toMatchObject({ status: 409 })
  await atomic(async () => { await sink.undo?.({ ...context, em, snapshot: deletion! }) })
  expect(read()!.updatedAt.toISOString() > updated).toBe(true)
  expect(read()?.brand).toBe('Updated')
  expect(fake.rollback).toHaveBeenCalledTimes(2)
})

it('rolls back staged table rows and rejects mismatched scope and extra owner fields', async () => {
  const { sink, em, fake, atomic, read } = setup()
  await expect(atomic(async () => {
    await persistCrudFormSectionSink({ runtime: sink, values: { brand: 'Staged' }, expectedUpdatedAt: null }, { ...context, em }, 'create')
    throw new Error('[internal] Abort after staging')
  })).rejects.toThrow('Abort after staging')
  expect(read()).toBeNull()
  expect(fake.commit).not.toHaveBeenCalled()
  expect(fake.rollback).toHaveBeenCalledTimes(1)
  jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ tenantId: 'tenant-id', organizationId: 'unrelated-org', hostId: 'host-id',
    brand: 'Protected', updatedAt: new Date() })
  await expect(sink.load({ ...context, em, userId: 'actor' })).rejects.toMatchObject({ status: 409 })
  await expect(prepareCrudFormSectionSinks({
    payload: { extensions: { example: { brand: 'Field', hostId: 'outside' } } },
    accepted: [sink], runtimes: new Map([[sink.fact.id, sink]]), allowWrites: true, creating: true,
  })).rejects.toMatchObject({ status: 409 })
})

it('reuses the exact outbox mirror and fenced contract across operation bindings', () => {
  const deliver = jest.fn(async () => ({ status: 'applied' as const }))
  const external = {
    ...binding, store: { kind: 'external', config: { integrationId: 'erp', mirror: 'example:product_mirror',
      contractId: 'example:product_mirror@v2', deliver,
    } },
  } as const satisfies CompiledCrudFormSinkAssociation
  const update = bindCompiledCrudFormSink(external, address)
  const create = bindCompiledCrudFormSink({ ...external, id: 'example.create-brand', roundTripId: 'example.create-brand@v1' },
    { ...address, formOperation: 'create' })
  if (!update || !create) throw new Error('[internal] Expected bound operation sinks')
  expect(update.fact.externalDelivery).toMatchObject({
    integrationId: 'erp', contractId: 'example:product_mirror@v2', fencing: 'remote-monotonic-revision/v1',
  })
  expect(update.outbox?.mirror).toBe(create.outbox?.mirror)
  expect(update.outbox?.deliver).toBe(deliver)
  expect(collectCrudFormSectionOutboxRuntimes([update, create]).has('example:product_mirror')).toBe(true)
  expect(bindCompiledCrudFormSink({ ...external, store: { ...external.store,
    config: { ...external.store.config, contractId: 'example:another_entity@v1' } } }, address)).toBeNull()
  expect(deliver).not.toHaveBeenCalled()
})
