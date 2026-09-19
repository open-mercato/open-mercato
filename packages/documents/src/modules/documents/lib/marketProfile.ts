import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'

type ResolverContainer = { resolve<T>(name: string): T }

type DisplayProfileResolver = {
  resolve: (scope: { tenantId: string; organizationId: string }) => Promise<DisplayProfile | null>
}

/**
 * The organization's market display profile, or `null` when there is none.
 *
 * Resolved through the DI token rather than by importing the `markets` module: `documents` does not
 * depend on `@open-mercato/core`, and a page size is not a reason to make it. Without the module
 * installed there is no resolver, and `null` means "render the legacy defaults" - which for a PDF
 * is A4, exactly as before.
 *
 * Never throws. A display setting must not be able to fail an export.
 */
export async function resolveMarketDisplayProfile(
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
