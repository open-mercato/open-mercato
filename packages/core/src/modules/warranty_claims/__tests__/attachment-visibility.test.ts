import {
  CUSTOMER_VISIBLE_ATTACHMENT_TAG,
  isCustomerVisibleAttachment,
} from '../lib/attachmentVisibility'

describe('warranty claim portal attachment visibility', () => {
  test('exposes a stable customer-visible tag', () => {
    expect(CUSTOMER_VISIBLE_ATTACHMENT_TAG).toBe('customer-visible')
  })

  test('accepts only tag lists containing the customer-visible tag', () => {
    expect(isCustomerVisibleAttachment([CUSTOMER_VISIBLE_ATTACHMENT_TAG])).toBe(true)
    expect(isCustomerVisibleAttachment(['photo', CUSTOMER_VISIBLE_ATTACHMENT_TAG])).toBe(true)
  })

  test('rejects untagged, unrelated, and missing tag lists', () => {
    expect(isCustomerVisibleAttachment(undefined)).toBe(false)
    expect(isCustomerVisibleAttachment([])).toBe(false)
    expect(isCustomerVisibleAttachment(['internal', 'photo'])).toBe(false)
    expect(isCustomerVisibleAttachment(['customer'])).toBe(false)
  })
})
