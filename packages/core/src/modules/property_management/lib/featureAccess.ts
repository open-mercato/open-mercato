import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { Scope } from './productUse'

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export async function hasGrantedFeature(
  container: AwilixContainer,
  auth: AuthContext | null,
  scope: Scope,
  feature: string,
  failureCode: string,
): Promise<boolean> {
  if (!auth?.sub) return false
  try {
    const rbac = container.resolve('rbacService') as RbacLike
    return await rbac.userHasAllFeatures(auth.sub, [feature], scope)
  } catch (err) {
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: failureCode, attributes: { feature } })
    return false
  }
}
