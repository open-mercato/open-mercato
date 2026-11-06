import {
  buildAssortmentScopePayload,
  mapAssortmentScopeToFormValues,
} from '../customerGroupAssortmentScope'

describe('customer group assortment scope form mapping', () => {
  it('maps a null or absent scope to five empty pickers', () => {
    const empty = {
      categoryIds: [],
      tagIds: [],
      excludeProductIds: [],
      excludeCategoryIds: [],
      excludeTagIds: [],
    }
    expect(mapAssortmentScopeToFormValues(null)).toEqual(empty)
    expect(mapAssortmentScopeToFormValues(undefined)).toEqual(empty)
  })

  it('sends null when every picker is cleared, never empty arrays', () => {
    expect(
      buildAssortmentScopePayload({
        categoryIds: [],
        tagIds: [],
        excludeProductIds: [],
        excludeCategoryIds: [],
        excludeTagIds: [],
      }),
    ).toBeNull()
    expect(buildAssortmentScopePayload({})).toBeNull()
  })

  it('omits cleared pickers and keeps the populated ones', () => {
    expect(
      buildAssortmentScopePayload({ categoryIds: ['cat-1'], tagIds: [], excludeTagIds: ['tag-9'] }),
    ).toEqual({ categoryIds: ['cat-1'], excludeTagIds: ['tag-9'] })
  })

  it('round-trips include and exclude lists unchanged', () => {
    const scope = {
      categoryIds: ['cat-1', 'cat-2'],
      tagIds: ['tag-1'],
      excludeProductIds: ['prod-1'],
      excludeCategoryIds: ['cat-3'],
      excludeTagIds: ['tag-2'],
    }
    expect(buildAssortmentScopePayload(mapAssortmentScopeToFormValues(scope))).toEqual(scope)
  })

  it('drops blanks, non-strings and duplicates', () => {
    expect(buildAssortmentScopePayload({ categoryIds: [' cat-1 ', '', 'cat-1', 7, null] })).toEqual({
      categoryIds: ['cat-1'],
    })
  })
})
