import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerCreditAccount,
  CustomerCreditLedgerEntry,
  type CustomerCreditLedgerEntryType,
  type CustomerCreditLedgerSourceType,
} from '../data/entities'
import { createCustomerGroupsService, type CustomerGroupsService } from './customerGroupsService'
import { resolveCompanyFirstCustomerId } from '../lib/creditIdentity'
import { emitCustomerGroupsEvent } from '../events'

// Release 5 Phase 3 (spec §6, §6.3, §6.5). Row-lock concurrency (G1), scoped calls with
// an addressable release (G2), decimal-string money (G14) and the four idempotency
// rules (G12). Registered as its own DI key (`customerCreditService`, G26) — NOT added
// to `CustomerGroupsService`, so an app overriding that key through `entry.overrides.di`
// keeps satisfying its interface.
//
// Concurrency (G1, §6.3): every write that changes an account's exposure locks the
// `CustomerCreditAccount` row with `LockMode.PESSIMISTIC_WRITE` inside
// `withAtomicFlush(em, phases, { transaction: true })`, which joins the caller's
// transaction when one is already open (checkout submit) and opens one otherwise. This
// is the Release 4 promotions precedent (`promotions/lib/promotion-usage-service.ts`,
// `promotions/lib/code-service.ts#useCode`, D-R4-12) replacing a SERIALIZABLE design that
// does not work here: `withAtomicFlush` ignores `isolationLevel` when it joins an ambient
// transaction (`packages/shared/src/lib/commands/flush.ts`). No 40001 retry helper.
//
// Encryption (G22, Step 1.7): `hold_reason`/`note` are registered in `../encryption.ts`.
// Every plain `this.em.find`/`findOne` below is still correct as-is — this service never
// reads either field's VALUE back for business logic (only `isOnHold`/`creditLimit`/
// amounts), so the ciphertext MikroORM returns for them is never surfaced or compared.
// The write side needs no change either: the platform's flush subscriber encrypts a
// registered field transparently regardless of whether the entity was loaded through a
// decrypting helper.

export type CommerceScope = { tenantId: string; organizationId: string }

// 2 dp decimal string. Inputs with more places (e.g. sales `numeric(18,4)` amounts) are
// rounded half-up to 2 dp at the service boundary, before the lock (G14, §5.5) — see
// `roundHalfUpToTwoDp` below. Minor-unit math, not floats, mirrors the convention
// `promotion-usage-service.ts`/`effect-resolvers.ts` already use in this codebase.
export type DecimalString = string

// The buyer as the caller knows it: person first, then company (§6.0). `customerId`
// alone is accepted for staff routes that already name the account holder.
export type CreditBuyerInput = { customerIds: string[] } | { customerId: string }

export type CreditCheckReason = 'ok' | 'no_account' | 'on_hold' | 'limit_exceeded' | 'not_permitted'

export type CreditCheck = {
  allowed: boolean
  reason: CreditCheckReason
  customerId: string
  creditAccountId: string | null
  creditLimit: DecimalString | null
  exposure: DecimalString | null
  available: DecimalString | null
  currencyCode: string
}

export type CreditEntryView = {
  entryId: string
  creditAccountId: string
  entryType: CustomerCreditLedgerEntryType
  amount: DecimalString
  balanceAfter: DecimalString
  idempotencyKey: string
  relatedEntryId: string | null
  linkedOrderId: string | null
}

export type CustomerCreditServiceErrorCode =
  | 'idempotency_key_mismatch'
  | 'settle_exceeds_reservation'
  | 'no_account'
  | 'invalid_buyer'
  | 'invalid_amount'

export class CustomerCreditServiceError extends Error {
  readonly code: CustomerCreditServiceErrorCode

  constructor(code: CustomerCreditServiceErrorCode, message: string) {
    super(message)
    this.name = 'CustomerCreditServiceError'
    this.code = code
  }
}

export type CheckCreditInput = {
  scope: CommerceScope
  buyer: CreditBuyerInput
  currencyCode: string
  amount: DecimalString
}

export type ReserveCreditInput = {
  scope: CommerceScope
  buyer: CreditBuyerInput
  currencyCode: string
  amount: DecimalString
  sourceType: CustomerCreditLedgerSourceType
  sourceId: string
  idempotencyKey: string
}

export type ReserveCreditResult = {
  reserved: boolean
  // True when this key's reservation was already released (§6.5 idempotency rule 3).
  released: boolean
  entry: CreditEntryView | null
  check: CreditCheck
}

export type ReleaseCreditInput = {
  scope: CommerceScope
  reserveIdempotencyKey: string
  reason: string
}

export type ReleaseCreditResult = { released: boolean; entryId: string | null }

// Step 4.2 (C6, additive to the G contract — checkout's own §8.3 step 6b). Writes
// `linked_order_id` on the `reserve` ledger entry named by `idempotencyKey` so
// `order-cancelled-credit-release`'s own `linkedOrderId: orderId` lookup (built ahead of
// this method existing, Phase 3) finds it the moment an order with this reservation is
// ever cancelled (D-R5-2).
export type LinkCreditReservationToOrderInput = {
  scope: CommerceScope
  idempotencyKey: string
  orderId: string
}

export type LinkCreditReservationToOrderResult = { linked: boolean; entryId: string | null }

export type SettleCreditInput = {
  scope: CommerceScope
  buyer: CreditBuyerInput
  currencyCode: string
  amount: DecimalString
  sourceType: 'invoice' | 'payment'
  sourceId: string
  idempotencyKey: string
  reserveIdempotencyKey?: string
}

export type SettleCreditResult = { settled: boolean; entry: CreditEntryView }

// Step 1.12 (D-R5-2/G20, §6.5). `adjust` is the only entry type an operator writes
// directly: a signed, non-zero correction with a required note — manual settlement of a
// payment when no integration calls `settleCredit`, or any other correction. `relatedEntryId`
// and `idempotencyKey` are supplied by the caller (the command, never the HTTP body) so the
// SAME method serves both the forward write (a fresh id, no related entry) and the command's
// own undo (the key `undo:{entryId}`, `relatedEntryId` = the entry being reversed) without
// duplicating the lock/sum/append logic.
export type AdjustCreditInput = {
  scope: CommerceScope
  buyer: CreditBuyerInput
  currencyCode: string
  amount: DecimalString
  note: string
  idempotencyKey: string
  relatedEntryId?: string | null
  createdByUserId?: string | null
}

export type AdjustCreditResult = { entry: CreditEntryView }

export type GetAccountExposureInput = { creditAccountId: string; scope: CommerceScope }

export type AccountExposureView = { exposure: DecimalString; available: DecimalString | null }

export interface CustomerCreditService {
  // Read-only, no lock. A hint for the UI and checkout's payment-method list, never a
  // guarantee — only `reserveCredit` decides under the lock (§6.3).
  checkCredit(input: CheckCreditInput): Promise<CreditCheck>

  // Read-only, no lock, no `allowPurchaseOnAccount` short-circuit — unlike `checkCredit`,
  // which answers "can a purchase happen right now" and intentionally reports
  // `exposure: null` when the group's current terms disallow it (§6.5 reason order).
  // This answers a narrower, display-only question for an ALREADY-KNOWN account: "what
  // is its real ledger exposure", for admin screens that must show the number regardless
  // of whether on-account purchasing happens to be enabled today (e.g. a historical
  // account whose group's terms later changed). Returns `available: null` only when the
  // account carries no credit limit yet.
  getAccountExposure(input: GetAccountExposureInput): Promise<AccountExposureView>

  // Row lock on the credit account (§6.3); re-checks under the lock and appends the
  // reserve entry. `amount` is the caller's full payable total.
  reserveCredit(input: ReserveCreditInput): Promise<ReserveCreditResult>

  // Releases the open amount of the reservation named by its key (§5.5). A second call
  // for the same key is a no-op.
  releaseCredit(input: ReleaseCreditInput): Promise<ReleaseCreditResult>

  // Lowers exposure for a payment. With `reserveIdempotencyKey`, the settle belongs to
  // that reservation and may not exceed its open amount; without it, it is account-level.
  settleCredit(input: SettleCreditInput): Promise<SettleCreditResult>

  // Appends a signed, non-zero `adjust` entry under the account row lock (§6.3). Used
  // both for the forward `/adjust` command and, with a negated amount, for its undo
  // (G20) — never a delete.
  adjustCredit(input: AdjustCreditInput): Promise<AdjustCreditResult>

  // Step 4.2 (C6): links a `reserve` entry to the order it funded, so a later
  // cancellation can find and release it. Idempotent — linking an already-linked entry
  // to the SAME order is a no-op; a mismatch (the entry already names a DIFFERENT order)
  // throws `idempotency_key_mismatch`, the same error class every other re-used key in
  // this service raises.
  linkCreditReservationToOrder(input: LinkCreditReservationToOrderInput): Promise<LinkCreditReservationToOrderResult>
}

// ---------------------------------------------------------------------------
// Decimal-as-string money math (G14). `customer_credit_accounts.credit_limit` and
// `customer_credit_ledger_entries.amount`/`balance_after` are `numeric(16,2)` — always
// 2 fraction digits — so minor-units (cent) integer math avoids float reconversion
// error, same convention as `promotions/lib/promotion-usage-service.ts` and
// `promotions/lib/effect-resolvers.ts#roundHalfUpToMinorUnits`.
// ---------------------------------------------------------------------------

const MONEY_FRACTION_DIGITS = 2
const MONEY_MINOR_UNIT_FACTOR = 10 ** MONEY_FRACTION_DIGITS

// Exported for `workers/credit-exposure-audit.ts` (G21), which recomputes the same
// `SUM(amount)` this service computes under the lock (`sumExposure` below) and must use
// the identical minor-unit rounding to compare against `balance_after` without reporting
// its own rounding as drift (G14).
export function toMinorUnits(value: string): number {
  return Math.round(Number(value) * MONEY_MINOR_UNIT_FACTOR)
}

export function formatMinorUnits(value: number): string {
  return (value / MONEY_MINOR_UNIT_FACTOR).toFixed(MONEY_FRACTION_DIGITS)
}

function addDecimalStrings(a: string, b: string): string {
  return formatMinorUnits(toMinorUnits(a) + toMinorUnits(b))
}

function negateDecimalString(value: string): string {
  return formatMinorUnits(-toMinorUnits(value))
}

function exceedsLimit(total: string, limit: string): boolean {
  return toMinorUnits(total) > toMinorUnits(limit)
}

// Inputs with more than 2 fraction digits (sales `numeric(18,4)` amounts) round half-up
// to 2 dp at the service boundary, before the lock (G14, §5.5) — same half-up shape as
// `effect-resolvers.ts#roundHalfUpToMinorUnits`, generalized to a string input here.
function roundHalfUpToTwoDp(value: string): string {
  const amount = Number(value)
  const absMinorUnits = Math.floor(Math.abs(amount) * MONEY_MINOR_UNIT_FACTOR + 0.5)
  const isNegative = amount < 0 && absMinorUnits !== 0
  const formatted = formatMinorUnits(absMinorUnits)
  return isNegative ? `-${formatted}` : formatted
}

// §10.1 `CreditLimitExceededPayload`. No PII (ids and amounts only), consistent with
// checkout's redaction rule — see `events.ts` for why the sibling `credit.*` events stay
// undeclared for now.
async function emitCreditLimitExceededEvent(input: {
  scope: CommerceScope
  creditAccountId: string
  customerId: string
  currencyCode: string
  requestedAmount: DecimalString
  exposure: DecimalString
  creditLimit: DecimalString
  sourceType: CustomerCreditLedgerSourceType
  sourceId: string
}): Promise<void> {
  await emitCustomerGroupsEvent(
    'customer_groups.credit.limit_exceeded',
    {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      creditAccountId: input.creditAccountId,
      customerId: input.customerId,
      currencyCode: input.currencyCode,
      requestedAmount: input.requestedAmount,
      exposure: input.exposure,
      creditLimit: input.creditLimit,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
    { persistent: true, tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
  )
}

// §10.1 `CreditEntryEventPayload` for `.adjusted` — the only `credit.*` entry event this
// module emits so far (the sibling `.reserved`/`.released`/`.settled` stay undeclared,
// see `events.ts`): nothing in a prior Step's scope consumed them, but `adjust` is a
// staff-initiated, auditable action an operator-facing webhook or notification may want
// to react to from day one.
async function emitCreditAdjustedEvent(input: {
  scope: CommerceScope
  creditAccountId: string
  customerId: string
  currencyCode: string
  entry: CreditEntryView
}): Promise<void> {
  await emitCustomerGroupsEvent(
    'customer_groups.credit.adjusted',
    {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      creditAccountId: input.creditAccountId,
      customerId: input.customerId,
      currencyCode: input.currencyCode,
      entryId: input.entry.entryId,
      amount: input.entry.amount,
      exposureAfter: input.entry.balanceAfter,
      sourceType: 'manual' as const,
      sourceId: null,
      relatedEntryId: input.entry.relatedEntryId,
      linkedOrderId: input.entry.linkedOrderId,
    },
    { persistent: true, tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
  )
}

function idempotencyMismatchError(): CustomerCreditServiceError {
  return new CustomerCreditServiceError(
    'idempotency_key_mismatch',
    '[internal] idempotency key reused with a different (amount, currency, sourceType, sourceId)',
  )
}

async function resolveBuyerCustomerId(
  em: EntityManager,
  buyer: CreditBuyerInput,
  tenantId: string,
): Promise<string> {
  if ('customerId' in buyer) return buyer.customerId
  const customerIds = buyer.customerIds.filter((id) => typeof id === 'string' && id.length > 0)
  if (!customerIds.length) {
    throw new CustomerCreditServiceError('invalid_buyer', '[internal] buyer.customerIds must not be empty')
  }
  return resolveCompanyFirstCustomerId(em, customerIds, tenantId)
}

function termsLookupInput(buyer: CreditBuyerInput, tenantId: string) {
  if ('customerId' in buyer) return { customerId: buyer.customerId, tenantId }
  // Terms (and so `allowPurchaseOnAccount`) resolve over the FULL buyer identity —
  // person and company — per §6.5: "not_permitted comes from resolveTerms over the same
  // customerIds," distinct from the single company-first id the account itself resolves
  // to just below.
  return { customerId: null, customerIds: buyer.customerIds, tenantId }
}

function toEntryView(entry: CustomerCreditLedgerEntry): CreditEntryView {
  return {
    entryId: entry.id,
    creditAccountId: entry.creditAccountId,
    entryType: entry.entryType,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    idempotencyKey: entry.idempotencyKey,
    relatedEntryId: entry.relatedEntryId ?? null,
    linkedOrderId: entry.linkedOrderId ?? null,
  }
}

function buildCheck(params: {
  allowed: boolean
  reason: CreditCheckReason
  customerId: string
  currencyCode: string
  account: CustomerCreditAccount | null
  exposure: string | null
}): CreditCheck {
  const { allowed, reason, customerId, currencyCode, account, exposure } = params
  const creditLimit = account?.creditLimit ?? null
  const available = creditLimit != null && exposure != null ? addDecimalStrings(creditLimit, negateDecimalString(exposure)) : null
  return {
    allowed,
    reason,
    customerId,
    creditAccountId: account?.id ?? null,
    creditLimit,
    exposure,
    available,
    currencyCode,
  }
}

export class DefaultCustomerCreditService implements CustomerCreditService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupsService: CustomerGroupsService,
  ) {}

  // §6.5: SUM(amount) over every ledger entry of the account — `reserve` positive,
  // `release`/`settle` negative, `adjust` either — never zero. `balance_after` is audit
  // only and MUST NOT be read as the source of truth (§5.5); this re-reads the whole
  // ledger instead, exactly like `promotion-usage-service.ts#getBudgetConsumed`.
  private async sumExposure(creditAccountId: string, scope: CommerceScope): Promise<string> {
    const entries = await this.em.find(CustomerCreditLedgerEntry, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      creditAccountId,
    })
    let totalMinorUnits = 0
    for (const entry of entries) totalMinorUnits += toMinorUnits(entry.amount)
    return formatMinorUnits(totalMinorUnits)
  }

  // Open amount of a reservation (§5.5): the `reserve` amount plus the (negative)
  // amounts of every `release`/`settle` entry whose `related_entry_id` points at it.
  private async computeOpenAmount(reserveEntry: CustomerCreditLedgerEntry, scope: CommerceScope): Promise<string> {
    const children = await this.em.find(CustomerCreditLedgerEntry, {
      tenantId: scope.tenantId,
      relatedEntryId: reserveEntry.id,
    })
    let totalMinorUnits = toMinorUnits(reserveEntry.amount)
    for (const child of children) totalMinorUnits += toMinorUnits(child.amount)
    return formatMinorUnits(totalMinorUnits)
  }

  private async findAccount(
    scope: CommerceScope,
    customerId: string,
    currencyCode: string,
    options: { lockMode?: typeof LockMode.PESSIMISTIC_WRITE } = {},
  ): Promise<CustomerCreditAccount | null> {
    return this.em.findOne(
      CustomerCreditAccount,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, customerId, currencyCode, deletedAt: null },
      options.lockMode ? { lockMode: options.lockMode } : undefined,
    )
  }

  async getAccountExposure(input: GetAccountExposureInput): Promise<AccountExposureView> {
    const { creditAccountId, scope } = input
    const account = await this.em.findOne(CustomerCreditAccount, {
      id: creditAccountId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const exposure = await this.sumExposure(creditAccountId, scope)
    const available = account?.creditLimit != null ? addDecimalStrings(account.creditLimit, negateDecimalString(exposure)) : null
    return { exposure, available }
  }

  async checkCredit(input: CheckCreditInput): Promise<CreditCheck> {
    const { scope, currencyCode } = input
    const customerId = await resolveBuyerCustomerId(this.em, input.buyer, scope.tenantId)
    const amount = roundHalfUpToTwoDp(input.amount)

    // Reason order (§6.5): not_permitted → no_account → on_hold → limit_exceeded → ok.
    const terms = await this.groupsService.resolveTerms(termsLookupInput(input.buyer, scope.tenantId))
    const account = await this.findAccount(scope, customerId, currencyCode)

    if (!terms.allowPurchaseOnAccount) {
      return buildCheck({ allowed: false, reason: 'not_permitted', customerId, currencyCode, account, exposure: null })
    }
    if (!account) {
      return buildCheck({ allowed: false, reason: 'no_account', customerId, currencyCode, account: null, exposure: null })
    }

    const exposure = await this.sumExposure(account.id, scope)
    if (account.isOnHold) {
      return buildCheck({ allowed: false, reason: 'on_hold', customerId, currencyCode, account, exposure })
    }

    const projected = addDecimalStrings(exposure, amount)
    if (exceedsLimit(projected, account.creditLimit)) {
      return buildCheck({ allowed: false, reason: 'limit_exceeded', customerId, currencyCode, account, exposure })
    }
    return buildCheck({ allowed: true, reason: 'ok', customerId, currencyCode, account, exposure })
  }

  async reserveCredit(input: ReserveCreditInput): Promise<ReserveCreditResult> {
    const { scope, currencyCode } = input
    const amount = roundHalfUpToTwoDp(input.amount)
    const customerId = await resolveBuyerCustomerId(this.em, input.buyer, scope.tenantId)

    // not_permitted is a static terms check, independent of the account's exposure, so
    // it runs before the lock is even considered (§6.3: "the lock covers only steps
    // 1-5" — a permission check is not one of those steps).
    const terms = await this.groupsService.resolveTerms(termsLookupInput(input.buyer, scope.tenantId))
    if (!terms.allowPurchaseOnAccount) {
      const account = await this.findAccount(scope, customerId, currencyCode)
      return {
        reserved: false,
        released: false,
        entry: null,
        check: buildCheck({ allowed: false, reason: 'not_permitted', customerId, currencyCode, account, exposure: null }),
      }
    }

    let result!: ReserveCreditResult

    const runReserve = async () => {
      await withAtomicFlush(
        this.em,
        [
          async () => {
            // Step 1 (§6.3): lock the account row inside the (possibly ambient)
            // transaction. A parallel caller blocks here until the first commits.
            const account = await this.findAccount(scope, customerId, currencyCode, { lockMode: LockMode.PESSIMISTIC_WRITE })
            if (!account) {
              result = {
                reserved: false,
                released: false,
                entry: null,
                check: buildCheck({ allowed: false, reason: 'no_account', customerId, currencyCode, account: null, exposure: null }),
              }
              return
            }

            // Step 2: idempotency lookup by (tenant_id, idempotency_key), still under
            // the lock — a replay never races with a concurrent write to this account.
            const existing = await this.em.findOne(CustomerCreditLedgerEntry, {
              tenantId: scope.tenantId,
              idempotencyKey: input.idempotencyKey,
            })
            if (existing) {
              if (existing.entryType !== 'reserve' || toMinorUnits(existing.amount) !== toMinorUnits(amount)) {
                throw idempotencyMismatchError()
              }
              const existingAccount =
                existing.creditAccountId === account.id
                  ? account
                  : await this.em.findOne(CustomerCreditAccount, { id: existing.creditAccountId, tenantId: scope.tenantId })
              const sameTuple =
                existingAccount?.currencyCode === currencyCode &&
                existing.sourceType === input.sourceType &&
                existing.sourceId === input.sourceId
              if (!sameTuple) throw idempotencyMismatchError()

              // Idempotency rule 3 (§6.5): a key whose reservation was already
              // released is not reusable.
              const releaseEntry = await this.em.findOne(CustomerCreditLedgerEntry, {
                tenantId: scope.tenantId,
                relatedEntryId: existing.id,
                entryType: 'release',
              })
              const exposure = await this.sumExposure(account.id, scope)
              result = {
                reserved: !releaseEntry,
                released: !!releaseEntry,
                entry: toEntryView(existing),
                check: buildCheck({ allowed: !releaseEntry, reason: 'ok', customerId, currencyCode, account, exposure }),
              }
              return
            }

            // Step 3: re-sum under the lock.
            const exposure = await this.sumExposure(account.id, scope)
            if (account.isOnHold) {
              result = {
                reserved: false,
                released: false,
                entry: null,
                check: buildCheck({ allowed: false, reason: 'on_hold', customerId, currencyCode, account, exposure }),
              }
              return
            }

            // Step 4: refuse when the projected exposure exceeds the limit.
            const projected = addDecimalStrings(exposure, amount)
            if (exceedsLimit(projected, account.creditLimit)) {
              result = {
                reserved: false,
                released: false,
                entry: null,
                check: buildCheck({ allowed: false, reason: 'limit_exceeded', customerId, currencyCode, account, exposure }),
              }
              return
            }

            // Step 5: append the entry with `balance_after` computed under the lock.
            const entry = this.em.create(CustomerCreditLedgerEntry, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              creditAccountId: account.id,
              entryType: 'reserve',
              amount,
              sourceType: input.sourceType,
              sourceId: input.sourceId,
              idempotencyKey: input.idempotencyKey,
              balanceAfter: projected,
              createdByActorType: 'system',
            })
            this.em.persist(entry)
            result = {
              reserved: true,
              released: false,
              entry: toEntryView(entry),
              check: buildCheck({ allowed: true, reason: 'ok', customerId, currencyCode, account, exposure: projected }),
            }
          },
        ],
        { transaction: true, label: 'customer_groups.credit.reserve' },
      )
    }

    try {
      await runReserve()
    } catch (err) {
      // A genuine cross-account race on the SAME idempotency key (a caller bug, since
      // keys are unique per tenant across every account, G2) can lose to the unique
      // constraint instead of the account lock, which only serializes writes to ONE
      // account. Re-read and resolve exactly like a normal replay rather than surface a
      // raw constraint violation.
      if (!isUniqueViolation(err)) throw err
      const existing = await this.em.findOne(CustomerCreditLedgerEntry, {
        tenantId: scope.tenantId,
        idempotencyKey: input.idempotencyKey,
      })
      if (!existing || existing.entryType !== 'reserve' || toMinorUnits(existing.amount) !== toMinorUnits(amount)) {
        throw idempotencyMismatchError()
      }
      const account = await this.em.findOne(CustomerCreditAccount, { id: existing.creditAccountId, tenantId: scope.tenantId })
      if (!account || account.currencyCode !== currencyCode || existing.sourceType !== input.sourceType || existing.sourceId !== input.sourceId) {
        throw idempotencyMismatchError()
      }
      const releaseEntry = await this.em.findOne(CustomerCreditLedgerEntry, {
        tenantId: scope.tenantId,
        relatedEntryId: existing.id,
        entryType: 'release',
      })
      const exposure = await this.sumExposure(account.id, scope)
      result = {
        reserved: !releaseEntry,
        released: !!releaseEntry,
        entry: toEntryView(existing),
        check: buildCheck({ allowed: !releaseEntry, reason: 'ok', customerId, currencyCode, account, exposure }),
      }
    }

    // §10.1 `CreditLimitExceededPayload`, "emitted on a refused reserveCredit" — after the
    // (no-op) writing transaction has already committed above, never from the idempotent-
    // replay paths, which always resolve to `reason: 'ok'`. Drives the Step 1.8
    // `customer_groups.credit.limit_exceeded` notification (G15).
    if (result.check.reason === 'limit_exceeded' && result.check.creditAccountId) {
      await emitCreditLimitExceededEvent({
        scope,
        creditAccountId: result.check.creditAccountId,
        customerId,
        currencyCode,
        requestedAmount: amount,
        exposure: result.check.exposure ?? '0.00',
        creditLimit: result.check.creditLimit ?? '0.00',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      })
    }

    return result
  }

  async releaseCredit(input: ReleaseCreditInput): Promise<ReleaseCreditResult> {
    const { scope } = input
    const releaseKey = `release:${input.reserveIdempotencyKey}`
    let result: ReleaseCreditResult = { released: false, entryId: null }

    await withAtomicFlush(
      this.em,
      [
        async () => {
          const reserveEntry = await this.em.findOne(CustomerCreditLedgerEntry, {
            tenantId: scope.tenantId,
            idempotencyKey: input.reserveIdempotencyKey,
            entryType: 'reserve',
          })
          if (!reserveEntry) return

          // Lock the owning account row before re-summing, same as `reserveCredit`.
          const account = await this.em.findOne(
            CustomerCreditAccount,
            { id: reserveEntry.creditAccountId, tenantId: scope.tenantId, organizationId: scope.organizationId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )
          if (!account) return

          // Idempotency rule 4 (§6.5): a second release is a no-op returning the first
          // release entry's id.
          const existingRelease = await this.em.findOne(CustomerCreditLedgerEntry, {
            tenantId: scope.tenantId,
            idempotencyKey: releaseKey,
          })
          if (existingRelease) {
            result = { released: false, entryId: existingRelease.id }
            return
          }

          const openAmount = await this.computeOpenAmount(reserveEntry, scope)
          if (toMinorUnits(openAmount) <= 0) {
            // Fully settled already: release writes nothing (§6.5 rule 4).
            return
          }

          const releaseAmount = negateDecimalString(openAmount)
          const exposure = await this.sumExposure(account.id, scope)
          const balanceAfter = addDecimalStrings(exposure, releaseAmount)
          const entry = this.em.create(CustomerCreditLedgerEntry, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            creditAccountId: account.id,
            entryType: 'release',
            amount: releaseAmount,
            sourceType: reserveEntry.sourceType,
            sourceId: reserveEntry.sourceId,
            relatedEntryId: reserveEntry.id,
            idempotencyKey: releaseKey,
            balanceAfter,
            createdByActorType: 'system',
            note: input.reason,
          })
          this.em.persist(entry)
          result = { released: true, entryId: entry.id }
        },
      ],
      { transaction: true, label: 'customer_groups.credit.release' },
    )

    return result
  }

  async settleCredit(input: SettleCreditInput): Promise<SettleCreditResult> {
    const { scope, currencyCode } = input
    const amount = roundHalfUpToTwoDp(input.amount)
    const signedAmount = negateDecimalString(amount)
    const customerId = await resolveBuyerCustomerId(this.em, input.buyer, scope.tenantId)

    let result!: SettleCreditResult

    await withAtomicFlush(
      this.em,
      [
        async () => {
          const account = await this.findAccount(scope, customerId, currencyCode, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (!account) {
            throw new CustomerCreditServiceError('no_account', '[internal] settleCredit: no credit account for this customer/currency')
          }

          const existing = await this.em.findOne(CustomerCreditLedgerEntry, {
            tenantId: scope.tenantId,
            idempotencyKey: input.idempotencyKey,
          })
          if (existing) {
            if (
              existing.entryType !== 'settle' ||
              toMinorUnits(existing.amount) !== toMinorUnits(signedAmount) ||
              existing.sourceType !== input.sourceType ||
              existing.sourceId !== input.sourceId
            ) {
              throw idempotencyMismatchError()
            }
            result = { settled: false, entry: toEntryView(existing) }
            return
          }

          let reserveEntry: CustomerCreditLedgerEntry | null = null
          if (input.reserveIdempotencyKey) {
            reserveEntry = await this.em.findOne(CustomerCreditLedgerEntry, {
              tenantId: scope.tenantId,
              idempotencyKey: input.reserveIdempotencyKey,
              entryType: 'reserve',
            })
            if (reserveEntry) {
              const openAmount = await this.computeOpenAmount(reserveEntry, scope)
              if (toMinorUnits(amount) > toMinorUnits(openAmount)) {
                throw new CustomerCreditServiceError(
                  'settle_exceeds_reservation',
                  '[internal] settle amount exceeds the reservation open amount',
                )
              }
            }
          }

          const exposure = await this.sumExposure(account.id, scope)
          const balanceAfter = addDecimalStrings(exposure, signedAmount)
          const entry = this.em.create(CustomerCreditLedgerEntry, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            creditAccountId: account.id,
            entryType: 'settle',
            amount: signedAmount,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            relatedEntryId: reserveEntry?.id ?? null,
            idempotencyKey: input.idempotencyKey,
            balanceAfter,
            createdByActorType: 'system',
          })
          this.em.persist(entry)
          result = { settled: true, entry: toEntryView(entry) }
        },
      ],
      { transaction: true, label: 'customer_groups.credit.settle' },
    )

    return result
  }

  async adjustCredit(input: AdjustCreditInput): Promise<AdjustCreditResult> {
    const { scope, currencyCode } = input
    const amount = roundHalfUpToTwoDp(input.amount)
    if (toMinorUnits(amount) === 0) {
      throw new CustomerCreditServiceError('invalid_amount', '[internal] adjustCredit: amount must not be zero')
    }
    const customerId = await resolveBuyerCustomerId(this.em, input.buyer, scope.tenantId)

    let result!: AdjustCreditResult
    let created = false

    await withAtomicFlush(
      this.em,
      [
        async () => {
          // Same lock/idempotency shape as `reserveCredit`/`settleCredit` (§6.3): lock the
          // account row first, then look up the idempotency key under the lock. `adjust`
          // has no caller-supplied business key (§9: the body is `{ amount, note }` only) —
          // the command mints its own key per execution, so a found row here means either a
          // genuine replay of the SAME command invocation or the undo key reused on a second
          // undo attempt, both of which must return the original entry rather than double-post.
          const account = await this.findAccount(scope, customerId, currencyCode, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (!account) {
            throw new CustomerCreditServiceError('no_account', '[internal] adjustCredit: no credit account for this customer/currency')
          }

          const existing = await this.em.findOne(CustomerCreditLedgerEntry, {
            tenantId: scope.tenantId,
            idempotencyKey: input.idempotencyKey,
          })
          if (existing) {
            result = { entry: toEntryView(existing) }
            return
          }

          const exposure = await this.sumExposure(account.id, scope)
          const balanceAfter = addDecimalStrings(exposure, amount)
          const entry = this.em.create(CustomerCreditLedgerEntry, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            creditAccountId: account.id,
            entryType: 'adjust',
            amount,
            sourceType: 'manual',
            sourceId: null,
            relatedEntryId: input.relatedEntryId ?? null,
            idempotencyKey: input.idempotencyKey,
            balanceAfter,
            createdByActorType: 'staff_user',
            createdByUserId: input.createdByUserId ?? null,
            note: input.note,
          })
          this.em.persist(entry)
          created = true
          result = { entry: toEntryView(entry) }
        },
      ],
      { transaction: true, label: 'customer_groups.credit.adjust' },
    )

    // Emitted only for the write that actually happened — a replay of the same
    // idempotency key (§6.5 rule 1) must not re-announce an adjustment that already
    // fired its event the first time.
    if (created) {
      await emitCreditAdjustedEvent({ scope, creditAccountId: result.entry.creditAccountId, customerId, currencyCode, entry: result.entry })
    }

    return result
  }

  async linkCreditReservationToOrder(input: LinkCreditReservationToOrderInput): Promise<LinkCreditReservationToOrderResult> {
    const { scope } = input
    let result: LinkCreditReservationToOrderResult = { linked: false, entryId: null }

    await withAtomicFlush(
      this.em,
      [
        async () => {
          // Lock the owning account row first — same convention as every other write on
          // this service — even though this call only ever touches the `reserve` entry's
          // own `linked_order_id` column, so a concurrent `releaseCredit`/`settleCredit`
          // on the SAME account can never interleave with this write.
          const reserveEntry = await this.em.findOne(CustomerCreditLedgerEntry, {
            tenantId: scope.tenantId,
            idempotencyKey: input.idempotencyKey,
            entryType: 'reserve',
          })
          if (!reserveEntry) return

          await this.em.findOne(
            CustomerCreditAccount,
            { id: reserveEntry.creditAccountId, tenantId: scope.tenantId, organizationId: scope.organizationId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )

          if (reserveEntry.linkedOrderId === input.orderId) {
            result = { linked: false, entryId: reserveEntry.id }
            return
          }
          if (reserveEntry.linkedOrderId != null) {
            throw idempotencyMismatchError()
          }

          reserveEntry.linkedOrderId = input.orderId
          this.em.persist(reserveEntry)
          result = { linked: true, entryId: reserveEntry.id }
        },
      ],
      { transaction: true, label: 'customer_groups.credit.linkReservationToOrder' },
    )

    return result
  }
}

export function createCustomerCreditService(em: EntityManager): CustomerCreditService {
  return new DefaultCustomerCreditService(em, createCustomerGroupsService(em))
}
