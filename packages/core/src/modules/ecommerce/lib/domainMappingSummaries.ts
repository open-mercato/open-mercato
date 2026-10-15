export const DOMAIN_MAPPING_STATUSES = ['pending', 'verified', 'active', 'dns_failed', 'tls_failed'] as const

export type DomainMappingStatus = (typeof DOMAIN_MAPPING_STATUSES)[number]

export type DomainMappingSummary = {
  id: string
  hostname: string
  status: string
  lastDnsCheckAt: string | null
  dnsFailureReason: string | null
  tlsFailureReason: string | null
}

type DomainMappingRecord = {
  id: string
  hostname: string
  organizationId: string
  tenantId: string
  status?: string | null
  lastDnsCheckAt?: Date | string | null
  dnsFailureReason?: string | null
  tlsFailureReason?: string | null
}

type DomainMappingReader = {
  findByOrganization(organizationId: string, scope?: { tenantId?: string }): Promise<DomainMappingRecord[]>
}

type ContainerLike = { resolve(name: string): unknown }

export function isDomainMappingStatus(value: unknown): value is DomainMappingStatus {
  return typeof value === 'string' && (DOMAIN_MAPPING_STATUSES as readonly string[]).includes(value)
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toSummary(record: DomainMappingRecord): DomainMappingSummary {
  return {
    id: record.id,
    hostname: record.hostname,
    status: record.status ?? 'pending',
    lastDnsCheckAt: toIsoString(record.lastDnsCheckAt),
    dnsFailureReason: record.dnsFailureReason ?? null,
    tlsFailureReason: record.tlsFailureReason ?? null,
  }
}

function resolveDomainMappingReader(container: unknown): DomainMappingReader | null {
  try {
    const service = (container as ContainerLike).resolve('domainMappingService') as DomainMappingReader | null | undefined
    return service && typeof service.findByOrganization === 'function' ? service : null
  } catch {
    return null
  }
}

export async function loadOrganizationDomainMappings(
  container: unknown,
  scope: { organizationId: string; tenantId: string },
): Promise<DomainMappingSummary[] | null> {
  const reader = resolveDomainMappingReader(container)
  if (!reader) return null
  const records = await reader.findByOrganization(scope.organizationId, { tenantId: scope.tenantId })
  return records
    .filter((record) => record.tenantId === scope.tenantId && record.organizationId === scope.organizationId)
    .map(toSummary)
}
