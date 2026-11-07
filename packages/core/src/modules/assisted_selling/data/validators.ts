import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

// Release 5 (S10, D-R5-15): the validator refuses `ai`/`both` outright, even though the entity's
// own `mode` column keeps the full `ai | rep | both | off` enum reserved for Phase 3
// (`data/entities.ts`). This is the write-path guard the spec's finding describes: a store can
// never be put into an AI-authoring mode without an AI actor behind it in this release.
export const assistedSellingReleaseModeSchema = z.enum(['rep', 'off'])
export type AssistedSellingReleaseMode = z.infer<typeof assistedSellingReleaseModeSchema>

// §5.6: `PUT /settings/:storeId` is `.strict()` over exactly these five fields — a body carrying
// an `ai_*` field (or any other settings column) is a `400`, since nothing in Release 5 reads
// those columns yet.
export const assistedSellingStoreSettingsUpdateSchema = z
  .object({
    mode: assistedSellingReleaseModeSchema.optional(),
    proposalTtlSeconds: z.coerce.number().int().min(3600).max(1209600).optional(),
    maxProposalLines: z.coerce.number().int().min(1).max(500).optional(),
    conversationRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    idleCloseDays: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict()
export type AssistedSellingStoreSettingsUpdateInput = z.infer<typeof assistedSellingStoreSettingsUpdateSchema>

export const assistedSellingStoreSettingsSaveSchema = scopedSchema
  .merge(assistedSellingStoreSettingsUpdateSchema)
  .extend({ storeId: uuid() })
  .strict()
export type AssistedSellingStoreSettingsSaveInput = z.infer<typeof assistedSellingStoreSettingsSaveSchema>

// ---------------------------------------------------------------------------
// Step 4.4 — staff thread/proposal request bodies (§6.1, §6.3, §6.4). `.strict()` throughout
// per §6.3's own "a request that still sends [a disallowed] field is a 400, not a silently
// ignored value" discipline.
// ---------------------------------------------------------------------------

const clearableUuid = () => z.preprocess((value) => (value === '' ? null : value), uuid().nullable().optional())
const decimalString = () => z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal string')
const jsonRecord = () => z.record(z.string(), z.unknown())
// §6.3: "note? ... plain text, ≤ 2000 chars".
const optionalNote = () => z.string().trim().max(2000).optional()

/** `POST /threads` (§6.1). Opens a conversation about a basket by cart id. `message` is this
 * Step's own additive, minimal shape for §6.1's "posts an opening message" — the spec names
 * the behaviour but not a literal body field, so an optional, bounded free-text field (empty
 * when omitted, same "empty when none was given" convention §6.3 step 7 applies to the
 * authoring `note`) is the smallest faithful reading. See NOTIFY.md's Step 4.4 entry. */
export const assistedSellingThreadOpenRequestSchema = z
  .object({
    cartId: uuid(),
    message: optionalNote(),
  })
  .strict()
export type AssistedSellingThreadOpenRequest = z.infer<typeof assistedSellingThreadOpenRequestSchema>

export const assistedSellingProposalAuthorLineSchema = z
  .object({
    productId: uuid(),
    variantId: clearableUuid(),
    quantity: decimalString(),
    configuration: jsonRecord().nullable().optional(),
  })
  .strict()
export type AssistedSellingProposalAuthorLine = z.infer<typeof assistedSellingProposalAuthorLineSchema>

export const ASSISTED_SELLING_IDEMPOTENCY_KEY_MIN_LENGTH = 8
export const ASSISTED_SELLING_IDEMPOTENCY_KEY_MAX_LENGTH = 128

const idempotencyKeySchema = z
  .string()
  .min(ASSISTED_SELLING_IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(ASSISTED_SELLING_IDEMPOTENCY_KEY_MAX_LENGTH)

/** `POST /threads/:id/proposals` (§6.3). `lines` is capped at 100 here (mirrors `cart`'s own
 * `cartProposalCreateLinesSchema` 1..100 cap) — the store's own `max_proposal_lines` (§5.6,
 * default 50) is the tighter, store-configurable bound enforced at the command layer. */
export const assistedSellingProposalAuthorRequestSchema = z
  .object({
    lines: z.array(assistedSellingProposalAuthorLineSchema).min(1).max(100),
    note: optionalNote(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
export type AssistedSellingProposalAuthorRequest = z.infer<typeof assistedSellingProposalAuthorRequestSchema>

/** `POST /proposals/:id/withdraw` (§6.4). `updatedAt` is the body-carried optimistic-lock
 * value; the standard header form is accepted too (`commands/shared.ts`). */
export const assistedSellingProposalWithdrawRequestSchema = z
  .object({
    updatedAt: z.string().optional(),
  })
  .strict()
export type AssistedSellingProposalWithdrawRequest = z.infer<typeof assistedSellingProposalWithdrawRequestSchema>

/** `POST /proposals/:id/reauthor` (§6.4). */
export const assistedSellingProposalReauthorRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    note: optionalNote(),
  })
  .strict()
export type AssistedSellingProposalReauthorRequest = z.infer<typeof assistedSellingProposalReauthorRequestSchema>

// ---------------------------------------------------------------------------
// Step 5.3 — the remaining staff thread routes the console needs (§6.1, §7.1): join, leave,
// assign, and posting a plain-text message. `.strict()` throughout, same discipline as every
// other Release 5 request body.
// ---------------------------------------------------------------------------

/** `POST /threads/:id/join` (§6.1). No body fields named by the spec. */
export const assistedSellingThreadJoinRequestSchema = z.object({}).strict()
export type AssistedSellingThreadJoinRequest = z.infer<typeof assistedSellingThreadJoinRequestSchema>

/** `POST /threads/:id/leave` (§6.1). No body fields named by the spec. */
export const assistedSellingThreadLeaveRequestSchema = z.object({}).strict()
export type AssistedSellingThreadLeaveRequest = z.infer<typeof assistedSellingThreadLeaveRequestSchema>

/** `POST /threads/:id/assign` (§6.1). `actorId` omitted assigns the caller ("assign to me");
 * an explicit `actorId` reassigns to a named rep. Optimistic-locked on the thread's
 * `updated_at` — "two reps claiming the same conversation get one success and one 409". */
export const assistedSellingThreadAssignRequestSchema = z
  .object({
    actorId: uuid().optional(),
    updatedAt: z.string().optional(),
  })
  .strict()
export type AssistedSellingThreadAssignRequest = z.infer<typeof assistedSellingThreadAssignRequestSchema>

/** `POST /threads/:id/messages` (§6.1). `body_format: 'text'` only (S24) — the staff-side
 * counterpart of `assistedSellingBuyerMessagePostRequestSchema`. */
export const assistedSellingMessagePostRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    bodyFormat: z.literal('text').optional(),
  })
  .strict()
export type AssistedSellingMessagePostRequest = z.infer<typeof assistedSellingMessagePostRequestSchema>

// ---------------------------------------------------------------------------
// Step 4.5 — buyer thread request bodies (§6.2). Public, cart-token bound; `.strict()`
// throughout, same discipline as the staff bodies above.
// ---------------------------------------------------------------------------

/** `POST /thread` (§6.2). No body fields named by the spec's own table — an empty object,
 * `.strict()` so an unexpected field is a `400` rather than silently ignored. */
export const assistedSellingBuyerThreadOpenRequestSchema = z.object({}).strict()
export type AssistedSellingBuyerThreadOpenRequest = z.infer<typeof assistedSellingBuyerThreadOpenRequestSchema>

/** `POST /thread/messages` (§6.2). `bodyFormat`, when present, MUST be `'text'` (S24) — any
 * other value is a `400`, never silently coerced. */
export const assistedSellingBuyerMessagePostRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    bodyFormat: z.literal('text').optional(),
  })
  .strict()
export type AssistedSellingBuyerMessagePostRequest = z.infer<typeof assistedSellingBuyerMessagePostRequestSchema>
