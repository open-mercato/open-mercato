import type { DomainStatus } from '@open-mercato/core/modules/customer_accounts/data/entities'

export type DomainMappingRow = {
  id: string
  hostname: string
  organizationId: string
  tenantId: string
  provider: string
  status: DomainStatus
  verifiedAt: string | null
  lastDnsCheckAt: string | null
  dnsFailureReason: string | null
  tlsFailureReason: string | null
  tlsRetryCount: number
  cnameTarget: string | null
  aRecordTarget: string | null
  createdAt: string
  updatedAt: string | null
}

export type DomainConfig = {
  cnameTarget: string | null
  aRecordTarget: string | null
}

export type DomainListResponse = {
  ok: boolean
  domainMappings?: DomainMappingRow[]
  config?: DomainConfig
  error?: string
}
