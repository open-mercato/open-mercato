import { z } from 'zod'

export const costCenterCreateSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
})
export type CostCenterCreateInput = z.infer<typeof costCenterCreateSchema>

export const costCenterUpdateSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
})
export type CostCenterUpdateInput = z.infer<typeof costCenterUpdateSchema>

// Not explicitly named in the spec's own Commands list (only
// create/update are) — disclosed scope addition, matching this repo's
// convention of declaring a full CRUD triple (see ledger's own events.ts
// comment on `ledger_account.deleted`).
export const costCenterDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
})
export type CostCenterDeleteInput = z.infer<typeof costCenterDeleteSchema>

export const defaultAccountPostingRuleCreateSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  sourceAccountId: z.uuid(),
  targetAccountId: z.uuid(),
  defaultCostCenterId: z.uuid().nullable().optional(),
})
export type DefaultAccountPostingRuleCreateInput = z.infer<typeof defaultAccountPostingRuleCreateSchema>

export const defaultAccountPostingRuleUpdateSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  targetAccountId: z.uuid().optional(),
  defaultCostCenterId: z.uuid().nullable().optional(),
})
export type DefaultAccountPostingRuleUpdateInput = z.infer<typeof defaultAccountPostingRuleUpdateSchema>

// Declared alongside create/update, matching this repo's convention of
// declaring a full CRUD triple even when a schema is thin (see ledger's
// own events.ts comment on `ledger_account.deleted`) — not named in the
// spec's own Commands list, which only names create/update explicitly;
// disclosed as a minor, defensible scope addition (reference data that
// can be created should also be removable), same posture as
// `CostCenter`'s own delete command.
export const defaultAccountPostingRuleDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
})
export type DefaultAccountPostingRuleDeleteInput = z.infer<typeof defaultAccountPostingRuleDeleteSchema>

// `updatePostingRulesSettings` — upsert-only, no create, the same shape
// `updateFixedAssetSettings` is modeled after in the spec (see Design
// Decisions, "New settings: `PostingRulesSettings`"). Both account fields
// are nullable and independently settable/clearable.
export const updatePostingRulesSettingsSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  clearingAccountId: z.uuid().nullable().optional(),
  unallocatedCostAccountId: z.uuid().nullable().optional(),
})
export type UpdatePostingRulesSettingsInput = z.infer<typeof updatePostingRulesSettingsSchema>

export const reconcileCostRingSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  // Optional — omitted means "every fiscal period", matching
  // `findUnreclassifiedEntries`'s own unbounded absence-based scan (see
  // the spec's Design Decisions, "A repair mechanism").
  periodId: z.uuid().nullable().optional(),
})
export type ReconcileCostRingInput = z.infer<typeof reconcileCostRingSchema>

// `posting_rules.lockFiscalPeriod` — this module's own guarded period
// close, distinct from `ledger.lockFiscalPeriod`. Same input shape as the
// underlying `ledger` command it delegates to on success.
export const postingRulesLockFiscalPeriodSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  periodId: z.uuid(),
})
export type PostingRulesLockFiscalPeriodInput = z.infer<typeof postingRulesLockFiscalPeriodSchema>
