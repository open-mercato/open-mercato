export type RoleAclEditorValues = Record<string, unknown>

export type RoleAclProposalValues = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GROUP_KEY_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(users|api_keys)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * The role permission preview proposal of the CURRENT role ACL editor data (the role editor's
 * `auth.role.acl:*` injection data, exactly what its Save sends to `PUT /api/auth/roles/acl`):
 * role id, super-admin flag, features and organizations (`null` = every organization).
 */
export function buildRoleAclProposal(values: RoleAclEditorValues): Record<string, unknown> {
  return {
    roleId: values.roleId,
    isSuperAdmin: values.isSuperAdmin === true,
    features: readStringList(values.features),
    organizations: Array.isArray(values.organizations) ? readStringList(values.organizations) : null,
  }
}

/**
 * The editor values of a simulated role permission proposal (the inverse of
 * `buildRoleAclProposal`), or `null` when the run's proposal is not one for `roleId`.
 */
export function roleAclProposalToValues(proposal: unknown, roleId?: string | null): RoleAclProposalValues | null {
  if (!isRecord(proposal)) return null
  if (typeof proposal.roleId !== 'string' || !UUID_PATTERN.test(proposal.roleId)) return null
  if (roleId && proposal.roleId.toLowerCase() !== roleId.toLowerCase()) return null
  if (typeof proposal.isSuperAdmin !== 'boolean' || !Array.isArray(proposal.features)) return null
  if (proposal.organizations !== null && !Array.isArray(proposal.organizations)) return null
  return {
    isSuperAdmin: proposal.isSuperAdmin,
    features: readStringList(proposal.features),
    organizations: Array.isArray(proposal.organizations) ? readStringList(proposal.organizations) : null,
  }
}

export type RoleAclGroupDescription = {
  organizationId: string | null
  principalType: 'users' | 'api_keys' | null
}

/** A result group key of the role permission preview: `<organizationId>:users` or `:api_keys`. */
export function describeRoleAclGroup(groupKey: string): RoleAclGroupDescription {
  const match = GROUP_KEY_PATTERN.exec(groupKey)
  if (!match) return { organizationId: null, principalType: null }
  return { organizationId: match[1].toLowerCase(), principalType: match[2].toLowerCase() === 'users' ? 'users' : 'api_keys' }
}
