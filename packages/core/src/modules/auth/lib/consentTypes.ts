export type ConsentItem = {
  id: string
  consentType: string
  isGranted: boolean
  grantedAt: string | null
  withdrawnAt: string | null
  source: string | null
  ipAddress: string | null
  integrityValid: boolean
  createdAt: string
  updatedAt: string | null
}
