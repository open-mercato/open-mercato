import type { AwilixContainer } from 'awilix'
import type { DisplayProfile } from '../display/profile'

type DisplayProfileResolver = {
  resolve: (scope: { tenantId: string; organizationId: string }) => Promise<DisplayProfile | null>
}

/**
 * The organization's market display profile for an export, or `null` when there is none.
 *
 * Resolved through the DI token so `@open-mercato/shared` stays free of domain imports - it cannot
 * depend on the `markets` module, and does not need to: without that module there is no resolver,
 * and `null` means every export renders exactly as it does today.
 *
 * Never throws. A display setting must not be able to fail an export.
 */
export async function resolveExportDisplayProfile(
  container: AwilixContainer | { resolve<T>(name: string): T } | null | undefined,
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<DisplayProfile | null> {
  if (!container || !scope.tenantId || !scope.organizationId) return null
  try {
    const resolver = (container as { resolve<T>(name: string): T }).resolve<DisplayProfileResolver>(
      'displayProfileResolver',
    )
    return await resolver.resolve({ tenantId: scope.tenantId, organizationId: scope.organizationId })
  } catch {
    return null
  }
}
