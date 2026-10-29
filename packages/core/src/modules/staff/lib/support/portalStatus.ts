import type { StaffSupportPortalStatus } from '../../data/entities'

export type PortalStatusFlags = {
  isDefault: boolean
  isDone: boolean
}

export function derivePortalStatus(status: PortalStatusFlags | null | undefined): StaffSupportPortalStatus {
  if (!status) return 'received'
  if (status.isDone) return 'resolved'
  if (status.isDefault) return 'received'
  return 'in_progress'
}

export const SUPPORT_PORTAL_STATUSES: readonly StaffSupportPortalStatus[] = ['received', 'in_progress', 'resolved']
