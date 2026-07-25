import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
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

export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

/** Numeric scale of the `total_net_amount` / `total_gross_amount` line columns. */
const LINE_AMOUNT_SCALE = 4

function parseLineAmount(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function roundLineAmount(value: number): number {
  const factor = 10 ** LINE_AMOUNT_SCALE
  return Math.round((value + Number.EPSILON) * factor) / factor
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
  const netValue = parseLineAmount(net)
  const grossValue = parseLineAmount(gross)
  if (grossValue > 0 && netValue <= 0) {
    const rate = parseLineAmount(taxRate)
    const fraction = rate > 0 ? rate / 100 : 0
    return roundLineAmount(fraction > 0 ? grossValue / (1 + fraction) : grossValue)
  }
  return netValue
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
  const gross = parseLineAmount(payload.totalGrossAmount)
  const net = parseLineAmount(payload.totalNetAmount)
  if (gross <= 0 || net > 0) return payload
  const derivedNet = toNumericString(deriveLineNetFromGross(net, gross, payload.taxRate))
  if (derivedNet == null) return payload
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
