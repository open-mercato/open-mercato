import { z } from 'zod'

/**
 * The closed set of dimension types a caller may set on a journal entry
 * line. An open string, not a DB enum — the `dimension_type` column stays
 * `text`, so adding a fifth type here is a one-line constant change plus a
 * Zod-boundary deploy, not a migration (see the spec's Design Decisions,
 * "Corrected this round — closed enum, not `z.string().min(1)`").
 */
export const DIMENSION_TYPES = ['CostCenter', 'BankAccount', 'FixedAsset', 'Currency'] as const

export type DimensionType = (typeof DIMENSION_TYPES)[number]

/**
 * Input schema for the `setJournalEntryLineDimension` command. Replaces only
 * the rows for one `(journalEntryLineId, dimensionType)` pair — every other
 * dimension type already set on the same line is left untouched (see the
 * spec's Design Decisions, "Writes are scoped per dimension type").
 *
 * `dimensionIds` deliberately does NOT validate each entry as a uuid: the
 * `'Currency'` dimension type's one real, shipped target (`currencies`/
 * `sales` currency rows) is identified by ISO code, not a uuid — a
 * `.uuid()` validator here would reject every currency dimension at the
 * boundary (see the spec's Design Decisions, "corrected, m3").
 */
export const setJournalEntryLineDimensionSchema = z
  .object({
    journalEntryLineId: z.string().uuid(),
    dimensionType: z.enum(DIMENSION_TYPES),
    dimensionIds: z.array(z.string().min(1)).min(1),
    // Optional scope override for trusted, in-process systemActor callers
    // (`ctx.auth: null`, e.g. `posting_rules`' `reclassify.ts` engine, which
    // "posts on nobody's behalf") -- `resolveScope` in the command below
    // only falls back to these when `ctx.auth` carries no tenantId, matching
    // the same trusted-caller shape `warranty_claims`' own
    // `create_vendor_recovery`/`VendorRecoveryInput.tenantId` already relies
    // on for its own systemActor subscriber call
    // (`auto-vendor-recovery.ts`). A real end-user HTTP request always
    // carries `ctx.auth`, so these fields are never consulted for one.
    tenantId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
  })
  .refine((v) => new Set(v.dimensionIds).size === v.dimensionIds.length, {
    message: 'dimensionIds must not contain duplicates',
    path: ['dimensionIds'],
  })

export type SetJournalEntryLineDimensionInput = z.infer<typeof setJournalEntryLineDimensionSchema>
