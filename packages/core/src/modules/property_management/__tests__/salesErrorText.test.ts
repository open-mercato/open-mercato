import { describeDuplicateOutcome, describeSalesError, salesRefusalMessage } from '../lib/salesErrorText'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `${key}|${fallback ?? ''}`,
  }),
}))

describe('describeSalesError', () => {
  it('returns nothing without an error', async () => {
    await expect(describeSalesError(null)).resolves.toBe('')
  })

  it('translates known runner codes', async () => {
    const text = await describeSalesError({ status: null, code: 'cancelled_status_missing', message: null })
    expect(text.startsWith('property_management.salesErrors.cancelledStatusMissing|')).toBe(true)
  })

  it('passes through the message sales returned', async () => {
    const text = await describeSalesError({ status: 409, code: 'order_locked', message: 'Order is locked' })
    expect(text).toBe('Order is locked')
  })

  it('falls back to the generic text instead of the bare code when sales returned an internal message', async () => {
    const text = await describeSalesError({ status: 422, code: 'validation_failed', message: '[internal] bad shape' })
    expect(text.startsWith('property_management.salesErrors.unexpected|')).toBe(true)
  })

  it('hides the validation text of a 422 behind the generic text', async () => {
    const text = await describeSalesError({ status: 422, code: 'validation_failed', message: 'Expected string, received number' })
    expect(text).not.toContain('Expected string')
    expect(text.startsWith('property_management.salesErrors.unexpected|')).toBe(true)
  })

  it('hides the message of a sales server error behind the generic text', async () => {
    const text = await describeSalesError({ status: 500, code: 'internal_error', message: 'relation "sales_orders" does not exist' })
    expect(text).not.toContain('sales_orders')
    expect(text.startsWith('property_management.salesErrors.unexpected|')).toBe(true)
  })

  it('still translates a known runner code whatever the status', async () => {
    const text = await describeSalesError({ status: 500, code: 'sales_status_missing', message: 'boom' })
    expect(text.startsWith('property_management.salesErrors.statusMissing|')).toBe(true)
  })

  it('falls back to the generic text when sales returned no message', async () => {
    const text = await describeSalesError({ status: 409, code: 'order_locked', message: null })
    expect(text.startsWith('property_management.salesErrors.unexpected|')).toBe(true)
  })

  it('keeps the outcome text property management wrote itself', async () => {
    const text = await describeSalesError({ status: null, code: 'sales_operation_duplicated', message: 'The extras were cancelled: order-1.' })
    expect(text).toBe('The extras were cancelled: order-1.')
  })

  it('hides raw text of errors that did not come from sales', async () => {
    const text = await describeSalesError({
      status: null,
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 10.0.0.12:5432',
    })
    expect(text).not.toContain('10.0.0.12')
    expect(text.startsWith('property_management.salesErrors.unexpected|')).toBe(true)
  })
})

describe('salesRefusalMessage', () => {
  it('keeps the message of a 4xx refusal other than 422', () => {
    expect(salesRefusalMessage({ status: 409, code: 'order_locked', message: 'Order is locked' })).toBe('Order is locked')
    expect(salesRefusalMessage({ status: 400, code: 'bad_request', message: 'Order is closed' })).toBe('Order is closed')
  })

  it('drops the message of a 422 or a 5xx', () => {
    expect(salesRefusalMessage({ status: 422, code: 'validation_failed', message: 'Required' })).toBeNull()
    expect(salesRefusalMessage({ status: 503, code: 'unavailable', message: 'upstream connect error' })).toBeNull()
  })
})

describe('describeDuplicateOutcome', () => {
  it('lists the cancelled and the failed extras', async () => {
    const text = await describeDuplicateOutcome(['order-1'], ['order-2'])
    expect(text).toContain('property_management.notifications.salesOperationDuplicated.cancelled|')
    expect(text).toContain('property_management.notifications.salesOperationDuplicated.notCancelled|')
  })

  it('describes the outcome when there was nothing to cancel', async () => {
    const text = await describeDuplicateOutcome([], [])
    expect(text.startsWith('property_management.notifications.salesOperationDuplicated.nothingToCancel|')).toBe(true)
    const described = await describeSalesError({ status: null, code: 'sales_operation_duplicated', message: text })
    expect(described).toBe(text)
  })
})
