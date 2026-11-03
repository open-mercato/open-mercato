/**
 * Merging every enabled module's `setup.defaultCustomerRoleFeatures` into the
 * `CustomerRoleAcl` rows a tenant already has.
 *
 * The staff side of this has always had two entry points: tenant bootstrap, and
 * `mercato auth sync-role-acls` for tenants that already existed when a module
 * declared a new feature. The customer side only ever ran at bootstrap, so a
 * portal feature shipped after a tenant was created never reached the `Buyer` and
 * `Viewer` roles that tenant is actually using — the page was simply invisible to
 * every real customer until somebody granted it by hand. It lives here rather than
 * in `setup.ts` so both entry points can call the same merge.
 *
 * Additive and idempotent: a feature is only ever added, never removed, and a role
 * or ACL row that does not exist is skipped rather than created — seeding roles is
 * `seedDefaultRoles`' job.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { Module } from '@open-mercato/shared/modules/registry'
import {
  CustomerRole,
  CustomerRoleAcl,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

export type CustomerRoleAclSyncResult = {
  /** Role slugs whose ACL row gained at least one feature. */
  updatedRoleSlugs: string[]
  /** Features added, across every role, deduplicated — what to report to an operator. */
  addedFeatures: string[]
}

export async function ensureDefaultCustomerRoleAcls(
  em: EntityManager,
  tenantId: string,
  modules: Module[],
): Promise<CustomerRoleAclSyncResult> {
  const featuresByRole: Record<string, string[]> = {}

  for (const mod of modules) {
    const customerRoleFeatures = mod.setup?.defaultCustomerRoleFeatures
    if (!customerRoleFeatures) continue
    for (const [roleSlug, features] of Object.entries(customerRoleFeatures)) {
      if (!features || !features.length) continue
      if (!featuresByRole[roleSlug]) featuresByRole[roleSlug] = []
      featuresByRole[roleSlug].push(...features)
    }
  }

  const result: CustomerRoleAclSyncResult = { updatedRoleSlugs: [], addedFeatures: [] }
  const roleSlugs = Object.keys(featuresByRole)
  if (!roleSlugs.length) return result

  const added = new Set<string>()
  for (const roleSlug of roleSlugs) {
    const role = await em.findOne(CustomerRole, { tenantId, slug: roleSlug, deletedAt: null })
    if (!role) continue

    const acl = await em.findOne(CustomerRoleAcl, { role: role.id as any, tenantId })
    if (!acl) continue

    const currentFeatures = Array.isArray(acl.featuresJson) ? acl.featuresJson : []
    const merged = Array.from(new Set([...currentFeatures, ...featuresByRole[roleSlug]]))
    const changed =
      merged.length !== currentFeatures.length ||
      merged.some((value, index) => value !== currentFeatures[index])
    if (!changed) continue

    const known = new Set(currentFeatures)
    acl.featuresJson = merged
    em.persist(acl)
    result.updatedRoleSlugs.push(roleSlug)
    for (const feature of merged) {
      if (!known.has(feature)) added.add(feature)
    }
  }
  result.addedFeatures = Array.from(added)
  await em.flush()
  return result
}
