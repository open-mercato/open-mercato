/**
 * Resolve the tenant context for a customer-portal request.
 *
 * - Platform-domain hosts: resolve the tenant server-side from the body
 *   `organizationId` (org → tenant). A legacy body `tenantId` is still accepted
 *   and cross-checked against the resolved tenant (fail closed on mismatch); if
 *   no `organizationId` is supplied it falls back to the legacy `tenantId`.
 * - Custom-domain hosts: resolve via `domainMappingService.resolveByHostname()`.
 *   If the body supplied a different `tenantId`, fail closed (mismatch).
 *
 * This is the single entry point used by all customer-auth routes (login,
 * signup, magic-link, password-reset) so they all behave consistently when
 * the request arrives on a tenant's branded URL.
 *
 * See `.ai/specs/implemented/2026-04-08-portal-custom-domain-routing.md` Phase 1.5 and
 * `.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md` § C.
 */

import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import { platformDomains } from '@open-mercato/core/modules/customer_accounts/lib/platformDomains'
import { secretEqual } from '@open-mercato/core/modules/customer_accounts/lib/secretCompare'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

export class TenantResolutionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'TenantResolutionError'
  }
}

export type ResolvedTenantContext = {
  source: 'body' | 'host'
  tenantId: string
  organizationId: string | null
  hostname: string | null
}

function readForcedHost(req: Request): string | null {
  // Test-only override. The middleware honors `X-Force-Host` only when
  // `NODE_ENV === 'test'` AND `X-Force-Host-Secret` matches; we mirror the
  // same check here so request-scoped helpers behave the same way under tests.
  if (process.env.NODE_ENV !== 'test') return null
  const expected = process.env.FORCE_HOST_SECRET
  if (!expected) return null
  if (!secretEqual(req.headers.get('x-force-host-secret'), expected)) return null
  const host = req.headers.get('x-force-host')
  return host && host.length > 0 ? host : null
}

async function resolveTenantFromOrganization(
  organizationId: string,
  container: AppContainer | undefined,
): Promise<{ tenantId: string; organizationId: string }> {
  let em: EntityManager
  if (container) {
    em = container.resolve('em') as EntityManager
  } else {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const requestContainer = await createRequestContainer()
    em = requestContainer.resolve('em') as EntityManager
  }

  const organization = await em.findOne(
    Organization,
    { id: organizationId, deletedAt: null },
    { populate: ['tenant'] },
  )
  if (!organization) {
    throw new TenantResolutionError('Organization not found', 400)
  }
  const tenantId = typeof organization.tenant === 'string'
    ? organization.tenant
    : organization.tenant?.id
      ? String(organization.tenant.id)
      : null
  if (!tenantId) {
    throw new TenantResolutionError('Organization not found', 400)
  }
  return { tenantId, organizationId: String(organization.id) }
}

export async function resolveTenantContext(
  req: Request,
  bodyTenantId: string | null | undefined,
  options?: { container?: AppContainer; organizationId?: string | null },
): Promise<ResolvedTenantContext> {
  const rawHost = readForcedHost(req) ?? req.headers.get('host')
  const hostname = rawHost ? tryNormalizeHostname(rawHost) : null
  const isPlatform = hostname ? platformDomains().includes(hostname) : true
  const bodyOrganizationId = options?.organizationId ?? null

  if (isPlatform) {
    if (bodyOrganizationId) {
      const resolved = await resolveTenantFromOrganization(bodyOrganizationId, options?.container)
      if (bodyTenantId && bodyTenantId !== resolved.tenantId) {
        throw new TenantResolutionError(
          'tenantId in request body does not match the resolved organization',
          400,
        )
      }
      return {
        source: 'body',
        tenantId: resolved.tenantId,
        organizationId: resolved.organizationId,
        hostname,
      }
    }
    if (!bodyTenantId) {
      throw new TenantResolutionError(
        'organizationId or tenantId is required for platform-domain logins',
        400,
      )
    }
    return { source: 'body', tenantId: bodyTenantId, organizationId: null, hostname }
  }

  // Custom-domain host
  let service: DomainMappingService | null = null
  try {
    if (options?.container) {
      service = options.container.resolve('domainMappingService') as DomainMappingService
    } else {
      const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
      const container = await createRequestContainer()
      service = container.resolve('domainMappingService') as DomainMappingService
    }
  } catch {
    throw new TenantResolutionError('Custom domain routing is not available on this deployment', 503)
  }

  if (!hostname) throw new TenantResolutionError('Unable to determine request hostname', 400)
  const resolved = await service.resolveByHostname(hostname)
  if (!resolved || resolved.status !== 'active') {
    throw new TenantResolutionError('This domain is not configured for any active organization', 404)
  }

  if (bodyTenantId && bodyTenantId !== resolved.tenantId) {
    throw new TenantResolutionError(
      'tenantId in request body does not match the resolved custom domain',
      400,
    )
  }

  return {
    source: 'host',
    tenantId: resolved.tenantId,
    organizationId: resolved.organizationId,
    hostname,
  }
}
