import {
  buildAssortmentCountDraft,
  buildAssortmentCountUrl,
  buildAssortmentScope,
  buildChannelBindingCreatePayload,
  buildChannelBindingInitialValues,
  buildChannelBindingUpdatePayload,
  channelBindingFormSchema,
  countScopeRules,
  type ChannelBindingFormValues,
  type ChannelBindingRecord,
} from '../storeChannels'

const CATEGORY = '11111111-1111-4111-8111-111111111111'
const TAG = '22222222-2222-4222-8222-222222222222'
const PRODUCT = '33333333-3333-4333-8333-333333333333'

function formValues(overrides: Partial<ChannelBindingFormValues> = {}): ChannelBindingFormValues {
  return {
    salesChannelId: 'channel-1',
    priceKindId: '',
    isDefault: false,
    requireAuthentication: false,
    priceSortFallback: 'approximate',
    categoryIds: [],
    tagIds: [],
    excludeProductIds: [],
    excludeCategoryIds: [],
    excludeTagIds: [],
    ...overrides,
  }
}

function record(overrides: Partial<ChannelBindingRecord> = {}): ChannelBindingRecord {
  return {
    id: 'binding-1',
    storeId: 'store-1',
    salesChannelId: 'channel-1',
    priceKindId: null,
    assortmentScope: null,
    priceSortFallback: 'approximate',
    isDefault: false,
    requireAuthentication: false,
    createdAt: null,
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  }
}

describe('channel binding form helpers', () => {
  it('treats cleared pickers as no restriction: null scope, never empty arrays', () => {
    expect(buildAssortmentScope(formValues())).toBeNull()
    expect(buildAssortmentScope({ categoryIds: [], tagIds: [' '], excludeProductIds: [] })).toBeNull()
  })

  it('keeps only the pickers that hold ids, deduplicated', () => {
    expect(
      buildAssortmentScope(formValues({ categoryIds: [CATEGORY, CATEGORY], excludeProductIds: [PRODUCT], tagIds: [] })),
    ).toEqual({ categoryIds: [CATEGORY], excludeProductIds: [PRODUCT] })
  })

  it('creates with require-authentication off and the approximate fallback by default, sending both explicitly', () => {
    const initial = buildChannelBindingInitialValues(null, { firstBinding: false })
    expect(initial.requireAuthentication).toBe(false)
    expect(initial.priceSortFallback).toBe('approximate')
    expect(initial.isDefault).toBe(false)
    expect(buildChannelBindingCreatePayload('store-1', { ...initial, salesChannelId: 'channel-1' })).toEqual({
      storeId: 'store-1',
      salesChannelId: 'channel-1',
      priceKindId: null,
      assortmentScope: null,
      priceSortFallback: 'approximate',
      requireAuthentication: false,
      isDefault: false,
    })
  })

  it('proposes the first binding of a store as its default', () => {
    expect(buildChannelBindingInitialValues(null, { firstBinding: true }).isDefault).toBe(true)
  })

  it('prefills an existing binding, including its scope', () => {
    const initial = buildChannelBindingInitialValues(
      record({
        priceKindId: 'kind-1',
        requireAuthentication: true,
        priceSortFallback: 'unavailable',
        isDefault: true,
        assortmentScope: { tagIds: [TAG], excludeCategoryIds: [CATEGORY] },
      }),
      { firstBinding: false },
    )
    expect(initial).toMatchObject({
      priceKindId: 'kind-1',
      requireAuthentication: true,
      priceSortFallback: 'unavailable',
      isDefault: true,
      tagIds: [TAG],
      excludeCategoryIds: [CATEGORY],
      categoryIds: [],
    })
  })

  it('clears a stored scope to null on update and never un-marks the default', () => {
    const payload = buildChannelBindingUpdatePayload('binding-1', formValues({ priceKindId: ' ', isDefault: false }))
    expect(payload).toEqual({
      id: 'binding-1',
      salesChannelId: 'channel-1',
      priceKindId: null,
      assortmentScope: null,
      priceSortFallback: 'approximate',
      requireAuthentication: false,
    })
    expect(buildChannelBindingUpdatePayload('binding-1', formValues({ isDefault: true })).isDefault).toBe(true)
  })

  it('sends the unsaved scope and switch to the count endpoint, null meaning unrestricted', () => {
    expect(buildAssortmentCountUrl('binding-1', null)).toBe('/api/ecommerce/store-channel-bindings/binding-1/assortment-count')
    const unrestricted = new URL(
      buildAssortmentCountUrl('binding-1', buildAssortmentCountDraft(formValues({ requireAuthentication: true }))),
      'http://localhost',
    )
    expect(unrestricted.searchParams.get('draftScope')).toBe('null')
    expect(unrestricted.searchParams.get('draftRequireAuthentication')).toBe('true')
    const restricted = new URL(
      buildAssortmentCountUrl('binding-1', buildAssortmentCountDraft(formValues({ tagIds: [TAG] }))),
      'http://localhost',
    )
    expect(JSON.parse(restricted.searchParams.get('draftScope') ?? '')).toEqual({ tagIds: [TAG] })
    expect(restricted.searchParams.get('draftRequireAuthentication')).toBe('false')
  })

  it('counts the scope rules for the list summary', () => {
    expect(countScopeRules(null)).toBe(0)
    expect(countScopeRules({ categoryIds: [CATEGORY], excludeTagIds: [TAG, CATEGORY] })).toBe(3)
  })

  it('requires a sales channel and only the two documented fallbacks', () => {
    expect(channelBindingFormSchema.safeParse(formValues({ salesChannelId: '' })).success).toBe(false)
    expect(channelBindingFormSchema.safeParse({ ...formValues(), priceSortFallback: 'list' }).success).toBe(false)
    expect(channelBindingFormSchema.safeParse(formValues()).success).toBe(true)
  })
})
