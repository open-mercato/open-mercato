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
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { channelBindingCrud } from '../crud'
import { metadata } from '../route'
import { EcommerceStore, EcommerceStoreChannelBinding } from '../../../data/entities'
import { createFakeEm, uniqueViolation } from '../../__tests__/fakeEm'

type RawInput = Record<string, unknown>
type BindingCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const CHANNEL_ID = '66666666-6666-4666-8666-666666666666'
const PRICE_KIND_ID = '99999999-9999-4999-8999-999999999999'
const BINDING_ID = '77777777-7777-4777-8777-777777777777'
const OTHER_BINDING_ID = '88888888-8888-4888-8888-888888888888'

const opts = (channelBindingCrud as unknown as { opts: BindingCrudOptions }).opts

function createCtx(em: unknown): CrudCtx {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CrudCtx
}

type Lookup = { store?: boolean; channel?: boolean; priceKind?: boolean }

function lookups(found: Lookup = {}) {
  const resolved = { store: true, channel: true, priceKind: true, ...found }
  return (entity: unknown) => {
    if (entity === EcommerceStore) return resolved.store ? { id: STORE_ID } : null
    if (entity === SalesChannel) return resolved.channel ? { id: CHANNEL_ID } : null
    if (entity === CatalogPriceKind) return resolved.priceKind ? { id: PRICE_KIND_ID } : null
    return null
  }
}

function makeBinding(overrides: Partial<EcommerceStoreChannelBinding> = {}): EcommerceStoreChannelBinding {
  return {
    id: BINDING_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    salesChannelId: CHANNEL_ID,
    priceKindId: null,
    assortmentScope: null,
    priceSortFallback: 'approximate',
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as EcommerceStoreChannelBinding
}

const validCreateInput = { storeId: STORE_ID, salesChannelId: CHANNEL_ID, priceKindId: PRICE_KIND_ID }

describe('ecommerce store channel binding CRUD route', () => {
  beforeEach(() => emitMock.mockClear())

  it('guards reads with stores.view and writes with channels.manage', () => {
    expect(metadata).toEqual({
      GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
      POST: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
      PUT: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
      DELETE: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
    })
  })

  it('emits the §9.4 payload with storeId and salesChannelId', () => {
    expect(opts.indexer).toEqual({ entityType: 'ecommerce:ecommerce_store_channel_binding' })
    expect(`${opts.events!.module}.${opts.events!.entity}.updated`).toBe('ecommerce.store_channel_binding.updated')
    expect(
      opts.events!.buildPayload!({
        action: 'created',
        entity: makeBinding(),
        identifiers: { id: BINDING_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      }),
    ).toEqual({ id: BINDING_ID, storeId: STORE_ID, salesChannelId: CHANNEL_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  describe('create', () => {
    it('verifies the store, sales channel and price kind in the caller organization', async () => {
      const { em } = createFakeEm({ findOne: lookups() })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).resolves.toBeUndefined()
      expect(em.findOne).toHaveBeenCalledWith(SalesChannel, {
        id: CHANNEL_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      })
      expect(em.findOne).toHaveBeenCalledWith(CatalogPriceKind, {
        id: PRICE_KIND_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: ORG_ID }],
      })
    })

    it('rejects a sales channel of another organization', async () => {
      const { em } = createFakeEm({ findOne: lookups({ channel: false }) })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { salesChannelId: 'The selected sales channel does not exist in this organization.' } },
      })
    })

    it('rejects a price kind outside the caller organization', async () => {
      const { em } = createFakeEm({ findOne: lookups({ priceKind: false }) })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { priceKindId: expect.any(String) } },
      })
    })

    it('skips the price kind lookup when none is given and inserts as non-default', async () => {
      const { em } = createFakeEm({ findOne: lookups() })
      const ctx = createCtx(em)
      const input = { storeId: STORE_ID, salesChannelId: CHANNEL_ID, isDefault: true }

      await opts.hooks!.beforeCreate!(input, ctx)

      expect(em.findOne).not.toHaveBeenCalledWith(CatalogPriceKind, expect.anything())
      expect(opts.create!.mapToEntity(input, ctx)).toMatchObject({
        isDefault: false,
        priceKindId: null,
        assortmentScope: null,
        priceSortFallback: 'approximate',
      })
    })

    it('promotes a requested default binding within its store', async () => {
      const previous = makeBinding({ id: OTHER_BINDING_ID, isDefault: true })
      const { em } = createFakeEm({ findRows: () => [previous] })
      const ctx = createCtx(em)
      const created = makeBinding()

      await opts.hooks!.afterCreate!(created, { ...ctx, input: { ...validCreateInput, isDefault: true } })

      expect(em.nativeUpdate).toHaveBeenNthCalledWith(
        1,
        EcommerceStoreChannelBinding,
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          storeId: STORE_ID,
          isDefault: true,
          deletedAt: null,
          id: { $ne: BINDING_ID },
        },
        { isDefault: false, updatedAt: expect.any(Date) },
      )
      expect(created.isDefault).toBe(true)
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store_channel_binding.updated',
        { id: OTHER_BINDING_ID, storeId: STORE_ID, salesChannelId: CHANNEL_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    })
  })

  describe('update', () => {
    it('switches the default binding of the store in the same write', async () => {
      const previous = makeBinding({ id: OTHER_BINDING_ID, isDefault: true })
      const { em, calls } = createFakeEm({ findRows: () => [previous] })
      const binding = makeBinding()

      await opts.update!.applyToEntity(binding, { id: BINDING_ID, isDefault: true }, createCtx(em))

      expect(calls).toEqual(['find', 'nativeUpdate:others', 'nativeUpdate:self', 'flush'])
      expect(binding.isDefault).toBe(true)
    })

    it('rejects switching to a sales channel of another organization', async () => {
      const { em } = createFakeEm({ findOne: lookups({ channel: false }) })

      await expect(
        opts.update!.applyToEntity(
          makeBinding(),
          { id: BINDING_ID, salesChannelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          createCtx(em),
        ),
      ).rejects.toMatchObject({ status: 400, body: { fieldErrors: { salesChannelId: expect.any(String) } } })
    })

    it('clears the price kind and assortment scope without lookups', async () => {
      const { em } = createFakeEm()
      const binding = makeBinding({ priceKindId: PRICE_KIND_ID, assortmentScope: { categoryIds: [PRICE_KIND_ID] } })

      await opts.update!.applyToEntity(binding, { id: BINDING_ID, priceKindId: '', assortmentScope: null }, createCtx(em))

      expect(binding.priceKindId).toBeNull()
      expect(binding.assortmentScope).toBeNull()
      expect(em.findOne).not.toHaveBeenCalled()
    })

    it('maps a concurrent default promotion to a 409 field error', async () => {
      const { em } = createFakeEm({
        nativeUpdateError: (where) =>
          typeof where.id === 'string' ? uniqueViolation('ecommerce_store_channel_bindings_store_default_unique') : null,
      })

      await expect(
        opts.update!.applyToEntity(makeBinding(), { id: BINDING_ID, isDefault: true }, createCtx(em)),
      ).rejects.toMatchObject({ status: 409, body: { fieldErrors: { isDefault: expect.any(String) } } })
    })
  })
})
