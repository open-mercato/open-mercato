export type ComplianceItem = {
  userId: string
  email: string
  enrolled: boolean
  methodCount: number
  compliant: boolean
  lastLoginAt?: string
}

export type ComplianceResponse = {
  items: ComplianceItem[]
}

export type UserStatus = {
  enrolled: boolean
  methods: Array<{
    type: string
    label?: string
    lastUsed?: string
  }>
  recoveryCodesRemaining: number
  compliant: boolean
}
