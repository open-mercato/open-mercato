import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  FX_DECIMAL_PLACES,
  countDecimalPlaces,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  parseDecimal,
  resolveExactDecimal,
  roundDecimal,
  toDecimal,
} from '@open-mercato/shared/lib/decimal'
export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

/** Resource kinds used by the document-aggregate optimistic-lock check. */
export const SALES_RESOURCE_KIND_ORDER = 'sales.order'
export const SALES_RESOURCE_KIND_QUOTE = 'sales.quote'
export const SALES_RESOURCE_KIND_RETURN = 'sales.return'

/**
 * Enforce the document-aggregate OSS optimistic lock for a sales sub-resource
 * command (lines, adjustments, shipments, payments, returns, quote
 * conversion). The client sends the parent order/quote's expected `updated_at`
 * via the optimistic-lock extension header; this compares it against the
 * already-loaded document and throws the structured 409 on mismatch.
 *
 * The parent document is the consistency boundary: sub-resource mutations
 * recalculate document totals (or transition the document), which dirties the
 * parent so its `updated_at` advances on flush — meaning concurrent sub-edits
 * observe each other and conflict. Call this AFTER loading + scope-checking the
 * document and BEFORE mutating, so `document.updatedAt` is the pre-mutation
 * version.
 *
 * Strictly additive: when the client sends no header the check is a no-op, so
 * existing API consumers are unaffected. Respects `OM_OPTIMISTIC_LOCK`.
 *
 * Routes through the async DI-aware seam `enforceCommandOptimisticLockWithGuards`
 * (Phase 0 / S1): the OSS `updated_at` floor runs first (identical behavior when
 * `record_locks` is disabled — floor only), then the optional enterprise
 * `record_locks` enrichment is awaited so the aggregate check observes the
 * action-log diff when the resource is enabled. Callers MUST `await` it.
 */
export async function enforceSalesDocumentOptimisticLock(
  ctx: CommandRuntimeContext,
  document: { id: string; updatedAt?: Date | string | null } | null | undefined,
  resourceKind: string,
): Promise<void> {
  if (!document) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: document.id,
    current: document.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

export { cloneJson } from '../lib/json'

/** Plain decimal string (no exponent notation) for a numeric column, or `null`. */
export function toNumericString(value: number | string | null | undefined): string | null {
  const parsed = parseDecimal(value)
  return parsed ? decimalToString(parsed) : null
}

/**
 * Exact decimal string for a numeric column from a dual `<field>` + `<field>Exact`
 * pair (see `resolveExactDecimal`), or `null` when neither holds a value.
 */
export function exactAmountString(exact: unknown, legacy: unknown): string | null {
  return resolveExactDecimal(exact, legacy)
}

function nonNegativeExact(value: unknown): string {
  const parsed = parseDecimal(value)
  return parsed && parsed.gt(0) ? decimalToString(parsed) : '0'
}

/**
 * The order's recorded payment totals as calculation `existingTotals`, with the
 * exact column values next to their float copies.
 */
export function resolveOrderPaymentTotals(order: {
  paidTotalAmount?: string | number | null
  refundedTotalAmount?: string | number | null
}) {
  const paidTotalAmountExact = nonNegativeExact(order.paidTotalAmount)
  const refundedTotalAmountExact = nonNegativeExact(order.refundedTotalAmount)
  return {
    paidTotalAmount: decimalToNumber(paidTotalAmountExact),
    paidTotalAmountExact,
    refundedTotalAmount: decimalToNumber(refundedTotalAmountExact),
    refundedTotalAmountExact,
  }
}

/** Minimum decimal places a derived line net total keeps. */
const LINE_AMOUNT_SCALE = 4

function parseLineAmount(value: number | string | null | undefined): string {
  const parsed = parseDecimal(value)
  return parsed ? decimalToString(parsed) : '0'
}


/**
 * Derive a sales line's net total from its gross total and tax rate.
 *
 * `total_net_amount = 0` while `total_gross_amount > 0` is not a representable
 * priced state: `gross = net * (1 + taxRate)`, so `net = 0 ⇒ gross = 0`. When a
 * line carries a positive gross but a missing/zero net (legacy rows, optional
 * pass-through inputs, or invoice/credit-memo copy of a zeroed order line), the
 * net is reconstructed from gross and the line's tax rate. `taxRate` is a
 * percentage (e.g. `23` ⇒ `0.23` fraction), matching the stored column and
 * `taxCalculationService`. Returns the existing net unchanged when the
 * invariant already holds. See issues #3521 / #3036.
 */
export function deriveLineNetFromGross(
  net: number | string | null | undefined,
  gross: number | string | null | undefined,
  taxRate: number | string | null | undefined,
): number {
  return decimalToNumber(deriveExactLineNetFromGross(net, gross, taxRate))
}

/**
 * Exact-decimal variant of {@link deriveLineNetFromGross}: the derived net keeps
 * at least 4 decimals, or as many as the gross total carries.
 */
export function deriveExactLineNetFromGross(
  net: number | string | null | undefined,
  gross: number | string | null | undefined,
  taxRate: number | string | null | undefined,
): string {
  const netValue = toDecimal(parseLineAmount(net))
  const grossText = parseLineAmount(gross)
  const grossValue = toDecimal(grossText)
  if (grossValue.gt(0) && netValue.lte(0)) {
    const rate = toDecimal(parseLineAmount(taxRate))
    const decimalPlaces = Math.max(LINE_AMOUNT_SCALE, countDecimalPlaces(grossText))
    const derived = rate.gt(0)
      ? divideDecimals(grossValue, divideDecimals(rate, 100, FX_DECIMAL_PLACES).plus(1), FX_DECIMAL_PLACES)
      : grossValue
    return decimalToString(roundDecimal(derived, decimalPlaces))
  }
  return decimalToString(netValue)
}

type LinePersistedTotals = {
  totalNetAmount?: number | string | null
  totalGrossAmount?: number | string | null
  taxRate?: number | string | null
}

/**
 * Enforce the `gross > 0 ⇒ net > 0` invariant on a line-entity create payload
 * right before persistence. Returns the payload unchanged when the net total is
 * already positive or gross is non-positive; otherwise fills the net total in
 * from gross / taxRate via {@link deriveLineNetFromGross}. Applied at every
 * sales line persistence site so the skew that froze return net totals (#3036)
 * cannot be stored at the source. Idempotent and non-destructive: it only ever
 * raises a zero/missing net to its derived value.
 */
export function reconcileLinePersistedTotals<T extends LinePersistedTotals>(payload: T): T {
  const gross = toDecimal(parseLineAmount(payload.totalGrossAmount))
  const net = toDecimal(parseLineAmount(payload.totalNetAmount))
  if (gross.lte(0) || net.gt(0)) return payload
  const derivedNet = deriveExactLineNetFromGross(payload.totalNetAmount, payload.totalGrossAmount, payload.taxRate)
  return { ...payload, totalNetAmount: derivedNet } as T
}

export async function requireScopedEntity<T extends { id: string; deletedAt?: Date | null }>(
  em: EntityManager,
  entityClass: { new (): T },
  id: string,
  message: string,
  scope: { organizationId: string | null; tenantId: string | null } = { organizationId: null, tenantId: null },
): Promise<T> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  if (scope.organizationId) where.organizationId = scope.organizationId
  if (scope.tenantId) where.tenantId = scope.tenantId
  const entity = await findOneWithDecryption(em, entityClass, where, {}, scope)
  if (!entity) throw notFound(message)
  return entity
}
