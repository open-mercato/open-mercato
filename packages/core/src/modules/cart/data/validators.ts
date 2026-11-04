import { z } from 'zod'

// Mirrors promotions/data/validators.ts's helper set — kept minimal to what this step's
// entities actually need validated at the data layer. A full command-input surface
// (cart.create, cart.lines.add, etc., §3.1a) lands in Steps 4.5/4.6; these schemas are
// deliberately thinner than that.
//
// Public request-body schema convention (§6a.1a, D-R4-1/D-R4-2 — binding for Step 4.7,
// which is where the first real public route/schema for this module lands):
//   - Every public cart request body schema MUST be `.strict()` (zod) so an unrecognized
//     key 400s instead of being silently dropped or, worse, silently honored.
//   - No public request body schema may declare `assortmentScope`, `channel`, `storeId`
//     or `salesChannelId` as a field. Those are resolved server-side at the route edge via
//     `resolveCartRouteContext` (`cart/lib/routeContext.ts`) into the internal, branded
//     `ResolvedCartRouteContext` and passed to commands out-of-band — never through a
//     request-body field a caller could set.
//   - The cart token (§8.3, D-R4-6) travels as the `X-Cart-Token` HEADER on
//     `/api/cart/current/*`, never as a path segment, query string or body field, so there
//     is no "token schema" to add here — nothing concrete exists yet to validate for it.
//     This step (4.3) adds no new schema for that reason; the first real public body
//     schemas land in Step 4.7 and must follow the two rules above from the start.

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

// Mirrors `clearableStringSchema` in promotions/customer_groups' validators: blanking a
// previously-set value on edit must transmit null to clear it, not be silently dropped.
const clearableStringSchema = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const clearableUuidSchema = z.preprocess(emptyStringToNull, uuid().nullable().optional())

// Decimal amounts travel as strings end-to-end (§Data Models: quantity/price columns are
// numeric(16,4)/numeric(7,4)) so a caller never loses precision to IEEE-754 float
// rounding — same convention as promotions/data/validators.ts's decimalStringSchema.
const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal string')

const currencyCodeSchema = z
  .string()
  .trim()
  .length(3, 'Currency code must be an ISO 4217 3-letter code')
  .transform((value) => value.toUpperCase())

const jsonRecordSchema = z.record(z.string(), z.unknown())

// ---------------------------------------------------------------------------
// Enum fields (§4.1, §4.2, §4.3, §4.4) — the closed vocabularies this module owns.
// ---------------------------------------------------------------------------

export const cartChannelValues = ['storefront', 'pos', 'pay_link', 'agent', 'api'] as const
export const cartChannelSchema = z.enum(cartChannelValues)

export const cartKindValues = ['basket', 'proposal'] as const
export const cartKindSchema = z.enum(cartKindValues)

export const cartStatusValues = ['active', 'locked', 'converted', 'abandoned', 'expired', 'merged'] as const
export const cartStatusSchema = z.enum(cartStatusValues)

export const cartTaxModeValues = ['gross', 'net'] as const
export const cartTaxModeSchema = z.enum(cartTaxModeValues)

export const cartLineOriginValues = ['customer', 'promotion'] as const
export const cartLineOriginSchema = z.enum(cartLineOriginValues)

// Only one value exists today (§4.2); modelled as an enum rather than a literal so a
// second flag added later does not need a validator rewrite.
export const cartLineFlagStateValues = ['product_unavailable'] as const
export const cartLineFlagStateSchema = z.enum(cartLineFlagStateValues)

export const cartLineActorTypeValues = ['buyer', 'rep', 'ai_agent', 'merge', 'system'] as const
export const cartLineActorTypeSchema = z.enum(cartLineActorTypeValues)

export const cartPromotionScopeValues = ['order', 'line'] as const
export const cartPromotionScopeSchema = z.enum(cartPromotionScopeValues)

export const cartMergeStrategyValues = ['sum', 'replace', 'keep_target', 'manual'] as const
export const cartMergeStrategySchema = z.enum(cartMergeStrategyValues)

// Deliberately excludes 'merge' — CartLine.addedByActorType can name "a merge created
// this line", but a merge log entry attributing itself to "merge" would be circular.
export const cartMergeActorTypeValues = ['buyer', 'rep', 'ai_agent', 'system'] as const
export const cartMergeActorTypeSchema = z.enum(cartMergeActorTypeValues)

export const cartMergeLineDispositionValues = ['merged', 'summed', 'capped', 'declined', 'rejected'] as const
export const cartMergeLineDispositionSchema = z.enum(cartMergeLineDispositionValues)

// ---------------------------------------------------------------------------
// Cart creation (§3.1a `cart.create`) — the command-input shape, not the public HTTP
// body. The public route's `.strict()` body (§6a.1a) never carries channel/storeId/
// assortmentScope at all; those arrive via the internal `ResolvedCartRouteContext` a
// later step defines. This schema validates what the command itself persists.
// ---------------------------------------------------------------------------

export const cartCreateInputSchema = z.object({
  channel: cartChannelSchema,
  storeId: clearableUuidSchema,
  salesChannelId: clearableUuidSchema,
  currencyCode: currencyCodeSchema,
  locale: z.string().trim().min(2).max(35),
  taxMode: cartTaxModeSchema,
  customerId: clearableUuidSchema,
  customerUserId: clearableUuidSchema,
  email: clearableStringSchema(320),
})

export type CartCreateInput = z.infer<typeof cartCreateInputSchema>

// ---------------------------------------------------------------------------
// Cart line add (§3.1a `cart.lines.add`) — product_id/variant_id/quantity/configuration/
// metadata only, per this step's scope; the full input (routeContext, idempotency key,
// etc.) is a Step 4.5/4.6 concern.
// ---------------------------------------------------------------------------

export const cartLineAddInputSchema = z.object({
  cartId: uuid(),
  productId: uuid(),
  variantId: clearableUuidSchema,
  quantity: decimalStringSchema,
  configuration: jsonRecordSchema.nullable().optional(),
  metadata: jsonRecordSchema.nullable().optional(),
})

export type CartLineAddInput = z.infer<typeof cartLineAddInputSchema>

// ---------------------------------------------------------------------------
// Public HTTP request bodies for `/api/cart/current/*` (Step 4.7, §6a.1a/§8.1/§10).
// `.strict()` per D-R4-1/6 so an unrecognized key 400s. None of these carry
// `cartId` (derived from the resolved "current" cart, itself resolved from the
// `X-Cart-Token` header — never a body field), `channel`/`storeId`/
// `salesChannelId`/`assortmentScope` (server-resolved at the route edge, §6a.1a),
// or `addedByActorType`/`addedByActorId` (derived from the resolved
// `ResolvedCartRouteContext` for every storefront call — see
// `commands/lines.ts`'s `resolveLineActor`). These are deliberately separate
// schemas from `cartCreateInputSchema`/`cartLineAddInputSchema` above, which
// validate the COMMAND's own trusted input shape (including fields a public
// caller must never set), not what an HTTP body may contain.
// ---------------------------------------------------------------------------

/** `POST /current` — the body carries no fields at all today; `.strict()` still rejects an unrecognized key rather than silently ignoring it. */
export const cartCurrentCreateRequestSchema = z.object({}).strict()
export type CartCurrentCreateRequest = z.infer<typeof cartCurrentCreateRequestSchema>

/** `POST /current/lines`. */
export const cartLineAddRequestSchema = z
  .object({
    productId: uuid(),
    variantId: clearableUuidSchema,
    quantity: decimalStringSchema,
    configuration: jsonRecordSchema.nullable().optional(),
    metadata: jsonRecordSchema.nullable().optional(),
  })
  .strict()
export type CartLineAddRequest = z.infer<typeof cartLineAddRequestSchema>

/** `PATCH /current/lines/[lineId]` — §10's "Change quantity or configuration" is narrowed to quantity only: `cart.lines.update` (Step 4.6) has no configuration-change parameter at all yet. */
export const cartLineUpdateRequestSchema = z
  .object({
    quantity: decimalStringSchema,
  })
  .strict()
export type CartLineUpdateRequest = z.infer<typeof cartLineUpdateRequestSchema>

const cartLineBulkAddEntryRequestSchema = z
  .object({
    productId: uuid(),
    variantId: clearableUuidSchema,
    quantity: decimalStringSchema,
    configuration: jsonRecordSchema.nullable().optional(),
    metadata: jsonRecordSchema.nullable().optional(),
  })
  .strict()

/** `POST /current/lines/bulk`. The 100-entry cap is the command's own concern (`MAX_BULK_ADD_ENTRIES`, `commands/lines.ts`) — not duplicated here, so the two never drift. */
export const cartLineBulkAddRequestSchema = z
  .object({
    lines: z.array(cartLineBulkAddEntryRequestSchema),
  })
  .strict()
export type CartLineBulkAddRequest = z.infer<typeof cartLineBulkAddRequestSchema>

/** `POST /current/promotions` (Step 7.2, §10 "Apply code") — a plain entered code string;
 * resolution (static vs. dynamic, which promotion it unlocks) is `cart.promotions.apply`'s
 * own concern, never this schema's. */
export const cartPromotionApplyRequestSchema = z
  .object({
    codeString: z.string().trim().min(1).max(190),
  })
  .strict()
export type CartPromotionApplyRequest = z.infer<typeof cartPromotionApplyRequestSchema>

/** `POST /current/merge` (Step 7.3, §10 "Merge a guest cart into the session's cart"). The
 * spec never states this body's exact shape (checked — only the route table's one-line
 * purpose exists) — `sourceToken` is the only thing that can possibly identify the guest
 * cart, since it has no session of its own to carry the identification implicitly the way
 * the TARGET cart does via `X-Cart-Token`. Documented judgment call (Step 7.3). */
export const cartMergeRequestSchema = z
  .object({
    sourceToken: z.string().trim().min(1),
  })
  .strict()
export type CartMergeRequest = z.infer<typeof cartMergeRequestSchema>

/** `POST /current/undo-merge` — no body fields at all (mirrors `cartCurrentCreateRequestSchema`'s
 * empty-but-`.strict()` convention); the merge to undo is found by querying `CartMergeLog`
 * for the current (resolved) cart, not named by the caller. */
export const cartMergeUndoRequestSchema = z.object({}).strict()
export type CartMergeUndoRequest = z.infer<typeof cartMergeUndoRequestSchema>
