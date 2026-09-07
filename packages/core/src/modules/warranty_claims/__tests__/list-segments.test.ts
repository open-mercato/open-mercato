import {
  portalClaimStatusesForStateGroup,
  vendorPolicySegmentQuery,
} from '../lib/listSegments'

describe('warranty list segments', () => {
  it('maps vendor policy tabs onto additive list query filters', () => {
    expect(vendorPolicySegmentQuery('all')).toEqual({})
    expect(vendorPolicySegmentQuery('active')).toEqual({ isActive: 'true' })
    expect(vendorPolicySegmentQuery('automatic')).toEqual({ autoGenerateRecovery: 'true' })
    expect(vendorPolicySegmentQuery('manual')).toEqual({ autoGenerateRecovery: 'false' })
    expect(vendorPolicySegmentQuery('inactive')).toEqual({ isActive: 'false' })
  })

  it('keeps active and terminal portal claim states in separate tabs', () => {
    const open = portalClaimStatusesForStateGroup('open')
    const resolved = portalClaimStatusesForStateGroup('resolved')

    expect(open).toContain('info_requested')
    expect(open).toContain('inspecting')
    expect(resolved).toEqual(['resolved', 'closed', 'rejected', 'cancelled'])
    expect(open.some((status) => resolved.includes(status))).toBe(false)
  })
})
