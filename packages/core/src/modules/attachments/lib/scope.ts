export type AttachmentScopePair = {
  organizationId: string | null
  tenantId: string | null
}

export type AttachmentScopeCandidate = {
  organizationId?: string | null
  tenantId?: string | null
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return value ?? null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isValidAttachmentScopePair(candidate: AttachmentScopeCandidate): boolean {
  const organizationId = normalizeScopeValue(candidate.organizationId)
  const tenantId = normalizeScopeValue(candidate.tenantId)
  return (organizationId === null) === (tenantId === null)
}

/**
 * Returns the first candidate whose tenant/organization columns form a valid
 * "both set or both null" scope pair (blank/whitespace treated as null), or
 * `null` when no candidate satisfies the invariant. Copy/clone sites use this
 * to carry a scope pair across as a unit instead of coalescing the two columns
 * independently, which is what allows a partial-null row to be constructed.
 */
export function resolveAttachmentScopePair(
  ...candidates: Array<AttachmentScopeCandidate | null | undefined>
): AttachmentScopePair | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    const organizationId = normalizeScopeValue(candidate.organizationId)
    const tenantId = normalizeScopeValue(candidate.tenantId)
    if ((organizationId === null) === (tenantId === null)) {
      return { organizationId, tenantId }
    }
  }
  return null
}
