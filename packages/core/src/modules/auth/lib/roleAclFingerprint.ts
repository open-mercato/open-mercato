/**
 * The content of a role ACL that decides access (`isSuperAdmin`, features, organizations) in one
 * canonical form, shared by the server (the change simulator hashes it into the artifact
 * fingerprint) and the browser (the role editor compares it before writing an ACL that has no
 * `updatedAt` to lock on). Browser-safe: no Node APIs.
 */
export type RoleAclSnapshot = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

export const ROLE_ACL_FINGERPRINT_VERSION = 1

export const EMPTY_ROLE_ACL_SNAPSHOT: RoleAclSnapshot = { isSuperAdmin: false, features: [], organizations: null }

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const unique = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) unique.add(trimmed)
  }
  return Array.from(unique)
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Normalizes an ACL the way the role ACL write normalizes it (trimmed, de-duplicated strings; a
 * missing organization list is `null`, "every organization"), keeping the stored order.
 */
export function normalizeRoleAclSnapshot(input: {
  isSuperAdmin?: unknown
  features?: unknown
  organizations?: unknown
} | null | undefined): RoleAclSnapshot {
  if (!input) return { ...EMPTY_ROLE_ACL_SNAPSHOT, features: [] }
  return {
    isSuperAdmin: input.isSuperAdmin === true,
    features: normalizeList(input.features),
    organizations: Array.isArray(input.organizations) ? normalizeList(input.organizations) : null,
  }
}

/**
 * The canonical string of an ACL: grant order never matters, `null` organizations ("every
 * organization") stay distinct from `[]` ("none").
 */
export function roleAclFingerprintSource(snapshot: RoleAclSnapshot): string {
  const normalized = normalizeRoleAclSnapshot(snapshot)
  return JSON.stringify({
    v: ROLE_ACL_FINGERPRINT_VERSION,
    isSuperAdmin: normalized.isSuperAdmin,
    features: [...normalized.features].sort(compareCodeUnits),
    organizations: normalized.organizations === null ? null : [...normalized.organizations].sort(compareCodeUnits),
  })
}

/** Whether two ACLs grant exactly the same access. */
export function sameRoleAcl(left: RoleAclSnapshot, right: RoleAclSnapshot): boolean {
  return roleAclFingerprintSource(left) === roleAclFingerprintSource(right)
}
