import type { EntityManager } from '@mikro-orm/postgresql'
import type { Module } from '@open-mercato/shared/modules/registry'
import { hasFeature } from '@open-mercato/shared/security/features'
import { z } from 'zod'
import {
  CustomerRole,
  CustomerRoleAcl,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

const declaredCustomerRoleFeaturesSchema = z.record(
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)),
)

export type CustomerRoleAclSyncEntry = {
  roleSlug: string
  roleName: string
  addedFeatures: string[]
}

/**
 * Collects `defaultCustomerRoleFeatures` from every enabled module, keyed by
 * customer role slug. Third-party modules can declare anything, so the shape is
 * validated rather than trusted; a malformed declaration is skipped instead of
 * poisoning the whole sync.
 */
export function collectDefaultCustomerRoleFeatures(modules: Module[]): Record<string, string[]> {
  const featuresByRole: Record<string, string[]> = {}
  for (const mod of modules) {
    const declared = mod.setup?.defaultCustomerRoleFeatures
    if (!declared) continue
    const parsed = declaredCustomerRoleFeaturesSchema.safeParse(declared)
    if (!parsed.success) continue
    for (const [roleSlug, features] of Object.entries(parsed.data)) {
      if (!features.length) continue
      const bucket = featuresByRole[roleSlug] ?? []
      bucket.push(...features)
      featuresByRole[roleSlug] = bucket
    }
  }
  for (const roleSlug of Object.keys(featuresByRole)) {
    featuresByRole[roleSlug] = Array.from(new Set(featuresByRole[roleSlug]))
  }
  return featuresByRole
}

/**
 * Merges the modules' declared `defaultCustomerRoleFeatures` into the matching
 * `CustomerRoleAcl` rows of a single tenant.
 *
 * Contract, relied on by both tenant setup and `mercato customer_accounts
 * sync-customer-role-acls`:
 * - additive only — a feature an operator added by hand is never removed;
 * - never creates a `CustomerRole` or a `CustomerRoleAcl`, so a slug with no
 *   matching seeded role is a no-op;
 * - wildcard-aware — a role already holding `portal.*` (or `*`) does not gain a
 *   redundant concrete grant;
 * - idempotent — a second run finds nothing left to add and writes nothing.
 */
export async function syncDefaultCustomerRoleAcls(
  em: EntityManager,
  tenantId: string,
  modules: Module[],
): Promise<CustomerRoleAclSyncEntry[]> {
  const featuresByRole = collectDefaultCustomerRoleFeatures(modules)
  const roleSlugs = Object.keys(featuresByRole)
  if (!roleSlugs.length) return []

  const applied: CustomerRoleAclSyncEntry[] = []
  for (const roleSlug of roleSlugs) {
    const role = await em.findOne(CustomerRole, { tenantId, slug: roleSlug, deletedAt: null })
    if (!role) continue
    const acl = await em.findOne(CustomerRoleAcl, { role, tenantId })
    if (!acl) continue

    const currentFeatures = Array.isArray(acl.featuresJson) ? acl.featuresJson : []
    const addedFeatures: string[] = []
    for (const feature of featuresByRole[roleSlug]) {
      if (hasFeature(currentFeatures, feature)) continue
      if (hasFeature(addedFeatures, feature)) continue
      addedFeatures.push(feature)
    }
    if (!addedFeatures.length) continue

    acl.featuresJson = [...currentFeatures, ...addedFeatures]
    em.persist(acl)
    applied.push({ roleSlug, roleName: role.name, addedFeatures })
  }

  if (applied.length) await em.flush()
  return applied
}
