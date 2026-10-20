import {
  xrayAnalyticsQuerySchema,
  xrayBreakdownQuerySchema,
  xrayCasesQuerySchema,
  xrayProcessPathParamsSchema,
  xraySettingsUpdateSchema,
  xrayTimeZoneSchema,
  xrayVariantPathParamsSchema,
  xrayVariantsQuerySchema,
  xrayWorkflowDraftRequestSchema,
} from '../data/validators'

describe('Process X-Ray validators', () => {
  it('accepts IANA time zones in any spelling and refuses unknown zones and offsets', () => {
    expect(xrayTimeZoneSchema.parse(' europe/warsaw ')).toBe('europe/warsaw')
    expect(xrayTimeZoneSchema.parse('UTC')).toBe('UTC')
    for (const value of ['Mars/Olympus_Mons', '+01:00', '', 'Europe/Warsaw; drop table', 'a'.repeat(65)]) {
      expect(xrayTimeZoneSchema.safeParse(value).success).toBe(false)
    }
    expect(xraySettingsUpdateSchema.parse({ timeZone: 'America/New_York' })).toEqual({ timeZone: 'America/New_York' })
    expect(xraySettingsUpdateSchema.safeParse({ timeZone: 'Nowhere/City' }).success).toBe(false)
  })

  it('accepts either a default window or a complete custom window', () => {
    expect(xrayAnalyticsQuerySchema.safeParse({}).success).toBe(true)
    expect(xrayAnalyticsQuerySchema.safeParse({ window: '90d' }).success).toBe(true)
    expect(xrayAnalyticsQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).success).toBe(true)
    expect(xrayAnalyticsQuerySchema.safeParse({ window: '1y' }).success).toBe(false)
    expect(xrayAnalyticsQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z' }).success).toBe(false)
    expect(xrayAnalyticsQuerySchema.safeParse({ to: '2026-01-01T00:00:00Z' }).success).toBe(false)
    expect(xrayAnalyticsQuerySchema.safeParse({ window: '7d', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).success).toBe(false)
  })

  it('caps page sizes and variant limits at 100 and validates groupings', () => {
    expect(xrayCasesQuerySchema.parse({ pageSize: '100' }).pageSize).toBe(100)
    expect(xrayCasesQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(xrayCasesQuerySchema.safeParse({ pageSize: '0' }).success).toBe(false)
    expect(xrayCasesQuerySchema.safeParse({ variantHash: 'not-a-hash' }).success).toBe(false)
    expect(xrayVariantsQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(xrayBreakdownQuerySchema.parse({ groupBy: 'user' }).groupBy).toBe('user')
    expect(xrayBreakdownQuerySchema.safeParse({ groupBy: 'person' }).success).toBe(false)
  })

  it('validates path parameters', () => {
    expect(xrayProcessPathParamsSchema.safeParse({ processKey: 'customers.deal' }).success).toBe(true)
    expect(xrayProcessPathParamsSchema.safeParse({ processKey: 'Customers' }).success).toBe(false)
    expect(xrayVariantPathParamsSchema.safeParse({ processKey: 'customers.deal', hash: 'f'.repeat(64) }).success).toBe(true)
    expect(xrayVariantPathParamsSchema.safeParse({ processKey: 'customers.deal', hash: 'F'.repeat(64) }).success).toBe(false)
  })

  it('accepts only the documented workflow draft options', () => {
    expect(xrayWorkflowDraftRequestSchema.parse({ commandId: ' customers.deals.update ', window: '7d', inputKeys: { status: 'statusValue' } }))
      .toEqual({ commandId: 'customers.deals.update', window: '7d', inputKeys: { status: 'statusValue' } })
    expect(xrayWorkflowDraftRequestSchema.safeParse({}).success).toBe(false)
    expect(xrayWorkflowDraftRequestSchema.safeParse({ commandId: 'x', enabled: true }).success).toBe(false)
    expect(xrayWorkflowDraftRequestSchema.safeParse({ commandId: 'x', inputKeys: { status: '{{context.secret}}' } }).success).toBe(false)
    expect(xrayWorkflowDraftRequestSchema.safeParse({ commandId: 'x', recordIdInputKey: 'id; drop' }).success).toBe(false)
    expect(xrayWorkflowDraftRequestSchema.safeParse({ commandId: 'x', workflowId: 'Upper Case' }).success).toBe(false)
    expect(xrayWorkflowDraftRequestSchema.safeParse({ commandId: 'x', from: '2026-01-01T00:00:00Z' }).success).toBe(false)
  })
})
