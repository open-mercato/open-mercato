// Build customer-portal URLs that honor the active custom domain when present.
// All customer-facing email senders (signup welcome, magic link, password reset,
// notification digests) MUST construct links via this helper instead of
// hard-coding PLATFORM_PORTAL_BASE_URL — see customer_accounts/AGENTS.md.

import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

type DomainMappingService = {
  resolveActiveByOrg(orgId: string): Promise<{ hostname: string } | null>
}

type OrgService = {
  findById(orgId: string): Promise<{ id: string; slug: string | null } | null>
}

function platformBaseUrl(): string {
  const fromEnv = process.env.PLATFORM_PORTAL_BASE_URL?.trim()
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, '')
  // Outbound emails (welcome, magic link, password reset) embed this URL —
  // localhost in production silently sends broken links to real customers.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PLATFORM_PORTAL_BASE_URL is required in production. Configure it before sending customer-portal emails.',
    )
  }
  return 'http://localhost:3000'
}

function resolveContainer(container?: AppContainer): Promise<AppContainer> {
  if (container) return Promise.resolve(container)
  return createRequestContainer()
}

export async function urlForCustomerOrg(
  orgId: string,
  path: string,
  options?: { container?: AppContainer },
): Promise<string> {
  const safePath = path.startsWith('/') ? path : `/${path}`
  const container = await resolveContainer(options?.container)

  let active: { hostname: string } | null = null
  try {
    const service = container.resolve('domainMappingService') as DomainMappingService
    if (service && typeof service.resolveActiveByOrg === 'function') {
      active = await service.resolveActiveByOrg(orgId)
    }
  } catch {
    // domainMappingService not registered yet (fresh installs, tests) — fall through to platform URL.
    active = null
  }

  if (active && active.hostname) {
    return `https://${active.hostname}${safePath}`
  }

  let orgSlug: string | null = null
  try {
    const orgService = container.resolve('orgService') as OrgService | undefined
    if (orgService && typeof orgService.findById === 'function') {
      const org = await orgService.findById(orgId)
      orgSlug = org?.slug ?? null
    }
  } catch {
    orgSlug = null
  }

  const base = platformBaseUrl()
  if (orgSlug) return `${base}/${orgSlug}/portal${safePath}`
  return `${base}${safePath}`
}
