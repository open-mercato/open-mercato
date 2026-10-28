import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { Scope } from './productUse'

export const CREDIT_MEMO_FEATURE = 'sales.credit_memos.manage'

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export async function hasCreditPermission(container: AwilixContainer, auth: AuthContext | null, scope: Scope): Promise<boolean> {
  if (!auth?.sub) return false
  if (auth.isSuperAdmin === true) return true
  try {
    const rbac = container.resolve('rbacService') as RbacLike
    return await rbac.userHasAllFeatures(auth.sub, [CREDIT_MEMO_FEATURE], scope)
  } catch {
    return false
  }
}
