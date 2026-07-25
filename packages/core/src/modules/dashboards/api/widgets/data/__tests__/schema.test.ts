import { widgetDataRequestSchema } from '../schema'

const baseRequest = {
  entityType: 'sales:orders',
  metric: { field: 'total', aggregate: 'sum' },
}

describe('widgetDataRequestSchema', () => {
  it('keeps existing preset date-range payloads valid', () => {
    const result = widgetDataRequestSchema.safeParse({
      ...baseRequest,
      dateRange: { field: 'created_at', preset: 'last_30_days' },
      comparison: { type: 'previous_period' },
    })

    expect(result.success).toBe(true)
  })

  it('accepts custom date ranges', () => {
    const result = widgetDataRequestSchema.safeParse({
      ...baseRequest,
      dateRange: { field: 'created_at', from: '2024-01-01', to: '2024-01-31' },
    })

    expect(result.success).toBe(true)
  })

  it('rejects custom ranges where from is after to', () => {
    const result = widgetDataRequestSchema.safeParse({
      ...baseRequest,
      dateRange: { field: 'created_at', from: '2024-02-01', to: '2024-01-31' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects custom ranges longer than 366 days', () => {
    const result = widgetDataRequestSchema.safeParse({
      ...baseRequest,
      dateRange: { field: 'created_at', from: '2024-01-01', to: '2025-01-01' },
    })

    expect(result.success).toBe(false)
  })
})
