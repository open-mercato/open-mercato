import {
  availabilityDefaultsFormSchema,
  buildAvailabilityCreatePayload,
  buildAvailabilityInitialValues,
  buildAvailabilityUpdatePayload,
  buildStoreGeneralInitialValues,
  buildStoreGeneralPayload,
  isStoreDefaultPolicy,
  storeGeneralFormSchema,
  type StoreDefaultPolicy,
} from '../storeGeneral'
import type { StoreAdminRecord } from '../storeAdmin'

const store: StoreAdminRecord = {
  id: '3f1c1d7e-5f43-4f0e-9d0f-0d6b6f1f0a11',
  organizationId: 'a1b2c3d4-0000-4000-8000-000000000001',
  tenantId: 'a1b2c3d4-0000-4000-8000-000000000002',
  code: 'main',
  name: 'Main store',
  slug: 'main-shop',
  status: 'draft',
  defaultLocale: 'en',
  supportedLocales: ['en', 'pl'],
  defaultCurrencyCode: 'EUR',
  isPrimary: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

function policy(overrides: Partial<StoreDefaultPolicy>): StoreDefaultPolicy {
  return {
    id: 'policy-1',
    storeId: store.id,
    productId: null,
    variantId: null,
    allowBackorder: false,
    backorderLeadTimeDays: null,
    hideWhenOutOfStock: false,
    updatedAt: '2026-10-03T10:00:00.000Z',
    ...overrides,
  }
}

describe('store General form', () => {
  it('starts from the stored identity, locales and currency', () => {
    expect(buildStoreGeneralInitialValues(store)).toEqual({
      name: 'Main store',
      code: 'main',
      slug: 'main-shop',
      status: 'draft',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl'],
      defaultCurrencyCode: 'EUR',
    })
  })

  it('accepts a default locale that is one of the supported locales', () => {
    expect(storeGeneralFormSchema.safeParse(buildStoreGeneralInitialValues(store)).success).toBe(true)
  })

  it('rejects removing the default locale from the supported locales as a defaultLocale field error', () => {
    const result = storeGeneralFormSchema.safeParse({ ...buildStoreGeneralInitialValues(store), supportedLocales: ['pl'] })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ['defaultLocale'], message: 'ecommerce.validation.defaultLocaleNotSupported' }),
    ])
  })

  it('validates the identifiers with the server patterns', () => {
    const result = storeGeneralFormSchema.safeParse({ ...buildStoreGeneralInitialValues(store), code: 'Not Valid', slug: 'bad slug' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.path[0]).sort((left, right) => String(left).localeCompare(String(right)))).toEqual([
      'code',
      'slug',
    ])
  })

  it('builds a trimmed update payload carrying the store id and no settings', () => {
    const payload = buildStoreGeneralPayload(store.id, {
      ...buildStoreGeneralInitialValues(store),
      name: ' Renamed ',
      status: 'active',
      defaultCurrencyCode: 'pln',
    })
    expect(payload).toEqual({
      id: store.id,
      name: 'Renamed',
      code: 'main',
      slug: 'main-shop',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl'],
      defaultCurrencyCode: 'PLN',
    })
    expect(payload).not.toHaveProperty('settings')
  })
})

describe('store-default availability policy', () => {
  it('recognises only the row for this store with no product and no variant', () => {
    expect(isStoreDefaultPolicy(policy({}), store.id)).toBe(true)
    expect(isStoreDefaultPolicy(policy({ productId: 'product-1' }), store.id)).toBe(false)
    expect(isStoreDefaultPolicy(policy({ variantId: 'variant-1' }), store.id)).toBe(false)
    expect(isStoreDefaultPolicy(policy({ storeId: null }), store.id)).toBe(false)
    expect(isStoreDefaultPolicy(policy({ storeId: 'other' }), store.id)).toBe(false)
  })

  it('shows both switches off when the store has no default row yet', () => {
    expect(buildAvailabilityInitialValues(null)).toEqual({
      hideWhenOutOfStock: false,
      allowBackorder: false,
      backorderLeadTimeDays: null,
    })
    expect(buildAvailabilityInitialValues(policy({ hideWhenOutOfStock: true, allowBackorder: true, backorderLeadTimeDays: 4 }))).toEqual({
      hideWhenOutOfStock: true,
      allowBackorder: true,
      backorderLeadTimeDays: 4,
    })
  })

  it('requires a whole-day lead time only while backorders are allowed', () => {
    const base = { hideWhenOutOfStock: false, allowBackorder: true }
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: null }).success).toBe(false)
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: '' }).success).toBe(false)
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: -1 }).success).toBe(false)
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: '2.5' }).success).toBe(false)
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: 0 }).success).toBe(true)
    expect(availabilityDefaultsFormSchema.safeParse({ ...base, backorderLeadTimeDays: '7' }).success).toBe(true)
    expect(
      availabilityDefaultsFormSchema.safeParse({ hideWhenOutOfStock: true, allowBackorder: false, backorderLeadTimeDays: null }).success,
    ).toBe(true)
  })

  it('creates the store-default row scoped to this store with no product or variant', () => {
    expect(
      buildAvailabilityCreatePayload(store, { hideWhenOutOfStock: true, allowBackorder: true, backorderLeadTimeDays: '5' }),
    ).toEqual({
      organizationId: store.organizationId,
      tenantId: store.tenantId,
      storeId: store.id,
      productId: null,
      variantId: null,
      hideWhenOutOfStock: true,
      allowBackorder: true,
      backorderLeadTimeDays: 5,
    })
  })

  it('cannot create a row for a store record without its organization and tenant', () => {
    expect(
      buildAvailabilityCreatePayload({ id: store.id }, { hideWhenOutOfStock: false, allowBackorder: false, backorderLeadTimeDays: null }),
    ).toBeNull()
  })

  it('updates only the two switches and the lead time of an existing row, keeping other policy fields untouched', () => {
    expect(
      buildAvailabilityUpdatePayload('policy-1', { hideWhenOutOfStock: true, allowBackorder: false, backorderLeadTimeDays: 9 }),
    ).toEqual({ id: 'policy-1', hideWhenOutOfStock: true, allowBackorder: false })
    expect(
      buildAvailabilityUpdatePayload('policy-1', { hideWhenOutOfStock: false, allowBackorder: true, backorderLeadTimeDays: 3 }),
    ).toEqual({ id: 'policy-1', hideWhenOutOfStock: false, allowBackorder: true, backorderLeadTimeDays: 3 })
  })
})
