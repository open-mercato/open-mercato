import type { WarrantyClaimStatus } from '../data/validators'

export type VendorPolicySegment = 'all' | 'active' | 'automatic' | 'manual' | 'inactive'
export type PortalClaimStateGroup = 'open' | 'resolved'

export function vendorPolicySegmentQuery(segment: VendorPolicySegment): Record<string, string> {
  if (segment === 'active') return { isActive: 'true' }
  if (segment === 'inactive') return { isActive: 'false' }
  if (segment === 'automatic') return { autoGenerateRecovery: 'true' }
  if (segment === 'manual') return { autoGenerateRecovery: 'false' }
  return {}
}

export function portalClaimStatusesForStateGroup(group: PortalClaimStateGroup): WarrantyClaimStatus[] {
  if (group === 'open') {
    return ['draft', 'submitted', 'in_review', 'info_requested', 'approved', 'awaiting_return', 'received', 'inspecting']
  }
  return ['resolved', 'closed', 'rejected', 'cancelled']
}
