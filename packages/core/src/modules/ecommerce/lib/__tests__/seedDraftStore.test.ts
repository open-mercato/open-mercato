import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ecommerceStoreCreateSchema } from '../../data/validators'
import { emitEcommerceEvent } from '../../events'
import {
  DEFAULT_DRAFT_STORE_CODE,
  DEFAULT_DRAFT_STORE_CURRENCY,
  DEFAULT_DRAFT_STORE_NAME,
  deriveDraftStoreIdentity,
  seedDraftStore,
} from '../seedDraftStore'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitEcommerceEvent: jest.fn(async () => undefined),
}))

const mockedFindOne = findOneWithDecryption as jest.Mock
const mockedEmit = emitEcommerceEvent as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

type CreatedStore = Record<string, unknown> & { id: string }

function createEm(existingStores: number) {
  const created: CreatedStore[] = []
  const em = {
    count: jest.fn(async () => existingStores),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `store-${created.length + 1}`, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em, created }
}

describe('seedDraftStore', () => {
  beforeEach(() => {
    mockedFindOne.mockReset()
    mockedEmit.mockClear()
  })

  it('creates exactly one draft store derived from the organization', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme Outdoor & Co.' })
    const { em, created } = createEm(0)

    const result = await seedDraftStore(em as never, SCOPE)

    expect(result).toEqual({ status: 'created', storeId: 'store-1' })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Acme Outdoor & Co.',
      code: 'acme-outdoor-co',
      slug: 'acme-outdoor-co',
      status: 'draft',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: DEFAULT_DRAFT_STORE_CURRENCY,
      isPrimary: false,
    })
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('scopes the organization lookup to the tenant and the existence check to the whole tenant', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme' })
    const { em } = createEm(0)

    await seedDraftStore(em as never, SCOPE)

    expect(em.count).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT_ID })
    expect(mockedFindOne).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { id: ORGANIZATION_ID, tenant: TENANT_ID },
      undefined,
      SCOPE,
    )
  })

  it('is a no-op when the tenant already has a store', async () => {
    const { em, created } = createEm(1)

    const result = await seedDraftStore(em as never, SCOPE)

    expect(result).toEqual({ status: 'exists' })
    expect(created).toHaveLength(0)
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('creates one store when run twice against a persisting store table', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme' })
    let rows = 0
    const { em, created } = createEm(0)
    em.count.mockImplementation(async () => rows)
    em.flush.mockImplementation(async () => {
      rows = created.length
    })

    const first = await seedDraftStore(em as never, SCOPE)
    const second = await seedDraftStore(em as never, SCOPE)

    expect(first.status).toBe('created')
    expect(second.status).toBe('exists')
    expect(created).toHaveLength(1)
  })

  it('uses the resolved base currency when one is supplied and falls back otherwise', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme' })
    const resolved = createEm(0)
    await seedDraftStore(resolved.em as never, SCOPE, { resolveCurrencyCode: async () => 'PLN' })
    expect(resolved.created[0].defaultCurrencyCode).toBe('PLN')

    const fallback = createEm(0)
    await seedDraftStore(fallback.em as never, SCOPE, { resolveCurrencyCode: async () => null })
    expect(fallback.created[0].defaultCurrencyCode).toBe(DEFAULT_DRAFT_STORE_CURRENCY)
  })

  it('falls back to a default name when the organization cannot be read', async () => {
    mockedFindOne.mockResolvedValue(null)
    const { em, created } = createEm(0)

    await seedDraftStore(em as never, SCOPE)

    expect(created[0]).toMatchObject({
      name: DEFAULT_DRAFT_STORE_NAME,
      code: 'default-store',
      slug: 'default-store',
    })
  })

  it('announces the created store with its scope', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme' })
    const { em } = createEm(0)

    await seedDraftStore(em as never, SCOPE)

    expect(mockedEmit).toHaveBeenCalledWith(
      'ecommerce.store.created',
      { id: 'store-1', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
  })

  it('still succeeds when the created event cannot be emitted', async () => {
    mockedFindOne.mockResolvedValue({ name: 'Acme' })
    mockedEmit.mockRejectedValueOnce(new Error('[internal] bus down'))
    const { em } = createEm(0)

    await expect(seedDraftStore(em as never, SCOPE)).resolves.toEqual({ status: 'created', storeId: 'store-1' })
  })
})

describe('deriveDraftStoreIdentity', () => {
  it.each([
    ['Acme Outdoor', 'acme-outdoor'],
    ['  Zażółć gęślą jaźń  ', 'za-g-l-ja'],
    ['A -- B', 'a-b'],
    ['!!!', DEFAULT_DRAFT_STORE_CODE],
    ['', 'default-store'],
    ['x'.repeat(300), 'x'.repeat(80)],
    [`${'ab '.repeat(60)}`, `${'ab-'.repeat(26)}ab`.slice(0, 80)],
  ])('derives a valid code and slug from %j', (organizationName, expectedSlug) => {
    const identity = deriveDraftStoreIdentity(organizationName)
    const parsed = ecommerceStoreCreateSchema.safeParse({
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      ...identity,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'USD',
    })

    expect(parsed.success).toBe(true)
    expect(identity.slug).toBe(expectedSlug.replace(/-+$/, ''))
    expect(identity.code).toBe(identity.slug)
  })

  it('keeps a long organization name within the name limit', () => {
    expect(deriveDraftStoreIdentity('n'.repeat(500)).name).toHaveLength(200)
  })

  it('uses the default name for a missing organization name', () => {
    expect(deriveDraftStoreIdentity(null).name).toBe(DEFAULT_DRAFT_STORE_NAME)
  })
})
