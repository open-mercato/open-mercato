import type { FilterQuery } from '@mikro-orm/postgresql'
import type { SudoChallengeConfig } from '../data/entities'

export type SudoAuthScope = {
  isSuperAdmin?: boolean
  tenantId: string | null
  organizationId?: string | null
}

type ConfigAuthority =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string; organizationId: string | null }
  | { kind: 'unselected' }

export function configAuthority(scope?: SudoAuthScope): ConfigAuthority {
  // Internal service callers may omit the scope. Commands pass an explicit scope.
  if (!scope || scope.isSuperAdmin === true) return { kind: 'platform' }
  if (!scope.tenantId) return { kind: 'unselected' }
  return { kind: 'tenant', tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }
}

export function sudoConfigMutationCriteria(
  id: string,
  scope?: SudoAuthScope,
): FilterQuery<SudoChallengeConfig> | null {
  const authority = configAuthority(scope)
  if (authority.kind === 'unselected') return null

  const criteria = { id, deletedAt: null }
  if (authority.kind === 'platform') return criteria
  return {
    ...criteria,
    tenantId: authority.tenantId,
    isDeveloperDefault: false,
    ...(authority.organizationId === null ? {} : {
      $or: [{ organizationId: null }, { organizationId: authority.organizationId }],
    }),
  }
}
