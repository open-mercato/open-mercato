import { isEditableDocumentStatus } from '../documentStatusOptions'

describe('isEditableDocumentStatus', () => {
  it('excludes Sent from order status editing', () => {
    expect(isEditableDocumentStatus('order', 'sent')).toBe(false)
  })

  it('keeps Sent available when editing quotes', () => {
    expect(isEditableDocumentStatus('quote', 'sent')).toBe(true)
  })

  it.each(['draft', 'confirmed', 'custom_status'])('keeps %s available when editing orders', (value) => {
    expect(isEditableDocumentStatus('order', value)).toBe(true)
  })
})
