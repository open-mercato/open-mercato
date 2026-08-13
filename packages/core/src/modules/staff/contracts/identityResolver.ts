export type StaffIdentityScope = {
  tenantId: string
  organizationId: string
}

export type StaffIdentity = {
  staffMemberId: string
  userId: string | null
  displayName: string
  isActive: boolean
}

export type StaffIdentityLookupResult =
  | { kind: 'found'; identity: StaffIdentity }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }

export type StaffIdentityResolver = {
  resolveByUserId(
    scope: StaffIdentityScope,
    userId: string,
  ): Promise<StaffIdentityLookupResult>

  resolveByStaffMemberId(
    scope: StaffIdentityScope,
    staffMemberId: string,
  ): Promise<StaffIdentityLookupResult>
}
