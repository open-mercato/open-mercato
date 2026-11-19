/** @jest-environment node */
// T2.9: the project list route is also the detail read for the edit page, so a
// billing column missing from the projection is a field the form can never show
// back. These tests pin the projection and the documented response shape.

const BILLING_COLUMNS = [
  'hourly_rate',
  'currency_code',
  'billable_by_default',
  'budget_kind',
  'budget_value',
  'budget_warn_at_percent',
  'customer_snapshot',
] as const

describe('time project list projection', () => {
  it('selects every column the project form round-trips', async () => {
    const { timeProjectListFields } = await import('../route')
    for (const column of BILLING_COLUMNS) {
      expect(timeProjectListFields).toContain(column)
    }
    expect(timeProjectListFields).toContain('customer_id')
    expect(timeProjectListFields).toContain('updated_at')
  })

  it('documents the billing columns as nullable and optional', async () => {
    const { timeProjectListItemSchema } = await import('../route')
    const shape = timeProjectListItemSchema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean } }>

    for (const column of BILLING_COLUMNS) {
      expect(shape[column]).toBeDefined()
      // Keys stay stable and serialize even when unset, so the OpenAPI schema holds.
      expect(shape[column].safeParse(null).success).toBe(true)
      expect(shape[column].safeParse(undefined).success).toBe(true)
    }
  })

  it('accepts a decorated row as the API returns it', async () => {
    const { timeProjectListItemSchema } = await import('../route')

    const parsed = timeProjectListItemSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      tenant_id: '33333333-3333-4333-8333-333333333333',
      name: 'Nordvik service portal',
      code: 'NORDVIK',
      customer_id: '44444444-4444-4444-8444-444444444444',
      customer_snapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
      // numeric(14,4) reaches the client as a decimal string.
      hourly_rate: '180.5000',
      currency_code: 'PLN',
      billable_by_default: false,
      budget_kind: 'amount',
      budget_value: '25000.0000',
      budget_warn_at_percent: 90,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
      // D-3 read-side signal, untouched by this change.
      entryCount: 12,
      lockedEntryCount: 0,
      currencyLocked: true,
    })

    expect(parsed).toMatchObject({
      hourly_rate: '180.5000',
      billable_by_default: false,
      budget_kind: 'amount',
      budget_value: '25000.0000',
      budget_warn_at_percent: 90,
      customer_snapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
      currencyLocked: true,
    })
  })
})
