import {
  dashboardLayoutItemPatchSchema,
  dashboardLayoutSchema,
} from '../validators'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const thirdId = '33333333-3333-4333-8333-333333333333'

describe('dashboard validators', () => {
  it('keeps the legacy layout item payload valid for existing sizes', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: [
        { id: firstId, widgetId: 'revenue', order: 0, size: 'sm' },
        { id: secondId, widgetId: 'orders', order: 1, size: 'md' },
        { id: thirdId, widgetId: 'aov', order: 2, size: 'lg' },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('requires from and to for custom layout date ranges', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: [],
      preferences: {
        dateRange: {
          preset: 'custom',
          compare: 'previous_period',
        },
      },
    })

    expect(result.success).toBe(false)
  })

  it('accepts the full dashboard widget size', () => {
    expect(dashboardLayoutSchema.safeParse({
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'full' }],
    }).success).toBe(true)

    expect(dashboardLayoutItemPatchSchema.safeParse({
      id: firstId,
      size: 'full',
    }).success).toBe(true)
  })

  it('accepts a valid widget accent and rejects an unknown one', () => {
    expect(dashboardLayoutSchema.safeParse({
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'md', accent: 'success' }],
    }).success).toBe(true)

    expect(dashboardLayoutSchema.safeParse({
      items: [{ id: firstId, widgetId: 'revenue', order: 0, size: 'md', accent: 'rainbow' }],
    }).success).toBe(false)

    expect(dashboardLayoutItemPatchSchema.safeParse({ id: firstId, accent: 'brand' }).success).toBe(true)
    expect(dashboardLayoutItemPatchSchema.safeParse({ id: firstId, accent: 'neon' }).success).toBe(false)
  })
})
