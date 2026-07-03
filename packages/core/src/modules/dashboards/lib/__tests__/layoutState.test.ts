import {
  isLegacyLayoutArray,
  normalizeLayoutState,
  serializeLayoutStateForStoredShape,
} from '../layoutState'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'

describe('dashboard layout state', () => {
  it('normalizes a legacy item array into a layout state', () => {
    const state = normalizeLayoutState([
      { id: secondId, widgetId: 'orders', order: 2, size: 'full' },
      { id: firstId, widgetId: 'revenue', order: 0, size: 'sm' },
      { id: firstId, widgetId: 'duplicate', order: 1, size: 'md' },
    ])

    expect(state).toEqual({
      items: [
        { id: firstId, widgetId: 'revenue', order: 0, priority: 0, size: 'sm', settings: undefined },
        { id: secondId, widgetId: 'orders', order: 1, priority: 1, size: 'full', settings: undefined },
      ],
    })
  })

  it('normalizes an object layout without losing preferences', () => {
    const raw = {
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'md' }],
      preferences: {
        dateRange: {
          preset: 'custom',
          from: '2024-02-01',
          to: '2024-02-29',
          compare: 'previous_year',
        },
      },
    }

    const state = normalizeLayoutState(raw)

    expect(state).toEqual({
      items: [{ id: firstId, widgetId: 'revenue', order: 0, priority: 0, size: 'md', settings: undefined }],
      preferences: raw.preferences,
    })
    expect(serializeLayoutStateForStoredShape(raw, state)).toEqual(state)
  })

  it('falls back to an empty state for garbage input', () => {
    expect(normalizeLayoutState(null)).toEqual({ items: [] })
    expect(normalizeLayoutState(undefined)).toEqual({ items: [] })
    expect(normalizeLayoutState({ items: 'nope' })).toEqual({ items: [] })
  })

  it('normalizes presets and drops an activePresetId that matches no preset', () => {
    const raw = {
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'md' }],
      presets: [
        { id: 'view-a', name: '  Sales  ', items: [{ id: secondId, widgetId: 'orders', order: 0, size: 'sm' }] },
        { id: '', name: 'no id', items: [] },
        { id: 'view-a', name: 'duplicate id', items: [] },
      ],
      activePresetId: 'missing',
    }

    const state = normalizeLayoutState(raw)

    expect(state.presets).toEqual([
      { id: 'view-a', name: 'Sales', items: [{ id: secondId, widgetId: 'orders', order: 0, priority: 0, size: 'sm', settings: undefined }] },
    ])
    expect(state.activePresetId).toBeUndefined()
    // Round-trips through the object storage shape, presets and all.
    expect(serializeLayoutStateForStoredShape({ items: [] }, state)).toEqual(state)
  })

  it('keeps a valid activePresetId', () => {
    const state = normalizeLayoutState({
      items: [],
      presets: [{ id: 'view-a', name: 'Sales', items: [] }],
      activePresetId: 'view-a',
    })
    expect(state.activePresetId).toBe('view-a')
  })

  it('preserves array and object storage shapes when serializing', () => {
    const state = normalizeLayoutState({
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'lg' }],
      preferences: { dateRange: { preset: 'last_30_days', compare: 'previous_period' } },
    })

    expect(isLegacyLayoutArray([])).toBe(true)
    expect(isLegacyLayoutArray({ items: [] })).toBe(false)
    expect(serializeLayoutStateForStoredShape([], state)).toEqual(state.items)
    expect(serializeLayoutStateForStoredShape({ items: [] }, state)).toEqual(state)
  })
})
