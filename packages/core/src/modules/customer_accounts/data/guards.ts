import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import type { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

const DOMAIN_MAPPING_ENTITY = 'customer_accounts.domain_mapping'
const MAX_DOMAINS_PER_ORG = 2

function readHostnameField(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>).hostname
  return typeof raw === 'string' ? raw : null
}

function readOrgIdField(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>).organizationId ?? (payload as Record<string, unknown>).organization_id
  return typeof raw === 'string' ? raw : null
}

const hostnameFormatGuard: MutationGuard = {
  id: 'customer_accounts.domain_mapping.hostname-format',
  targetEntity: DOMAIN_MAPPING_ENTITY,
  operations: ['create'],
  priority: 10,

  async validate(input) {
    const raw = readHostnameField(input.mutationPayload)
    if (!raw) {
      return { ok: false, status: 422, message: 'Hostname is required' }
    }
    const normalized = tryNormalizeHostname(raw)
    if (!normalized) {
      return {
        ok: false,
        status: 422,
        message: 'Hostname is not a valid DNS name (must be at least two labels, ASCII or IDN)',
      }
    }
    return {
      ok: true,
      modifiedPayload: { hostname: normalized },
    }
  },
}

const hostnameUniqueGuard: MutationGuard = {
  id: 'customer_accounts.domain_mapping.hostname-unique',
  targetEntity: DOMAIN_MAPPING_ENTITY,
  operations: ['create'],
  priority: 20,

  async validate(input) {
    const raw = readHostnameField(input.mutationPayload)
    if (!raw) return { ok: true }
    const hostname = tryNormalizeHostname(raw)
    if (!hostname) return { ok: true }

    const container = await createRequestContainer()
    let service: DomainMappingService | null = null
    try {
      service = container.resolve('domainMappingService') as DomainMappingService
    } catch {
      return { ok: true }
    }

    const existing = await service.resolveByHostname(hostname)
    if (existing && existing.tenantId !== input.tenantId) {
      return {
        ok: false,
        status: 409,
        message: 'This domain is already in use by another organization',
      }
    }
    if (existing && existing.organizationId !== readOrgIdField(input.mutationPayload)) {
      return {
        ok: false,
        status: 409,
        message: 'This domain is already in use by another organization within your tenant',
      }
    }
    return { ok: true }
  },
}

const orgLimitGuard: MutationGuard = {
  id: 'customer_accounts.domain_mapping.org-limit',
  targetEntity: DOMAIN_MAPPING_ENTITY,
  operations: ['create'],
  priority: 30,

  async validate(input) {
    const orgId = readOrgIdField(input.mutationPayload) ?? input.organizationId
    if (!orgId) {
      return { ok: false, status: 422, message: 'Organization is required' }
    }

    const container = await createRequestContainer()
    let service: DomainMappingService | null = null
    try {
      service = container.resolve('domainMappingService') as DomainMappingService
    } catch {
      return { ok: true }
    }

    const existing = await service.findByOrganization(orgId)
    if (existing.length >= MAX_DOMAINS_PER_ORG) {
      return {
        ok: false,
        status: 409,
        message: `Each organization can have at most ${MAX_DOMAINS_PER_ORG} custom domains (one active and one pending replacement). Remove an existing domain or finish the swap first.`,
      }
    }
    return { ok: true }
  },
}

// Mirrors the in-progress-lock pattern used by other modules' update/delete
// guards: ensure the target record exists and belongs to the caller's tenant
// before any destructive or lifecycle-changing mutation runs. Verification
// and health-check endpoints invoke this via operation: 'update' since they
// transition the record's lifecycle status.
const recordScopeGuard: MutationGuard = {
  id: 'customer_accounts.domain_mapping.record-scope',
  targetEntity: DOMAIN_MAPPING_ENTITY,
  operations: ['update', 'delete'],
  priority: 10,

  async validate(input) {
    const resourceId = input.resourceId
    if (!resourceId) {
      return { ok: false, status: 422, message: 'Domain mapping id is required' }
    }

    const container = await createRequestContainer()
    let service: DomainMappingService | null = null
    try {
      service = container.resolve('domainMappingService') as DomainMappingService
    } catch {
      return { ok: true }
    }

    const record = await service.findById(resourceId, { tenantId: input.tenantId })
    if (!record) {
      return { ok: false, status: 404, message: 'Domain mapping not found' }
    }
    return { ok: true }
  },
}

export const guards: MutationGuard[] = [
  hostnameFormatGuard,
  hostnameUniqueGuard,
  orgLimitGuard,
  recordScopeGuard,
]
