import { randomUUID } from 'node:crypto'
import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '../data/entities'

export function organizationSlugFilter(slug: string) {
  return { [raw(alias => `lower(${alias}.slug)`).key]: raw('lower(?)', [slug]) }
}

export function isOrganizationSlugConflict(error: unknown): boolean {
  return isUniqueViolation(error, 'organizations_live_slug_uniq')
    || isUniqueViolation(error, 'organizations_tenant_slug_uniq')
}

export async function allocateOrganizationSlug(
  em: EntityManager,
  tenantId: string,
  baseSlug: string,
  options: { excludeId?: string; reserved?: ReadonlySet<string> } = {},
): Promise<string> {
  const maxLength = 150
  const maxAttempts = 50
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt}`
    const candidate = `${baseSlug.slice(0, maxLength - suffix.length)}${suffix}`
    if (options.reserved?.has(candidate)) continue
    const existing = await em.count(Organization, {
      [raw(alias => `lower(${alias}.slug)`).key]: candidate,
      $or: [{ deletedAt: null }, { tenant: tenantId }],
      ...(options.excludeId ? { id: { $ne: options.excludeId } } : {}),
    })
    if (!existing) return candidate
  }
  const suffix = `-${randomUUID()}`
  return `${baseSlug.slice(0, maxLength - suffix.length)}${suffix}`
}
