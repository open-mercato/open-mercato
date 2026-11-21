import { z } from 'zod'

// Validation messages. zod's built-in checks (`.min`/`.max`/`.uuid`) carry no
// `params` bag onto their issue, so `translateZodIssues` (crud/factory.ts)
// cannot translate them; a rule a user can trip from a form is written as a
// `.refine()` with `params: { i18nKey, i18nFallback }` (the ledger validators'
// convention). Ids are picked from lists or set by the route from the request
// scope, never typed by a user, so their shape messages carry the `[internal]`
// prefix instead.
function idSchema(field: string) {
  return z.uuid(`[internal] ${field} must be a UUID`)
}

function boundedText(max: number, requiredKey: string, requiredFallback: string, tooLongKey: string, tooLongFallback: string) {
  return z
    .string('[internal] expected a string')
    .refine((value) => value.length >= 1, {
      message: requiredFallback,
      params: { i18nKey: requiredKey, i18nFallback: requiredFallback },
    })
    .refine((value) => value.length <= max, {
      message: tooLongFallback,
      params: { i18nKey: tooLongKey, i18nFallback: tooLongFallback },
    })
}

const costCenterCodeSchema = boundedText(
  100,
  'posting_rules.errors.costCenterCodeRequired',
  'Code is required.',
  'posting_rules.errors.costCenterCodeTooLong',
  'Code must be at most 100 characters.',
)

const costCenterNameSchema = boundedText(
  200,
  'posting_rules.errors.costCenterNameRequired',
  'Name is required.',
  'posting_rules.errors.costCenterNameTooLong',
  'Name must be at most 200 characters.',
)

export const costCenterCreateSchema = z.object({
  organizationId: idSchema('organizationId'),
  tenantId: idSchema('tenantId'),
  code: costCenterCodeSchema,
  name: costCenterNameSchema,
  isActive: z.boolean('[internal] isActive must be a boolean').optional(),
})
export type CostCenterCreateInput = z.infer<typeof costCenterCreateSchema>

export const costCenterUpdateSchema = z.object({
  id: idSchema('id'),
  organizationId: idSchema('organizationId').optional(),
  tenantId: idSchema('tenantId').optional(),
  code: costCenterCodeSchema.optional(),
  name: costCenterNameSchema.optional(),
  isActive: z.boolean('[internal] isActive must be a boolean').optional(),
})
export type CostCenterUpdateInput = z.infer<typeof costCenterUpdateSchema>

// Not explicitly named in the spec's own Commands list (only
// create/update are) — disclosed scope addition, matching this repo's
// convention of declaring a full CRUD triple (see ledger's own events.ts
// comment on `ledger_account.deleted`).
export const costCenterDeleteSchema = z.object({
  id: idSchema('id'),
  organizationId: idSchema('organizationId').optional(),
  tenantId: idSchema('tenantId').optional(),
})
export type CostCenterDeleteInput = z.infer<typeof costCenterDeleteSchema>

export const defaultAccountPostingRuleCreateSchema = z.object({
  organizationId: idSchema('organizationId'),
  tenantId: idSchema('tenantId'),
  sourceAccountId: idSchema('sourceAccountId'),
  targetAccountId: idSchema('targetAccountId'),
  defaultCostCenterId: idSchema('defaultCostCenterId').nullable().optional(),
})
export type DefaultAccountPostingRuleCreateInput = z.infer<typeof defaultAccountPostingRuleCreateSchema>

export const defaultAccountPostingRuleUpdateSchema = z.object({
  id: idSchema('id'),
  organizationId: idSchema('organizationId').optional(),
  tenantId: idSchema('tenantId').optional(),
  targetAccountId: idSchema('targetAccountId').optional(),
  defaultCostCenterId: idSchema('defaultCostCenterId').nullable().optional(),
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
  id: idSchema('id'),
  organizationId: idSchema('organizationId').optional(),
  tenantId: idSchema('tenantId').optional(),
})
export type DefaultAccountPostingRuleDeleteInput = z.infer<typeof defaultAccountPostingRuleDeleteSchema>

// `updatePostingRulesSettings` — upsert-only, no create, the same shape
// `updateFixedAssetSettings` is modeled after in the spec (see Design
// Decisions, "New settings: `PostingRulesSettings`"). Both account fields
// are nullable and independently settable/clearable.
export const updatePostingRulesSettingsSchema = z.object({
  organizationId: idSchema('organizationId'),
  tenantId: idSchema('tenantId'),
  clearingAccountId: idSchema('clearingAccountId').nullable().optional(),
  unallocatedCostAccountId: idSchema('unallocatedCostAccountId').nullable().optional(),
})
export type UpdatePostingRulesSettingsInput = z.infer<typeof updatePostingRulesSettingsSchema>
