import { INITIAL_PREVIOUS_INVOICE_HASH, isZatcaInvoiceHash, resolvePreviousInvoiceHash } from './hash'

/**
 * The invoice chain: an invoice counter value that never repeats, and the pointer
 * to the previous invoice's hash.
 *
 * The two are kept apart on purpose because they advance at different moments:
 *
 *   - the **ICV is claimed** when an invoice is being issued, so two invoices issued
 *     at the same time can never share a number (ZATCA requires monotonic, unique
 *     values per taxpayer, BR-KSA-33/34);
 *   - the **PIH advances only on commit**, i.e. once the invoice's own hash exists.
 *     A failed or abandoned issuance therefore leaves the chain pointing at the last
 *     invoice that was actually produced, which is what the next invoice must
 *     reference (BR-KSA-61).
 *
 * Storage is a port. The in-memory implementation below keeps the logic testable;
 * the persistent binding belongs to the invoice pipeline, where it can take part in
 * the same transaction as the invoice itself.
 */

export type ZatcaInvoiceChainScope = {
  tenantId: string
  organizationId: string
}

export type ZatcaInvoiceChainState = {
  /** The last claimed invoice counter value. */
  icv: number
  /** Hash of the last committed invoice, or `null` before the first one. */
  lastInvoiceHash: string | null
}

export type ZatcaInvoiceChainStore = {
  read(scope: ZatcaInvoiceChainScope): Promise<ZatcaInvoiceChainState | null>
  write(scope: ZatcaInvoiceChainScope, state: ZatcaInvoiceChainState): Promise<void>
}

export type ZatcaInvoiceReservation = {
  icv: number
  previousInvoiceHash: string
}

export type ZatcaInvoiceChainErrorCode = 'invalid_scope' | 'invalid_icv' | 'invalid_invoice_hash'

export class ZatcaInvoiceChainError extends Error {
  readonly code: ZatcaInvoiceChainErrorCode

  constructor(code: ZatcaInvoiceChainErrorCode, message: string) {
    super(`[internal] ${message}`)
    this.name = 'ZatcaInvoiceChainError'
    this.code = code
  }
}

function scopeKey(scope: ZatcaInvoiceChainScope): string {
  const tenantId = scope.tenantId?.trim()
  const organizationId = scope.organizationId?.trim()
  if (!tenantId || !organizationId) {
    throw new ZatcaInvoiceChainError('invalid_scope', 'A chain scope needs both a tenant and an organization.')
  }
  return `${tenantId}::${organizationId}`
}

export function createInMemoryZatcaInvoiceChainStore(
  initial: Readonly<Record<string, ZatcaInvoiceChainState>> = {},
): ZatcaInvoiceChainStore {
  const states = new Map<string, ZatcaInvoiceChainState>(Object.entries(initial))
  return {
    async read(scope) {
      const state = states.get(scopeKey(scope))
      return state ? { ...state } : null
    },
    async write(scope, state) {
      states.set(scopeKey(scope), { ...state })
    },
  }
}

function requireIcv(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ZatcaInvoiceChainError('invalid_icv', 'An invoice counter value must be a non-negative integer.')
  }
  return value
}

/**
 * Claims the next invoice counter value and returns the `PIH` the invoice must
 * embed. The claim is persisted immediately so the number cannot be handed out
 * twice; the hash pointer only moves in `commitInvoiceChain`.
 */
export async function allocateNextInvoiceChain(options: {
  store: ZatcaInvoiceChainStore
  scope: ZatcaInvoiceChainScope
}): Promise<ZatcaInvoiceReservation> {
  const state = await options.store.read(options.scope)
  const icv = requireIcv(state?.icv ?? 0) + 1
  const previousInvoiceHash = resolvePreviousInvoiceHash(state?.lastInvoiceHash ?? INITIAL_PREVIOUS_INVOICE_HASH)
  await options.store.write(options.scope, { icv, lastInvoiceHash: state?.lastInvoiceHash ?? null })
  return { icv, previousInvoiceHash }
}

/**
 * Records the hash of the invoice that was issued under a claimed counter value,
 * which is what the next invoice's `PIH` will point at.
 */
export async function commitInvoiceChain(options: {
  store: ZatcaInvoiceChainStore
  scope: ZatcaInvoiceChainScope
  icv: number
  invoiceHash: string
}): Promise<ZatcaInvoiceChainState> {
  const claimedIcv = requireIcv(options.icv)
  if (claimedIcv < 1) {
    throw new ZatcaInvoiceChainError('invalid_icv', 'An invoice counter value starts at 1.')
  }
  if (!isZatcaInvoiceHash(options.invoiceHash)) {
    throw new ZatcaInvoiceChainError('invalid_invoice_hash', 'The committed hash must be a Base64 invoice hash.')
  }
  const state = await options.store.read(options.scope)
  const currentIcv = requireIcv(state?.icv ?? 0)
  if (claimedIcv > currentIcv) {
    throw new ZatcaInvoiceChainError(
      'invalid_icv',
      'The counter value was never claimed; claim it with allocateNextInvoiceChain before committing.',
    )
  }
  const next: ZatcaInvoiceChainState = { icv: currentIcv, lastInvoiceHash: options.invoiceHash }
  await options.store.write(options.scope, next)
  return { ...next }
}
