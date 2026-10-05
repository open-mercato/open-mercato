jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
    em.findOne(entity, where),
}))
const emitMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn(async () => {}),
}))
jest.mock('../../../events', () => ({
  ...jest.requireActual('../../../events'),
  emitEcommerceEvent: (...args: unknown[]) => emitMock(...args),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { domainBindingCrud } from '../crud'
import { metadata } from '../route'
import { EcommerceStore, EcommerceStoreDomainBinding } from '../../../data/entities'
import { createFakeEm, uniqueViolation, type FakeEmConfig } from '../../__tests__/fakeEm'

type RawInput = Record<string, unknown>
type BindingCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '55555555-5555-4555-8555-555555555555'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const MAPPING_ID = '66666666-6666-4666-8666-666666666666'
const BINDING_ID = '77777777-7777-4777-8777-777777777777'
const OTHER_BINDING_ID = '88888888-8888-4888-8888-888888888888'

const opts = (domainBindingCrud as unknown as { opts: BindingCrudOptions }).opts

type MappingRow = { tenantId: string; organizationId: string; status: string }

function createCtx(em: unknown, mapping: MappingRow | null = { tenantId: TENANT_ID, organizationId: ORG_ID, status: 'active' }) {
  const domainMappingService = { findById: jest.fn(async () => mapping) }
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'domainMappingService') return domainMappingService
        return undefined
      },
    },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CrudCtx
  return { ctx, domainMappingService }
}

function storeLookup(config: FakeEmConfig = {}): FakeEmConfig {
  return {
    findOne: (entity, where) =>
      entity === EcommerceStore && where.organizationId === ORG_ID && where.id === STORE_ID ? { id: STORE_ID } : null,
    ...config,
  }
}

function makeBinding(overrides: Partial<EcommerceStoreDomainBinding> = {}): EcommerceStoreDomainBinding {
  return {
    id: BINDING_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    domainMappingId: MAPPING_ID,
    pathPrefix: null,
    isPrimary: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as EcommerceStoreDomainBinding
}

const validCreateInput = { storeId: STORE_ID, domainMappingId: MAPPING_ID, pathPrefix: 'Shop/' }

describe('ecommerce store domain binding CRUD route', () => {
  beforeEach(() => emitMock.mockClear())

  it('guards reads with stores.view and writes with domains.manage', () => {
    expect(metadata).toEqual({
      GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
      POST: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
      PUT: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
      DELETE: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
    })
  })

  it('emits the §9.4 payload with storeId and domainMappingId', () => {
    expect(opts.indexer).toEqual({ entityType: 'ecommerce:ecommerce_store_domain_binding' })
    expect(`${opts.events!.module}.${opts.events!.entity}.created`).toBe('ecommerce.store_domain_binding.created')
    expect(
      opts.events!.buildPayload!({
        action: 'deleted',
        entity: makeBinding(),
        identifiers: { id: BINDING_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      }),
    ).toEqual({ id: BINDING_ID, storeId: STORE_ID, domainMappingId: MAPPING_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  describe('create', () => {
    it('accepts a mapping in any status and normalizes the path prefix', async () => {
      const { em } = createFakeEm(storeLookup())
      const { ctx, domainMappingService } = createCtx(em, { tenantId: TENANT_ID, organizationId: ORG_ID, status: 'pending' })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, ctx)).resolves.toBeUndefined()
      expect(domainMappingService.findById).toHaveBeenCalledWith(MAPPING_ID, { tenantId: TENANT_ID })
      expect(em.count).toHaveBeenCalledWith(EcommerceStoreDomainBinding, {
        tenantId: TENANT_ID,
        domainMappingId: MAPPING_ID,
        pathPrefix: '/shop',
        deletedAt: null,
      })
      expect(opts.create!.mapToEntity({ ...validCreateInput, isPrimary: true }, ctx)).toMatchObject({
        pathPrefix: '/shop',
        isPrimary: false,
        organizationId: ORG_ID,
      })
    })

    it('rejects a store of another organization with a storeId field error', async () => {
      const { em } = createFakeEm({ findOne: () => null })
      const { ctx } = createCtx(em)

      await expect(opts.hooks!.beforeCreate!(validCreateInput, ctx)).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { storeId: 'The selected store does not exist in this organization.' } },
      })
      expect(em.findOne).toHaveBeenCalledWith(EcommerceStore, {
        id: STORE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      })
    })

    it('rejects a domain mapping of another organization', async () => {
      const { em } = createFakeEm(storeLookup())
      const { ctx } = createCtx(em, { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, status: 'active' })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, ctx)).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { domainMappingId: 'The selected domain does not belong to this organization.' } },
      })
    })

    it('rejects an unknown domain mapping', async () => {
      const { em } = createFakeEm(storeLookup())
      const { ctx } = createCtx(em, null)

      await expect(opts.hooks!.beforeCreate!(validCreateInput, ctx)).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { domainMappingId: expect.any(String) } },
      })
    })

    it('rejects a duplicate domain and path prefix with a field-level 409', async () => {
      const { em } = createFakeEm(storeLookup({ counts: () => 1 }))
      const { ctx } = createCtx(em)

      await expect(opts.hooks!.beforeCreate!(validCreateInput, ctx)).rejects.toMatchObject({
        status: 409,
        body: { fieldErrors: { pathPrefix: 'This domain and path prefix already serve a store.' } },
      })
    })

    it('promotes a requested primary binding within its store', async () => {
      const previous = makeBinding({ id: OTHER_BINDING_ID, isPrimary: true })
      const { em } = createFakeEm({ findRows: () => [previous] })
      const { ctx } = createCtx(em)
      const created = makeBinding()

      await opts.hooks!.afterCreate!(created, { ...ctx, input: { ...validCreateInput, isPrimary: true } })

      expect(em.nativeUpdate).toHaveBeenNthCalledWith(
        1,
        EcommerceStoreDomainBinding,
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          storeId: STORE_ID,
          isPrimary: true,
          deletedAt: null,
          id: { $ne: BINDING_ID },
        },
        { isPrimary: false, updatedAt: expect.any(Date) },
      )
      expect(created.isPrimary).toBe(true)
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store_domain_binding.updated',
        { id: OTHER_BINDING_ID, storeId: STORE_ID, domainMappingId: MAPPING_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    })
  })

  describe('update', () => {
    it('switches the primary binding of the store in the same write', async () => {
      const previous = makeBinding({ id: OTHER_BINDING_ID, isPrimary: true })
      const { em, calls } = createFakeEm({ findRows: () => [previous] })
      const { ctx } = createCtx(em)
      const binding = makeBinding()

      await opts.update!.applyToEntity(binding, { id: BINDING_ID, isPrimary: true }, ctx)

      expect(calls).toEqual(['find', 'nativeUpdate:others', 'nativeUpdate:self', 'flush'])
      expect(binding.isPrimary).toBe(true)
      await opts.hooks!.afterUpdate!(binding, { ...ctx, input: { id: BINDING_ID, isPrimary: true } })
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store_domain_binding.updated',
        expect.objectContaining({ id: OTHER_BINDING_ID }),
        expect.any(Object),
      )
    })

    it('does not re-check references or uniqueness for an unchanged placement', async () => {
      const { em } = createFakeEm()
      const { ctx, domainMappingService } = createCtx(em)
      const binding = makeBinding({ pathPrefix: '/shop' })

      await opts.update!.applyToEntity(binding, { id: BINDING_ID, pathPrefix: '/shop/' }, ctx)

      expect(domainMappingService.findById).not.toHaveBeenCalled()
      expect(em.count).not.toHaveBeenCalled()
      expect(em.findOne).not.toHaveBeenCalled()
    })

    it('rejects moving the binding to a store of another organization', async () => {
      const { em } = createFakeEm({ findOne: () => null })
      const { ctx } = createCtx(em)

      await expect(
        opts.update!.applyToEntity(
          makeBinding(),
          { id: BINDING_ID, storeId: '99999999-9999-4999-8999-999999999999' },
          ctx,
        ),
      ).rejects.toMatchObject({ status: 400, body: { fieldErrors: { storeId: expect.any(String) } } })
    })

    it('maps a duplicate placement raised by the flush to a field-level 409', async () => {
      const { em } = createFakeEm({ flushError: uniqueViolation('ecommerce_store_domain_bindings_mapping_prefix_unique') })
      const { ctx } = createCtx(em)

      await expect(
        opts.update!.applyToEntity(makeBinding(), { id: BINDING_ID, pathPrefix: '/b2b' }, ctx),
      ).rejects.toMatchObject({ status: 409, body: { fieldErrors: { pathPrefix: expect.any(String) } } })
    })
  })
})
