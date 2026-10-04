import { isDraftStatus } from '../status'

describe('isDraftStatus', () => {
  it('treats missing and listed statuses as drafts', () => {
    const draftStatuses = new Set(['draft'])
    expect(isDraftStatus(null, draftStatuses)).toBe(true)
    expect(isDraftStatus('  ', draftStatuses)).toBe(true)
    expect(isDraftStatus('draft', draftStatuses)).toBe(true)
    expect(isDraftStatus('sent', draftStatuses)).toBe(false)
  })
})
