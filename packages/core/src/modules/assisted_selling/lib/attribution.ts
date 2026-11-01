import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { AssistedSellingAttribution, AssistedSellingProposal } from '../data/entities'
import type { AssistedSellingAttributionActorType } from '../data/entities'
import { emitAssistedSellingEvent } from '../events'
import { resolveCartService } from './cartAccess'
import type { AssistedSellingAttributionLine } from './cartAccess'

const logger = createLogger('assisted_selling').child({ component: 'attribution' })

// Step 5.4 (§5.5/§6.7, S18/D-R5-16/D-R5-26). "A subscriber on `cart.cart.converted` writes
// one `AssistedSellingAttribution` per cart line." Unconditional — every converted BASKET
// cart that names an order or a quote outcome gets fully attributed, line by line, whether
// or not this module ever opened a thread on it (a cart the buyer converted on their own has
// every line attributed to `actor_type: 'buyer'`/`'system'`/`'merge'`, with `thread_id`/
// `proposal_id` NULL — correct per §6.7, not a gap). A conversion naming NEITHER
// `salesOrderId` nor `salesQuoteId` (the pre-Release-5 `cart.markConverted` call shape) has
// no document outcome to attribute against at all — skipped silently, not degraded.

export type AssistedSellingAttributionSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

type RawLineMapEntry = { cartLineId: string; salesOrderLineId?: string; salesQuoteLineId?: string }

/**
 * §9.1/§6.7: `lineMap` is valid for THIS conversion only when it is an array, every entry
 * carries the discriminant matching whichever of `salesOrderId`/`salesQuoteId` fired
 * (`cart.markConverted`'s own bijection guard already enforces this shape at write time —
 * this is a second, independent read-side check, not a re-trust of the payload), and it
 * covers every live line of the cart exactly once. Any other shape — absent, not an array,
 * a line missing, an extra/foreign id, the wrong discriminant — is "does not cover a line"
 * per §6.7 and degrades the whole conversion, never a partial per-line guess.
 */
function resolveLineMap(
  raw: unknown,
  lineIds: string[],
  outcome: 'order' | 'quote',
): Map<string, RawLineMapEntry> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const key = outcome === 'order' ? 'salesOrderLineId' : 'salesQuoteLineId'
  const byCartLineId = new Map<string, RawLineMapEntry>()
  for (const item of raw) {
    const record = toRecord(item)
    const cartLineId = readString(record, 'cartLineId')
    const lineId = readString(record, key)
    if (!cartLineId || !lineId || byCartLineId.has(cartLineId)) return null
    const entry: RawLineMapEntry = { cartLineId }
    if (outcome === 'order') entry.salesOrderLineId = lineId
    else entry.salesQuoteLineId = lineId
    byCartLineId.set(cartLineId, entry)
  }
  if (byCartLineId.size !== lineIds.length) return null
  for (const id of lineIds) {
    if (!byCartLineId.has(id)) return null
  }
  return byCartLineId
}

// Money-split math (review finding): plain `Number` arithmetic accumulates IEEE-754 rounding
// error across the proportional splits below — a float that LOOKS like `33.33` can carry a
// few units of error at the 15th-16th significant digit, which `formatAmount`'s old
// `Math.round(... * 10000) / 10000` could round the wrong way at the boundary. Scaled `BigInt`
// arithmetic (fixed-point at `DECIMAL_SCALE` digits) keeps every multiply/divide exact until
// the one deliberate rounding step at the very end, when the result is formatted back to the
// 4-decimal strings this table stores.
const DECIMAL_SCALE_DIGITS = 8
const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_SCALE_DIGITS)
const OUTPUT_SCALE_DIGITS = 4
const OUTPUT_SCALE = 10n ** BigInt(OUTPUT_SCALE_DIGITS)
const SCALE_DOWN_TO_OUTPUT = DECIMAL_SCALE / OUTPUT_SCALE

function toScaledAmount(value: string | null | undefined): bigint {
  const trimmed = (value ?? '').trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (!match) return 0n
  const [, sign, whole, fraction = ''] = match
  const paddedFraction = fraction.slice(0, DECIMAL_SCALE_DIGITS).padEnd(DECIMAL_SCALE_DIGITS, '0')
  const magnitude = BigInt(whole) * DECIMAL_SCALE + BigInt(paddedFraction || '0')
  return sign === '-' ? -magnitude : magnitude
}

/** Rounds a `DECIMAL_SCALE`-scaled amount to `OUTPUT_SCALE_DIGITS` decimals, half away from
 * zero, and formats it as the fixed-point string this table's columns store. */
function formatScaledAmount(scaled: bigint): string {
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const halfUp = (magnitude + SCALE_DOWN_TO_OUTPUT / 2n) / SCALE_DOWN_TO_OUTPUT
  const wholePart = halfUp / OUTPUT_SCALE
  const fractionPart = (halfUp % OUTPUT_SCALE).toString().padStart(OUTPUT_SCALE_DIGITS, '0')
  const sign = negative && halfUp !== 0n ? '-' : ''
  return `${sign}${wholePart.toString()}.${fractionPart}`
}

type AttributionShare = {
  actorType: AssistedSellingAttributionActorType
  actorId: string | null
  threadId: string | null
  proposalId: string | null
  net: string
  gross: string
}

/**
 * §6.7: a proposal line that summed into a line the buyer already held cannot stay a
 * line of its own (`cart_lines_unique_line_key`), so the line's single `added_by` actor is
 * the buyer and the rep's units would be credited to nobody. Splits such a mixed line by
 * quantity into the buyer's remainder plus one share per accepted proposal, attributed to
 * the proposal's author.
 *
 * Review finding: when the proposals' own quantities fully (or, after rounding, slightly
 * over-) cover the line — e.g. two accepted proposals summing to exactly the line's quantity,
 * with no buyer-added remainder — this used to return `null` and fall back to crediting the
 * WHOLE line to `line.addedByActorId`, which in that shape is just whichever proposal's
 * acceptance happened to write the merged line last. That silently gave 100% of the
 * commission to one rep for units several reps actually contributed. Every contributing
 * proposal now gets its proportional share regardless of whether a buyer remainder exists;
 * the remainder row is only added when one actually does.
 */
function splitLineByProposalContribution(
  line: AssistedSellingAttributionLine,
  proposalByCartId: Map<string, AssistedSellingProposal>,
): AttributionShare[] | null {
  const contributions = (line.proposalContributions ?? []).flatMap((contribution) => {
    const proposal = proposalByCartId.get(contribution.proposalCartId)
    const quantity = toScaledAmount(contribution.quantity)
    return proposal && quantity > 0n ? [{ proposal, quantity }] : []
  })
  const lineQuantity = toScaledAmount(line.quantity ?? '0')
  if (contributions.length === 0 || lineQuantity <= 0n) return null
  const contributedQuantity = contributions.reduce((sum, contribution) => sum + contribution.quantity, 0n)

  const totalNet = toScaledAmount(line.netAmount)
  const totalGross = toScaledAmount(line.grossAmount)
  const shares: AttributionShare[] = contributions.map(({ proposal, quantity }) => ({
    actorType: proposal.authoredByActorType as AssistedSellingAttributionActorType,
    actorId: proposal.authoredByActorId,
    threadId: proposal.threadId,
    proposalId: proposal.id,
    net: formatScaledAmount((totalNet * quantity) / lineQuantity),
    gross: formatScaledAmount((totalGross * quantity) / lineQuantity),
  }))
  const remainderQuantity = lineQuantity - contributedQuantity
  if (remainderQuantity <= 0n) return shares

  const allocatedNet = shares.reduce((sum, share) => sum + toScaledAmount(share.net), 0n)
  const allocatedGross = shares.reduce((sum, share) => sum + toScaledAmount(share.gross), 0n)
  return [
    {
      actorType: line.addedByActorType as AssistedSellingAttributionActorType,
      actorId: line.addedByActorId,
      threadId: null,
      proposalId: null,
      net: formatScaledAmount(totalNet - allocatedNet),
      gross: formatScaledAmount(totalGross - allocatedGross),
    },
    ...shares,
  ]
}

export async function handleCartConvertedForAttribution(
  payload: unknown,
  ctx: AssistedSellingAttributionSubscriberContext,
): Promise<void> {
  const record = toRecord(payload)
  const cartId = readString(record, 'cartId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  const salesOrderId = readString(record, 'salesOrderId')
  const salesQuoteId = readString(record, 'salesQuoteId')

  if (!cartId || !tenantId || !organizationId) {
    logger.debug('skipped incomplete payload', {
      hasCartId: Boolean(cartId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }
  // §5.5's check constraint: exactly one of sales_order_id/sales_quote_id. Neither present
  // means no document outcome exists for this conversion — nothing to attribute, and this
  // is NOT the §6.7 degraded case (that requires a document outcome with a missing map).
  if (salesOrderId && salesQuoteId) {
    logger.warn('skipped conversion naming both an order and a quote outcome', { cartId, tenantId, organizationId })
    return
  }
  if (!salesOrderId && !salesQuoteId) return

  const container = ctx.container ?? { resolve: ctx.resolve }

  try {
    const em = container.resolve<EntityManager>('em').fork()

    // §5.5's own redelivery guard: "a `cart.cart.converted` for a cart that already has
    // attribution rows writes nothing."
    const existing = await em.count(AssistedSellingAttribution, { tenantId, organizationId, cartId })
    if (existing > 0) return

    const cartService = resolveCartService(container)
    const detail = await cartService.getAttributionLines({ tenantId, organizationId, cartId })
    if (!detail || detail.lines.length === 0) return

    // Review finding: `line.proposalCartId` is only the LAST contributing proposal
    // (`cartService.getAttributionLines`'s own `entries[entries.length - 1].proposalCartId`)
    // — a mixed/merged line's `proposalContributions` can name EARLIER proposals too.
    // Collecting only `line.proposalCartId` here left those earlier proposals unresolved in
    // `proposalByCartId` below, silently dropping their contribution out of the split instead
    // of crediting them.
    const proposalCartIds = Array.from(
      new Set(
        detail.lines.flatMap((line) => [
          line.proposalCartId,
          ...(line.proposalContributions ?? []).map((contribution) => contribution.proposalCartId),
        ]).filter((id): id is string => Boolean(id)),
      ),
    )
    const proposals = proposalCartIds.length
      ? await em.find(AssistedSellingProposal, {
          tenantId,
          organizationId,
          proposalCartId: { $in: proposalCartIds },
          deletedAt: null,
        })
      : []
    const proposalByCartId = new Map(proposals.map((proposal) => [proposal.proposalCartId, proposal]))

    const outcome: 'order' | 'quote' = salesOrderId ? 'order' : 'quote'
    const lineMap = resolveLineMap(record.lineMap, detail.lines.map((line) => line.id), outcome)

    const now = new Date()
    const rows: AssistedSellingAttribution[] = []

    if (lineMap) {
      for (const line of detail.lines) {
        const mapEntry = lineMap.get(line.id)
        if (!mapEntry) continue
        const proposal = line.proposalCartId ? proposalByCartId.get(line.proposalCartId) : undefined
        const baseRow = {
          tenantId,
          organizationId,
          cartId,
          cartLineId: line.id,
          salesOrderId: salesOrderId ?? null,
          salesOrderLineId: mapEntry.salesOrderLineId ?? null,
          salesQuoteId: salesQuoteId ?? null,
          salesQuoteLineId: mapEntry.salesQuoteLineId ?? null,
          currencyCode: detail.currencyCode,
          convertedAt: now,
        }
        const shares = splitLineByProposalContribution(line, proposalByCartId)
        if (!shares) {
          rows.push(
            em.create(AssistedSellingAttribution, {
              ...baseRow,
              actorType: line.addedByActorType as AssistedSellingAttributionActorType,
              actorId: line.addedByActorId,
              threadId: proposal?.threadId ?? null,
              proposalId: proposal?.id ?? null,
              lineNetAmount: line.netAmount,
              lineGrossAmount: line.grossAmount,
            }),
          )
          continue
        }
        for (const share of shares) {
          rows.push(
            em.create(AssistedSellingAttribution, {
              ...baseRow,
              actorType: share.actorType,
              actorId: share.actorId,
              threadId: share.threadId,
              proposalId: share.proposalId,
              lineNetAmount: share.net,
              lineGrossAmount: share.gross,
            }),
          )
        }
      }
    } else {
      // §6.7's safety net: "the subscriber degrades to document-level attribution — the
      // line id NULL, amounts summed per actor." Grouped by (actor_type, actor_id) so a
      // commission report still gets a usable, if coarser, split.
      const groups = new Map<string, { actorType: string; actorId: string | null; net: bigint; gross: bigint }>()
      for (const line of detail.lines) {
        const key = `${line.addedByActorType}:${line.addedByActorId ?? ''}`
        const group = groups.get(key) ?? { actorType: line.addedByActorType, actorId: line.addedByActorId, net: 0n, gross: 0n }
        group.net += toScaledAmount(line.netAmount)
        group.gross += toScaledAmount(line.grossAmount)
        groups.set(key, group)
      }
      for (const group of groups.values()) {
        const row = em.create(AssistedSellingAttribution, {
          tenantId,
          organizationId,
          cartId,
          cartLineId: null,
          salesOrderId: salesOrderId ?? null,
          salesOrderLineId: null,
          salesQuoteId: salesQuoteId ?? null,
          salesQuoteLineId: null,
          actorType: group.actorType as AssistedSellingAttributionActorType,
          actorId: group.actorId,
          threadId: null,
          proposalId: null,
          lineNetAmount: formatScaledAmount(group.net),
          lineGrossAmount: formatScaledAmount(group.gross),
          currencyCode: detail.currencyCode,
          convertedAt: now,
        })
        rows.push(row)
      }
    }

    await em.flush()

    if (!lineMap) {
      await emitAssistedSellingEvent('assisted_selling.attribution.degraded', {
        cartId,
        tenantId,
        organizationId,
        salesOrderId: salesOrderId ?? null,
        salesQuoteId: salesQuoteId ?? null,
      })
    }
  } catch (err) {
    logger.warn('failed to attribute converted cart', {
      cartId,
      tenantId,
      organizationId,
      error: err instanceof Error ? err.message : err,
    })
    getTelemetryRuntime()?.reportError(err, { module: 'assisted_selling', code: 'assisted_selling.attribution_failed' })
    // Review finding: this subscriber is `persistent: true` (retried on failure) precisely
    // so a transient error (a DB hiccup, a lock timeout) doesn't permanently lose a cart's
    // commission rows — swallowing every error here defeated that. The ONE case that is
    // actually safe to swallow is a proven idempotent duplicate: the partial unique indexes
    // on `(tenant_id, sales_*_line_id, proposal_id)` reject a second redelivery that raced
    // past the `existing > 0` guard above, and that redelivery's rows already exist from the
    // winner — re-throwing it would only churn retries forever on an outcome that already
    // succeeded.
    if (!isUniqueViolation(err)) throw err
  }
}
