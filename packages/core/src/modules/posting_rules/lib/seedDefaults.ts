import type { EntityManager } from '@mikro-orm/postgresql'
import { CostCenter, PostingRulesSettings } from '../data/entities'

export type PostingRulesSeedScope = { tenantId: string; organizationId: string }

/** The MPK priority hybrid's third, always-available path — see
 * data/entities.ts's `CostCenter` docstring and the spec's Design
 * Decisions, "The MPK (cost centre) dimension: a priority hybrid". A
 * normal row like any other, distinguished only by this well-known code —
 * no separate "system row" flag. */
export const UNALLOCATED_COST_CENTER_CODE = 'UNALLOCATED'

/**
 * Seeds, for this organization: a single, non-deletable sentinel
 * `CostCenter` (`code: 'UNALLOCATED'`) so the MPK priority hybrid's third
 * path always has something real to tag with from day one, and an empty
 * `PostingRulesSettings` row (`clearingAccountId`/`unallocatedCostAccountId`
 * both `null`), mirroring `FixedAssetSettings`'s own "seeded empty on
 * organization creation" precedent (see Module Setup / Migration &
 * Deployment — corrected 2026-09-14: no `DefaultAccountPostingRule`
 * template is seeded, since no universal 4→5 mapping can be assumed once
 * account numbering isn't standardized across tenants — see Design
 * Decisions, "4→5 rules").
 *
 * Idempotent and safe to re-run, the same `seedPolishAccountGroups`
 * lifecycle point (`setup.ts`'s `seedDefaults`, at module-enable time):
 * the sentinel `CostCenter` is upserted by its well-known `code`, and the
 * `PostingRulesSettings` row is upserted by `organizationId` — neither is
 * ever duplicated.
 */
export async function seedPostingRulesDefaults(
  em: EntityManager,
  scope: PostingRulesSeedScope,
): Promise<boolean> {
  let touched = false

  const existingSentinel = await em.findOne(CostCenter, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: UNALLOCATED_COST_CENTER_CODE,
  })
  if (!existingSentinel) {
    const now = new Date()
    const sentinel = em.create(CostCenter, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: UNALLOCATED_COST_CENTER_CODE,
      name: 'Unallocated',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(sentinel)
    touched = true
  }

  const existingSettings = await em.findOne(PostingRulesSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!existingSettings) {
    const settings = em.create(PostingRulesSettings, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      clearingAccountId: null,
      unallocatedCostAccountId: null,
      updatedAt: new Date(),
    })
    em.persist(settings)
    touched = true
  }

  if (touched) {
    await em.flush()
  }
  return touched
}
