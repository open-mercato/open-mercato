jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
const emitMock = jest.fn(async (..._args: unknown[]) => {})
const invalidateCrudCacheMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))
jest.mock('../../../events', () => ({
  ...jest.requireActual('../../../events'),
  emitEcommerceEvent: (...args: unknown[]) => emitMock(...args),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { storeCrud, toStoreUniqueConflict } from '../crud'
import { metadata } from '../route'
import { EcommerceStore } from '../../../data/entities'
import { eventsConfig } from '../../../events'
import { createFakeEm, uniqueViolation } from '../../__tests__/fakeEm'

type RawInput = Record<string, unknown>
type StoreCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_STORE_ID = '44444444-4444-4444-8444-444444444444'

const opts = (storeCrud as unknown as { opts: StoreCrudOptions }).opts

function createCtx(em: unknown): CrudCtx {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CrudCtx
}

function makeStore(overrides: Partial<EcommerceStore> = {}): EcommerceStore {
  return {
    id: STORE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    code: 'main',
    name: 'Main',
    slug: 'main',
    status: 'draft',
    defaultLocale: 'en',
    supportedLocales: ['en', 'de'],
    defaultCurrencyCode: 'EUR',
    isPrimary: false,
    settings: {
      branding: { primaryColor: '#112233' },
      contact: { email: 'shop@example.com' },
      display: { priceDisplayModeDefault: 'gross', enableSearch: true },
      seo: {},
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as EcommerceStore
}

const validCreateInput = {
  code: 'outlet',
  name: 'Outlet',
  slug: 'outlet',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  defaultCurrencyCode: 'EUR',
}

describe('ecommerce store CRUD route', () => {
  beforeEach(() => {
    emitMock.mockClear()
    invalidateCrudCacheMock.mockClear()
  })

  it('guards reads with stores.view and every write with stores.manage', () => {
    expect(metadata).toEqual({
      GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
      POST: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
      PUT: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
      DELETE: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
    })
    expect(opts.metadata).toBe(metadata)
  })

  it('scopes by tenant and organization, indexes the store and emits the declared §9.4 events', () => {
    expect(opts.orm).toMatchObject({ orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' })
    expect(opts.indexer).toEqual({ entityType: 'ecommerce:ecommerce_store' })
    const declared = new Set(eventsConfig.events.map((event) => event.id))
    for (const action of ['created', 'updated', 'deleted']) {
      expect(declared.has(`${opts.events!.module}.${opts.events!.entity}.${action}`)).toBe(true)
    }
    const payload = opts.events!.buildPayload!({
      action: 'created',
      entity: makeStore(),
      identifiers: { id: STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
    })
    expect(payload).toEqual({ id: STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('returns camelCase list items carrying updatedAt for optimistic locking', () => {
    const item = opts.list!.transformItem!({
      id: STORE_ID,
      organization_id: ORG_ID,
      tenant_id: TENANT_ID,
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      default_locale: 'en',
      supported_locales: ['en'],
      default_currency_code: 'EUR',
      is_primary: true,
      settings: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })
    expect(item).toMatchObject({ id: STORE_ID, isPrimary: true, updatedAt: '2026-01-02T00:00:00.000Z' })
  })

  describe('create', () => {
    it('rejects a duplicate code and slug with field-level 409 errors', async () => {
      const { em } = createFakeEm({ counts: () => 1 })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).rejects.toMatchObject({
        status: 409,
        body: {
          fieldErrors: {
            code: 'A store with this code already exists.',
            slug: 'A store with this slug already exists.',
          },
        },
      })
    })

    it('checks uniqueness among live stores of the caller tenant', async () => {
      const { em } = createFakeEm()
      await opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))

      expect(em.count).toHaveBeenCalledWith(EcommerceStore, { tenantId: TENANT_ID, code: 'outlet', deletedAt: null })
      expect(em.count).toHaveBeenCalledWith(EcommerceStore, { tenantId: TENANT_ID, slug: 'outlet', deletedAt: null })
    })

    it('always inserts as non-primary and takes scope from the auth context, not the body', () => {
      const { em } = createFakeEm()
      const data = opts.create!.mapToEntity(
        { ...validCreateInput, isPrimary: true, tenantId: OTHER_STORE_ID, organizationId: OTHER_STORE_ID },
        createCtx(em),
      )

      expect(data).toMatchObject({ isPrimary: false, tenantId: TENANT_ID, organizationId: ORG_ID, status: 'draft' })
    })

    it('promotes a requested primary after the insert, clearing the previous primary of the organization', async () => {
      const previous = makeStore({ id: OTHER_STORE_ID, isPrimary: true })
      const { em, calls } = createFakeEm({ findRows: () => [previous] })
      const created = makeStore()

      await opts.hooks!.afterCreate!(created, { ...createCtx(em), input: { ...validCreateInput, isPrimary: true } })

      expect(calls).toEqual(['find', 'nativeUpdate:others', 'nativeUpdate:self'])
      expect(em.nativeUpdate).toHaveBeenNthCalledWith(
        1,
        EcommerceStore,
        { tenantId: TENANT_ID, organizationId: ORG_ID, isPrimary: true, deletedAt: null, id: { $ne: STORE_ID } },
        { isPrimary: false, updatedAt: expect.any(Date) },
      )
      expect(created.isPrimary).toBe(true)
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store.updated',
        { id: OTHER_STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      expect(invalidateCrudCacheMock).toHaveBeenCalledTimes(1)
    })

    it('keeps the create as non-primary when every promotion loses a concurrent race', async () => {
      const { em } = createFakeEm({
        nativeUpdateError: (where) => (typeof where.id === 'string' ? uniqueViolation('ecommerce_stores_org_primary_unique') : null),
      })
      const created = makeStore()

      await opts.hooks!.afterCreate!(created, { ...createCtx(em), input: { ...validCreateInput, isPrimary: true } })

      expect(em.transactional).toHaveBeenCalledTimes(3)
      expect(created.isPrimary).toBe(false)
      expect(opts.create!.response!(created)).toEqual({ id: STORE_ID, isPrimary: false })
    })
  })

  describe('update', () => {
    it('rejects a settings.branding change with a 400 field error pointing at the branding route', async () => {
      const { em } = createFakeEm()
      const store = makeStore()

      await expect(
        opts.update!.applyToEntity(
          store,
          { id: STORE_ID, settings: { branding: { primaryColor: '#445566' } } },
          createCtx(em),
        ),
      ).rejects.toMatchObject({
        status: 400,
        body: { fieldErrors: { 'settings.branding': expect.stringContaining('/api/ecommerce/stores/{id}/branding') } },
      })
      expect(store.settings.branding.primaryColor).toBe('#112233')
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('accepts an unchanged branding echo and merges the other settings sections', async () => {
      const { em } = createFakeEm()
      const store = makeStore()

      await opts.update!.applyToEntity(
        store,
        {
          id: STORE_ID,
          settings: {
            branding: { primaryColor: '#112233', logoUrl: '' },
            display: { enableSearch: false },
            seo: { siteName: 'Main shop' },
          },
        },
        createCtx(em),
      )

      expect(store.settings).toEqual({
        branding: { primaryColor: '#112233' },
        contact: { email: 'shop@example.com' },
        display: { priceDisplayModeDefault: 'gross', enableSearch: false },
        seo: { siteName: 'Main shop' },
      })
      expect(em.flush).toHaveBeenCalledTimes(1)
    })

    it('switches the primary store: clears the previous one in the same write and announces it after commit', async () => {
      const previous = makeStore({ id: OTHER_STORE_ID, isPrimary: true })
      const { em, calls } = createFakeEm({ findRows: () => [previous] })
      const store = makeStore()
      const ctx = createCtx(em)

      await opts.update!.applyToEntity(store, { id: STORE_ID, isPrimary: true }, ctx)

      expect(calls).toEqual(['find', 'nativeUpdate:others', 'nativeUpdate:self', 'flush'])
      expect(store.isPrimary).toBe(true)
      expect(emitMock).not.toHaveBeenCalled()

      await opts.hooks!.afterUpdate!(store, { ...ctx, input: { id: STORE_ID, isPrimary: true } })
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store.updated',
        { id: OTHER_STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    })

    it('maps a concurrent primary promotion to a 409 field error', async () => {
      const { em } = createFakeEm({
        nativeUpdateError: (where) => (typeof where.id === 'string' ? uniqueViolation('ecommerce_stores_org_primary_unique') : null),
      })

      await expect(
        opts.update!.applyToEntity(makeStore(), { id: STORE_ID, isPrimary: true }, createCtx(em)),
      ).rejects.toMatchObject({ status: 409, body: { fieldErrors: { isPrimary: expect.any(String) } } })
    })

    it('rejects a slug already used by another store of the tenant with a field-level 409', async () => {
      const { em } = createFakeEm({ counts: (_entity, where) => (where.slug ? 1 : 0) })

      await expect(
        opts.update!.applyToEntity(makeStore(), { id: STORE_ID, slug: 'taken' }, createCtx(em)),
      ).rejects.toMatchObject({ status: 409, body: { fieldErrors: { slug: 'A store with this slug already exists.' } } })
      expect(em.count).toHaveBeenCalledWith(EcommerceStore, {
        tenantId: TENANT_ID,
        slug: 'taken',
        deletedAt: null,
        id: { $ne: STORE_ID },
      })
    })

    it('rejects removing the current default locale from the supported locales', async () => {
      const { em } = createFakeEm()

      await expect(
        opts.update!.applyToEntity(makeStore(), { id: STORE_ID, supportedLocales: ['de'] }, createCtx(em)),
      ).rejects.toMatchObject({ status: 400, body: { fieldErrors: { supportedLocales: expect.any(String) } } })
    })

    it('maps a unique violation raised by the flush to the matching field error', () => {
      const translate = (_key: string, fallback?: string) => fallback ?? _key
      expect(toStoreUniqueConflict(uniqueViolation('ecommerce_stores_tenant_code_unique'), translate)).toMatchObject({
        status: 409,
        body: { fieldErrors: { code: 'A store with this code already exists.' } },
      })
      expect(toStoreUniqueConflict(uniqueViolation('ecommerce_stores_tenant_slug_unique'), translate)).toMatchObject({
        status: 409,
        body: { fieldErrors: { slug: 'A store with this slug already exists.' } },
      })
      const unrelated = new Error('boom')
      expect(toStoreUniqueConflict(unrelated, translate)).toBe(unrelated)
    })
  })
})
