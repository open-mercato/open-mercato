export type StaffCandidateScope = {
  tenantId: string
  organizationId: string
}

export type StaffCandidateLinkage = 'required' | 'any'

export type StaffCandidate = {
  staffMemberId: string
  displayName: string
}

export type StaffCandidatePage = {
  items: StaffCandidate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type StaffCandidateResolver = {
  listCandidates(input: StaffCandidateScope & {
    linkage: StaffCandidateLinkage
    search?: string
    page: number
    pageSize: number
  }): Promise<StaffCandidatePage>
}
