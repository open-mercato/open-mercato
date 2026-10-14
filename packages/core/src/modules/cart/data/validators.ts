import { z } from 'zod'

// Mirrors promotions/data/validators.ts's helper set — kept minimal to what this step's
// entities actually need validated at the data layer. A full command-input surface
// (cart.create, cart.lines.add, etc., §3.1a) lands in Steps 4.5/4.6; these schemas are
// deliberately thinner than that.

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
