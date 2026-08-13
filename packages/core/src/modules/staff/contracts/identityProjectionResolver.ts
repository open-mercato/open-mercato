export type StaffIdentityProjectionScope = {
  tenantId: string
  organizationId: string
}

export type StaffIdentityProjection = {
  staffMemberId: string
  displayName: string
  isActive: boolean
}

export type StaffIdentityProjectionResolver = {
  resolveByIds(
    scope: StaffIdentityProjectionScope,
    staffMemberIds: string[],
  ): Promise<StaffIdentityProjection[]>
}
