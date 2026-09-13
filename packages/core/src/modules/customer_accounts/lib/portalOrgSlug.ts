// Server-only resolution of the signed-in admin's organization slug, used to
// build the "Open Portal" link on the customer-accounts admin pages.
//
// Deliberately kept out of `portalUrl.ts`: that module is imported by client
// components, and pulling the ORM in there would drag MikroORM into the browser
// bundle. Keep every EntityManager import on this side of the boundary.

import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { findOrganizationInTenant } from './organizationLookup'

type EntityManagerResolver = {
  resolve(name: 'em'): EntityManager
}

/**
 * Resolve the slug of the organization the current admin session is scoped to,
 * or null when there is no session, no active organization, or the organization
 * has no slug yet. Callers render the portal link only for a non-null result —
 * a slugless portal URL cannot resolve (#5668).
 */
export async function resolveCurrentOrgPortalSlug(): Promise<string | null> {
  try {
    const auth = await getAuthFromCookies()
    const organizationId = auth?.orgId
    const tenantId = auth?.tenantId
    if (!organizationId || !tenantId) return null

    const container = await createRequestContainer()
    const em = (container as Awaited<ReturnType<typeof createRequestContainer>> & EntityManagerResolver).resolve('em')
    const organization = await findOrganizationInTenant(em, organizationId, tenantId)
    const slug = organization?.slug?.trim()
    return slug && slug.length > 0 ? slug : null
  } catch {
    // The portal link is a convenience action — a lookup failure must not take
    // the whole admin page down, so degrade to hiding the button.
    return null
  }
}
