import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { DisplayProfileResolver } from './resolve-display-profile'

const logger = createLogger('markets').child({ component: 'request-profile' })

type ResolverContainer = { resolve<T>(name: string): T }

/**
 * The market display profile for a scope, from a container a server route already holds.
 *
 * Soft-optional by design (the pattern from `packages/core/AGENTS.md`): without the `markets`
 * module there is no resolver, and `null` means the caller renders the legacy defaults. Never
 * throws - a display setting must not be able to fail a data request.
 */
export async function resolveDisplayProfileForScope(
  container: ResolverContainer,
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<DisplayProfile | null> {
  if (!scope.tenantId || !scope.organizationId) return null
  try {
    const resolver = container.resolve<DisplayProfileResolver>('displayProfileResolver')
    return await resolver.resolve({ tenantId: scope.tenantId, organizationId: scope.organizationId })
  } catch {
    return null
  }
}

/**
 * The signed-in caller's market display profile, for a server component.
 *
 * Returns `null` for an anonymous visitor, for an organization that never picked a market, and
 * when the `markets` module is not installed - all three mean the same thing to a consumer: render
 * the legacy defaults. Never throws: a display setting must not be able to break a page render.
 */
export async function resolveDisplayProfileForRequest(): Promise<DisplayProfile | null> {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId || !auth.orgId) return null
    const container = await createRequestContainer()
    let resolver: DisplayProfileResolver
    try {
      resolver = container.resolve<DisplayProfileResolver>('displayProfileResolver')
    } catch {
      // Soft-optional peer: without `markets` there is no resolver, and no market.
      return null
    }
    return await resolver.resolve({ tenantId: auth.tenantId, organizationId: auth.orgId })
  } catch (error) {
    logger.warn('Failed to resolve the display profile for this request', { err: error })
    return null
  }
}
