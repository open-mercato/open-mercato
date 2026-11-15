import { derivePortalStatus } from '../portalStatus'

describe('derivePortalStatus', () => {
  it('maps the default column to received', () => {
    expect(derivePortalStatus({ isDefault: true, isDone: false })).toBe('received')
  })

  it('maps a done column to resolved even when it is also the default', () => {
    expect(derivePortalStatus({ isDefault: false, isDone: true })).toBe('resolved')
    expect(derivePortalStatus({ isDefault: true, isDone: true })).toBe('resolved')
  })

  it('maps any other column to in_progress', () => {
    expect(derivePortalStatus({ isDefault: false, isDone: false })).toBe('in_progress')
  })

  it('treats an unknown column as received', () => {
    expect(derivePortalStatus(null)).toBe('received')
  })
})
