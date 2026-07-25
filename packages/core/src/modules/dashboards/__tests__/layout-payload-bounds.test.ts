/**
 * @jest-environment node
 */
import {
  MAX_DASHBOARD_LAYOUT_ITEMS,
  MAX_DASHBOARD_WIDGET_ASSIGNMENTS,
  dashboardLayoutSchema,
  roleWidgetSettingsSchema,
  userWidgetSettingsSchema,
} from '@open-mercato/core/modules/dashboards/data/validators'

// Zod v4 .uuid() requires versioned UUID (v1-v8 variant bits).
const uuidAt = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`

const buildItems = (count: number, widgetId = 'widget-a') =>
  Array.from({ length: count }, (_, index) => ({
    id: uuidAt(index),
    widgetId,
    order: index,
  }))

describe('dashboardLayoutSchema — items array bounds', () => {
  test('rejects an items array above the cap', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: buildItems(MAX_DASHBOARD_LAYOUT_ITEMS + 1),
    })
    expect(result.success).toBe(false)
  })

  test('rejects the duplicate-widgetId inflation vector that survives the allowedIds filter', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: buildItems(5000, 'allowed-widget'),
    })
    expect(result.success).toBe(false)
  })

  test('rejects an oversized saved-view layout', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: [],
      presets: [{
        id: 'preset-a',
        name: 'Oversized view',
        items: buildItems(MAX_DASHBOARD_LAYOUT_ITEMS + 1),
      }],
    })
    expect(result.success).toBe(false)
  })

  test('accepts an items array at the cap', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: buildItems(MAX_DASHBOARD_LAYOUT_ITEMS),
    })
    expect(result.success).toBe(true)
  })

  test('accepts a realistic layout', () => {
    const result = dashboardLayoutSchema.safeParse({
      items: [
        { id: uuidAt(1), widgetId: 'revenue-kpi', order: 0, size: 'md' },
        { id: uuidAt(2), widgetId: 'orders-kpi', order: 1, size: 'sm' },
      ],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.items).toHaveLength(2)
  })

  test('accepts an empty layout', () => {
    expect(dashboardLayoutSchema.safeParse({ items: [] }).success).toBe(true)
  })
})

describe('role/user widget settings — widgetIds array bounds', () => {
  const validRoleId = '11111111-1111-4111-8111-111111111111'
  const validUserId = '22222222-2222-4222-8222-222222222222'
  const buildWidgetIds = (count: number) => Array.from({ length: count }, () => 'widget-a')

  test('roleWidgetSettingsSchema rejects widgetIds above the cap', () => {
    const result = roleWidgetSettingsSchema.safeParse({
      roleId: validRoleId,
      widgetIds: buildWidgetIds(MAX_DASHBOARD_WIDGET_ASSIGNMENTS + 1),
    })
    expect(result.success).toBe(false)
  })

  test('roleWidgetSettingsSchema accepts widgetIds at the cap', () => {
    const result = roleWidgetSettingsSchema.safeParse({
      roleId: validRoleId,
      widgetIds: buildWidgetIds(MAX_DASHBOARD_WIDGET_ASSIGNMENTS),
    })
    expect(result.success).toBe(true)
  })

  test('userWidgetSettingsSchema rejects widgetIds above the cap', () => {
    const result = userWidgetSettingsSchema.safeParse({
      userId: validUserId,
      mode: 'override',
      widgetIds: buildWidgetIds(MAX_DASHBOARD_WIDGET_ASSIGNMENTS + 1),
    })
    expect(result.success).toBe(false)
  })

  test('userWidgetSettingsSchema accepts a realistic assignment list', () => {
    const result = userWidgetSettingsSchema.safeParse({
      userId: validUserId,
      mode: 'override',
      widgetIds: ['revenue-kpi', 'orders-kpi'],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.widgetIds).toEqual(['revenue-kpi', 'orders-kpi'])
  })
})
