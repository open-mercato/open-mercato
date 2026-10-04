import { isDraftDocumentStatus } from '../status'

describe('isDraftDocumentStatus', () => {
  it('treats missing and explicitly non-final statuses as drafts', () => {
    expect(isDraftDocumentStatus(null)).toBe(true)
    expect(isDraftDocumentStatus('  ')).toBe(true)
    expect(isDraftDocumentStatus('draft')).toBe(true)
    expect(isDraftDocumentStatus('pending_approval')).toBe(true)
    expect(isDraftDocumentStatus('rejected')).toBe(true)
  })

  it('treats known final and unknown custom statuses as final', () => {
    expect(isDraftDocumentStatus('sent')).toBe(false)
    expect(isDraftDocumentStatus('fulfilled')).toBe(false)
    expect(isDraftDocumentStatus('tenant_custom')).toBe(false)
  })
})
