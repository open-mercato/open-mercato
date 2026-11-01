import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerPurchaseApproval,
  type CustomerGroupApprovalPolicy,
  type CustomerPurchaseApprovalActorType,
  type CustomerPurchaseApprovalSlotDecision,
  type CustomerPurchaseApprovalStatus,
  type CustomerPurchaseApprovalSubjectType,
  type CustomerPurchaseApprovalWithdrawnReason,
} from '../data/entities'
import { createCustomerGroupsService, type CustomerGroupsService } from './customerGroupsService'
import { resolveCompanyFirstCustomerId, resolveCustomerUserCompanyId } from '../lib/creditIdentity'
import { emitCustomerGroupsEvent } from '../events'

// Release 5 Phase 4 (spec §6, §6.6, §5.6). The approval contract (G3), every transition
// a compare-and-set conditional update (G6), decision-authority guards (G24) and the
// request-side idempotency rule (G8). Registered as its own DI key
// (`customerPurchaseApprovalService`, G26) beside `customerCreditService` — not added to
// `CustomerGroupsService` — same convention `services/customerCreditService.ts` set in
// Step 1.6.
//
// Concurrency (G6, §6.6): `decideApproval`/`withdrawApproval`/the `expire-approvals` job
// each issue a plain SQL `UPDATE ... WHERE id = ? AND tenant_id = ? AND organization_id = ?
// AND status = 'pending' AND <slot> = 'pending' AND expires_at > now()` through
// `em.nativeUpdate` — never `enforceCommandOptimisticLock`'s header compare, which is
// fail-open without a header and is not what the expiry job carries. Zero rows affected
// means the request (or the caller's own slot) already left `pending` — surfaced as
// `approval_not_pending`. Postgres row-level locking does the rest: a concurrent `UPDATE`
// targeting the SAME row blocks until the first transaction commits, then re-evaluates its
// own `WHERE` against the now-committed row — so two simultaneous decisions on the same
// slot can never both match, and two simultaneous decisions on DIFFERENT slots (policy
// `both`) each see the other's already-committed slot value when computing the new
// overall status (`computeOverallStatus` below), exactly §6.6's own description of why
// this is race-safe without a retry loop.
//
// Encryption (G22): `buyer_decision_note`/`merchant_decision_note` are registered in
// `../encryption.ts` and ARE read back for business logic — spec §6: "Decision notes are
// returned to both sides" — so every read that builds an `ApprovalView` goes through
// `findOneWithDecryption`, unlike `customerCreditService`, which never surfaces its
// encrypted fields.

export type CommerceScope = { tenantId: string; organizationId: string }
export type DecimalString = string

export type ApprovalActor =
  | { actorType: 'customer_user'; actorId: string; customerEntityId: string }
  | { actorType: 'staff_user'; actorId: string }

export type ApprovalWithdrawActor =
  | ApprovalActor
  | { actorType: 'system'; reason: 'cart_merged' | 'cart_expired' | 'cart_purged' | 'cart_converted_as_quote' }

export type ApprovalSlotView = {
  decision: CustomerPurchaseApprovalSlotDecision
  decidedBy: { actorType: CustomerPurchaseApprovalActorType; actorId: string } | null
  decidedAt: string | null
  note: string | null
}

export type ApprovalView = {
  id: string
  customerId: string
  subjectType: CustomerPurchaseApprovalSubjectType
  subjectId: string
  amountGross: DecimalString
  currencyCode: string
  approvalPolicy: CustomerGroupApprovalPolicy
  status: CustomerPurchaseApprovalStatus
  requestedBy: { actorType: CustomerPurchaseApprovalActorType; actorId: string }
  buyer: ApprovalSlotView
  merchant: ApprovalSlotView
  withdrawnReason: CustomerPurchaseApprovalWithdrawnReason | null
  decidedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export type CustomerPurchaseApprovalServiceErrorCode =
  | 'invalid_buyer'
  | 'approval_not_found'
  | 'approval_not_pending'
  | 'approval_self_decision_forbidden'
  | 'approval_withdraw_forbidden'

export type ApprovalNotPendingDetails = {
  status: CustomerPurchaseApprovalStatus
  buyerDecision: CustomerPurchaseApprovalSlotDecision
  merchantDecision: CustomerPurchaseApprovalSlotDecision
}

export class CustomerPurchaseApprovalServiceError extends Error {
  readonly code: CustomerPurchaseApprovalServiceErrorCode
  readonly details?: ApprovalNotPendingDetails

  constructor(code: CustomerPurchaseApprovalServiceErrorCode, message: string, details?: ApprovalNotPendingDetails) {
    super(message)
    this.name = 'CustomerPurchaseApprovalServiceError'
    this.code = code
    this.details = details
  }
}

export type RequestApprovalInput = {
  scope: CommerceScope
  buyer: { customerIds: string[] }
  requestedBy: ApprovalActor
  subjectType: CustomerPurchaseApprovalSubjectType
  subjectId: string
  amountGross: DecimalString
  currencyCode: string
  expiresAt?: Date
}

export type RequestApprovalResult = { approval: ApprovalView; created: boolean }

export type GetApprovalInput = { scope: CommerceScope; approvalId: string }

export type GetActiveApprovalForSubjectInput = {
  scope: CommerceScope
  subjectType: CustomerPurchaseApprovalSubjectType
  subjectId: string
}

export type WithdrawApprovalInput = {
  scope: CommerceScope
  approvalId: string
  actor: ApprovalWithdrawActor
}

export type DecideApprovalInput = {
  scope: CommerceScope
  approvalId: string
  decision: 'approved' | 'rejected'
  actor: ApprovalActor
  note?: string
  // The optimistic-lock header value is a UX layer only (§5.6) — this service does not
  // read it; `enforceCommandOptimisticLock` (or an equivalent route-level check) is the
  // route's own concern (Step 2.6), never the CAS's authority.
  expectedUpdatedAt?: string
}

export interface CustomerPurchaseApprovalService {
  requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult>
  getApproval(input: GetApprovalInput): Promise<ApprovalView | null>
  getActiveApprovalForSubject(input: GetActiveApprovalForSubjectInput): Promise<ApprovalView | null>
  withdrawApproval(input: WithdrawApprovalInput): Promise<ApprovalView>
  decideApproval(input: DecideApprovalInput): Promise<ApprovalView>
}

// D-R5-27: 14 days by default, configurable per tenant through `ModuleConfigService`
// (key below). The expiry window is only ever consulted here, at request time — the
// `expire-approvals` job (`lib/expireApprovals.ts`) compares against the already-stored
// `expires_at` column and never re-resolves the tenant setting.
const DEFAULT_APPROVAL_EXPIRY_DAYS = 14
export const APPROVAL_EXPIRY_CONFIG_MODULE_ID = 'customer_groups'
export const APPROVAL_EXPIRY_CONFIG_NAME = 'approval_expiry_days'
const DAY_IN_MS = 24 * 60 * 60 * 1000

async function resolveApprovalExpiryDays(
  moduleConfigService: ModuleConfigService | null,
  scope: CommerceScope,
): Promise<number> {
  if (!moduleConfigService) return DEFAULT_APPROVAL_EXPIRY_DAYS
  const raw = await moduleConfigService.getValue<number>(APPROVAL_EXPIRY_CONFIG_MODULE_ID, APPROVAL_EXPIRY_CONFIG_NAME, {
    defaultValue: DEFAULT_APPROVAL_EXPIRY_DAYS,
    scope: { tenantId: scope.tenantId },
  })
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_APPROVAL_EXPIRY_DAYS
}

type Slot = 'buyer' | 'merchant'

type SlotFields = {
  decision: 'buyerDecision' | 'merchantDecision'
  actorType: 'buyerDecidedByActorType' | 'merchantDecidedByActorType'
  actorId: 'buyerDecidedByActorId' | 'merchantDecidedByActorId'
  decidedAt: 'buyerDecidedAt' | 'merchantDecidedAt'
  note: 'buyerDecisionNote' | 'merchantDecisionNote'
}

const SLOT_FIELDS: Record<Slot, SlotFields> = {
  buyer: {
    decision: 'buyerDecision',
    actorType: 'buyerDecidedByActorType',
    actorId: 'buyerDecidedByActorId',
    decidedAt: 'buyerDecidedAt',
    note: 'buyerDecisionNote',
  },
  merchant: {
    decision: 'merchantDecision',
    actorType: 'merchantDecidedByActorType',
    actorId: 'merchantDecidedByActorId',
    decidedAt: 'merchantDecidedAt',
    note: 'merchantDecisionNote',
  },
}

// D-R5-1: a policy's un-named slot starts (and stays) `not_required`; the named
// slot(s) start `pending`. `both` starts both slots `pending`.
function initialSlotDecisions(
  policy: CustomerGroupApprovalPolicy,
): { buyerDecision: CustomerPurchaseApprovalSlotDecision; merchantDecision: CustomerPurchaseApprovalSlotDecision } {
  if (policy === 'buyer') return { buyerDecision: 'pending', merchantDecision: 'not_required' }
  if (policy === 'merchant') return { buyerDecision: 'not_required', merchantDecision: 'pending' }
  return { buyerDecision: 'pending', merchantDecision: 'pending' }
}

// D-R5-1: "the request is approved when both slots are approved, and one rejection from
// either side ends it as rejected." Generic over every policy: a `not_required` slot is
// always "satisfied", so a single-policy approval resolves on its one applicable slot
// without special-casing the policy value itself.
function computeOverallStatus(
  buyerDecision: CustomerPurchaseApprovalSlotDecision,
  merchantDecision: CustomerPurchaseApprovalSlotDecision,
): 'pending' | 'approved' | 'rejected' {
  if (buyerDecision === 'rejected' || merchantDecision === 'rejected') return 'rejected'
  const buyerSatisfied = buyerDecision === 'approved' || buyerDecision === 'not_required'
  const merchantSatisfied = merchantDecision === 'approved' || merchantDecision === 'not_required'
  return buyerSatisfied && merchantSatisfied ? 'approved' : 'pending'
}

function notFoundError(): CustomerPurchaseApprovalServiceError {
  return new CustomerPurchaseApprovalServiceError('approval_not_found', '[internal] purchase approval not found in scope')
}

function selfDecisionForbiddenError(): CustomerPurchaseApprovalServiceError {
  return new CustomerPurchaseApprovalServiceError(
    'approval_self_decision_forbidden',
    '[internal] the requester cannot decide their own approval request',
  )
}

function withdrawForbiddenError(): CustomerPurchaseApprovalServiceError {
  return new CustomerPurchaseApprovalServiceError(
    'approval_withdraw_forbidden',
    '[internal] only the requester may withdraw a pending approval request',
  )
}

function notPendingError(row: CustomerPurchaseApproval | null): CustomerPurchaseApprovalServiceError {
  return new CustomerPurchaseApprovalServiceError(
    'approval_not_pending',
    '[internal] approval request (or the caller\'s own slot) is no longer pending',
    row
      ? { status: row.status, buyerDecision: row.buyerDecision, merchantDecision: row.merchantDecision }
      : undefined,
  )
}

function toSlotView(
  decision: CustomerPurchaseApprovalSlotDecision,
  actorType: CustomerPurchaseApprovalActorType | null | undefined,
  actorId: string | null | undefined,
  decidedAt: Date | null | undefined,
  note: string | null | undefined,
): ApprovalSlotView {
  return {
    decision,
    decidedBy: actorType && actorId ? { actorType, actorId } : null,
    decidedAt: decidedAt ? decidedAt.toISOString() : null,
    note: note ?? null,
  }
}

// Exported so the Step 2.6 staff/portal list-and-detail routes (which read
// `CustomerPurchaseApproval` rows directly for filtering/pagination the service's own
// per-id methods don't support) serialize through the SAME shape the service itself
// returns from `getApproval`/`decideApproval`/`withdrawApproval`, rather than a second,
// drifting copy of this mapping.
export function toApprovalView(row: CustomerPurchaseApproval): ApprovalView {
  return {
    id: row.id,
    customerId: row.customerId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    amountGross: row.amountGross,
    currencyCode: row.currencyCode,
    approvalPolicy: row.approvalPolicy,
    status: row.status,
    requestedBy: { actorType: row.requestedByActorType, actorId: row.requestedByActorId },
    buyer: toSlotView(row.buyerDecision, row.buyerDecidedByActorType, row.buyerDecidedByActorId, row.buyerDecidedAt, row.buyerDecisionNote),
    merchant: toSlotView(
      row.merchantDecision,
      row.merchantDecidedByActorType,
      row.merchantDecidedByActorId,
      row.merchantDecidedAt,
      row.merchantDecisionNote,
    ),
    withdrawnReason: row.withdrawnReason ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// §10.1 `ApprovalEventPayload`. No PII — ids, amounts and decision states only,
// consistent with checkout's redaction rule. `decidedBy` is present only for the
// decide/withdraw emissions, never for `.requested`.
async function emitApprovalEvent(
  eventId:
    | 'customer_groups.approval.requested'
    | 'customer_groups.approval.approved'
    | 'customer_groups.approval.rejected'
    | 'customer_groups.approval.expired'
    | 'customer_groups.approval.withdrawn',
  row: CustomerPurchaseApproval,
  decidedBy?: { actorType: CustomerPurchaseApprovalActorType | 'system'; actorId: string | null },
): Promise<void> {
  await emitCustomerGroupsEvent(
    eventId,
    {
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      approvalId: row.id,
      customerId: row.customerId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      amountGross: row.amountGross,
      currencyCode: row.currencyCode,
      approvalPolicy: row.approvalPolicy,
      status: row.status,
      buyerDecision: row.buyerDecision,
      merchantDecision: row.merchantDecision,
      requestedBy: { actorType: row.requestedByActorType, actorId: row.requestedByActorId },
      ...(decidedBy ? { decidedBy } : {}),
      ...(row.withdrawnReason ? { withdrawnReason: row.withdrawnReason } : {}),
    },
    { persistent: true, tenantId: row.tenantId, organizationId: row.organizationId },
  )
}

export class DefaultCustomerPurchaseApprovalService implements CustomerPurchaseApprovalService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupsService: CustomerGroupsService,
    private readonly moduleConfigService: ModuleConfigService | null,
  ) {}

  private async loadDecrypted(approvalId: string, scope: CommerceScope): Promise<CustomerPurchaseApproval | null> {
    return findOneWithDecryption(
      this.em,
      CustomerPurchaseApproval,
      { id: approvalId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  }

  async requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult> {
    const { scope } = input
    const customerIds = input.buyer.customerIds.filter((id) => typeof id === 'string' && id.length > 0)
    if (!customerIds.length) {
      throw new CustomerPurchaseApprovalServiceError('invalid_buyer', '[internal] buyer.customerIds must not be empty')
    }

    // G8: idempotent per (subject_type, subject_id) WHILE PENDING — the partial unique
    // index is the authority; this pre-check only avoids the round-trip in the common
    // (non-racing) case.
    const existing = await findOneWithDecryption(
      this.em,
      CustomerPurchaseApproval,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectType: input.subjectType, subjectId: input.subjectId, status: 'pending' },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (existing) return { approval: toApprovalView(existing), created: false }

    const customerId = await resolveCompanyFirstCustomerId(this.em, customerIds, scope.tenantId)
    const terms = await this.groupsService.resolveTerms({ customerId: null, customerIds, tenantId: scope.tenantId })
    const policy = terms.approvalPolicy
    const { buyerDecision, merchantDecision } = initialSlotDecisions(policy)
    const expiryDays = await resolveApprovalExpiryDays(this.moduleConfigService, scope)
    const expiresAt = input.expiresAt ?? new Date(Date.now() + expiryDays * DAY_IN_MS)

    let created: CustomerPurchaseApproval
    try {
      created = this.em.create(CustomerPurchaseApproval, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        customerId,
        requestedByActorType: input.requestedBy.actorType,
        requestedByActorId: input.requestedBy.actorId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        amountGross: input.amountGross,
        currencyCode: input.currencyCode,
        approvalPolicy: policy,
        status: 'pending',
        buyerDecision,
        merchantDecision,
        expiresAt,
      })
      this.em.persist(created)
      await this.em.flush()
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // G8 under real concurrency: another caller's insert won the partial unique
      // index race — re-read and resolve exactly like a normal idempotent hit.
      const race = await findOneWithDecryption(
        this.em,
        CustomerPurchaseApproval,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectType: input.subjectType, subjectId: input.subjectId, status: 'pending' },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      if (!race) throw err
      return { approval: toApprovalView(race), created: false }
    }

    await emitApprovalEvent('customer_groups.approval.requested', created)
    return { approval: toApprovalView(created), created: true }
  }

  async getApproval(input: GetApprovalInput): Promise<ApprovalView | null> {
    const row = await this.loadDecrypted(input.approvalId, input.scope)
    return row ? toApprovalView(row) : null
  }

  async getActiveApprovalForSubject(input: GetActiveApprovalForSubjectInput): Promise<ApprovalView | null> {
    const row = await findOneWithDecryption(
      this.em,
      CustomerPurchaseApproval,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: 'pending',
      },
      undefined,
      { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
    )
    return row ? toApprovalView(row) : null
  }

  async withdrawApproval(input: WithdrawApprovalInput): Promise<ApprovalView> {
    const { scope, approvalId, actor } = input
    const current = await this.em.findOne(CustomerPurchaseApproval, {
      id: approvalId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!current) throw notFoundError()

    let withdrawnReason: CustomerPurchaseApprovalWithdrawnReason
    let decidedBy: { actorType: CustomerPurchaseApprovalActorType | 'system'; actorId: string | null }
    if (actor.actorType === 'system') {
      withdrawnReason = actor.reason
      decidedBy = { actorType: 'system', actorId: null }
    } else {
      // §6.6: "A `customer_user` actor must be the requester" — withdraw is requester-
      // only regardless of actor type (Release 5 only ever has `customer_user`
      // requesters, X7, but the guard itself is not type-restricted).
      if (current.requestedByActorType !== actor.actorType || current.requestedByActorId !== actor.actorId) {
        throw withdrawForbiddenError()
      }
      withdrawnReason = 'requester'
      decidedBy = { actorType: actor.actorType, actorId: actor.actorId }
    }

    const now = new Date()
    const affected = await this.em.nativeUpdate(
      CustomerPurchaseApproval,
      { id: approvalId, tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'pending' },
      { status: 'withdrawn', withdrawnReason, decidedAt: now, updatedAt: now },
    )
    if (affected === 0) {
      const fresh = await this.em.findOne(CustomerPurchaseApproval, { id: approvalId, tenantId: scope.tenantId, organizationId: scope.organizationId })
      throw notPendingError(fresh)
    }

    const final = await this.loadDecrypted(approvalId, scope)
    if (!final) throw notFoundError()
    await emitApprovalEvent('customer_groups.approval.withdrawn', final, decidedBy)
    return toApprovalView(final)
  }

  async decideApproval(input: DecideApprovalInput): Promise<ApprovalView> {
    const { scope, approvalId, decision, actor, note } = input
    const slot: Slot = actor.actorType === 'customer_user' ? 'buyer' : 'merchant'
    const fields = SLOT_FIELDS[slot]

    // Defense-in-depth guards (G24), read without a lock — informational only; the CAS
    // below is the sole authority on the transition itself.
    const current = await this.em.findOne(CustomerPurchaseApproval, {
      id: approvalId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!current) throw notFoundError()

    if (current.requestedByActorType === actor.actorType && current.requestedByActorId === actor.actorId) {
      throw selfDecisionForbiddenError()
    }

    if (actor.actorType === 'customer_user') {
      // Re-derive the actor's REAL company from `customer_accounts.CustomerUser` by id —
      // never trust `actor.customerEntityId` alone, which the route-level caller supplied
      // and could be stale or forged. A mismatch answers the SAME "not found" shape as an
      // unknown id (spec §9.2: a portal request for another company's approval answers
      // 404, never 403, so it does not disclose that the id exists).
      const actualCompanyId = await resolveCustomerUserCompanyId(this.em, actor.actorId, scope.tenantId)
      if (!actualCompanyId || actualCompanyId !== current.customerId) {
        throw notFoundError()
      }
    }

    const now = new Date()
    let affected = 0
    await this.em.transactional(async (trx) => {
      affected = await trx.nativeUpdate(
        CustomerPurchaseApproval,
        {
          id: approvalId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          status: 'pending',
          [fields.decision]: 'pending',
          expiresAt: { $gt: now },
        },
        {
          [fields.decision]: decision,
          [fields.actorType]: actor.actorType,
          [fields.actorId]: actor.actorId,
          [fields.decidedAt]: now,
          [fields.note]: note ?? null,
          updatedAt: now,
        },
      )
      if (affected === 0) return

      // Still inside the transaction, still holding the row lock our own UPDATE just
      // took: no other writer can have changed this row since. Reads the row as our
      // transaction sees it — including the slot we just set — to decide the new
      // overall status (D-R5-1).
      const fresh = await trx.findOne(CustomerPurchaseApproval, { id: approvalId }, { refresh: true })
      if (!fresh) return
      const overallStatus = computeOverallStatus(fresh.buyerDecision, fresh.merchantDecision)
      if (overallStatus !== 'pending') {
        await trx.nativeUpdate(
          CustomerPurchaseApproval,
          { id: approvalId, tenantId: scope.tenantId, status: 'pending' },
          { status: overallStatus, decidedAt: now, updatedAt: now },
        )
      }
    })

    if (affected === 0) {
      const fresh = await this.em.findOne(CustomerPurchaseApproval, { id: approvalId, tenantId: scope.tenantId, organizationId: scope.organizationId })
      throw notPendingError(fresh)
    }

    const final = await this.loadDecrypted(approvalId, scope)
    if (!final) throw notFoundError()
    // §6.6: no event for a mid-way slot decision that leaves the overall status
    // `pending` ("the other side was notified at request") — only a terminal flip emits.
    if (final.status === 'approved' || final.status === 'rejected') {
      await emitApprovalEvent(
        final.status === 'approved' ? 'customer_groups.approval.approved' : 'customer_groups.approval.rejected',
        final,
        { actorType: actor.actorType, actorId: actor.actorId },
      )
    }
    return toApprovalView(final)
  }
}

export function createCustomerPurchaseApprovalService(
  em: EntityManager,
  moduleConfigService: ModuleConfigService | null = null,
): CustomerPurchaseApprovalService {
  return new DefaultCustomerPurchaseApprovalService(em, createCustomerGroupsService(em), moduleConfigService)
}
