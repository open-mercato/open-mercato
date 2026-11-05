/**
 * Minimal SCIM filter parser supporting `eq` operator with `and` combinator.
 * Supports: userName, externalId, displayName, active
 */

export interface ScimFilterCondition {
  attribute: string
  value: string
}

export function parseScimFilter(filter: string | null | undefined): ScimFilterCondition[] {
  if (!filter || !filter.trim()) return []

  const conditions: ScimFilterCondition[] = []
  const parts = filter.split(/\s+and\s+/i)

  for (const part of parts) {
    const match = part.trim().match(/^(\S+)\s+eq\s+"([^"]*)"$/i)
    if (!match) continue

    const [, attribute, value] = match
    const normalizedAttr = attribute.toLowerCase()

    const allowed = ['username', 'externalid', 'displayname', 'active']
    if (!allowed.includes(normalizedAttr)) continue

    conditions.push({ attribute: normalizedAttr, value })
  }

  return conditions
}

export function scimFilterToWhere(
  conditions: ScimFilterCondition[],
  ssoConfigId: string,
  organizationId: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    ssoConfigId,
    organizationId,
    deletedAt: null,
  }

  for (const { attribute, value } of conditions) {
    switch (attribute) {
      case 'username':
        where.idpEmail = value
        break
      case 'externalid':
        where.externalId = value
        break
      case 'displayname':
        where.idpName = value
        break
      case 'active':
        // Handled at application level (requires SsoUserDeactivation lookup)
        break
    }
  }

  return where
}
