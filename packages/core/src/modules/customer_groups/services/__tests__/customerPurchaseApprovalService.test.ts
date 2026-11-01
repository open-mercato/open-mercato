// Step 2.5 — unit coverage for `services/customerPurchaseApprovalService.ts` against a
// hand-built, in-memory fake `EntityManager` (same spirit as
// `customerCreditService.test.ts`'s own fake: no real database, real transaction
// semantics simulated by just invoking the callback against the same fake `em`). This
// proves the SEQUENTIAL decision logic — policy transitions (D-R5-1), decision-authority
// guards (G24), request idempotency (G8) — not a genuine concurrent-transaction race. The
// real-Postgres proof that the CAS actually serializes concurrent deciders (G6) lives in
// the sibling `customerPurchaseApprovalService.concurrency.pg.test.ts`, gated on
// `OM_CUSTOMER_GROUPS_PG_URL`.

import { randomUUID } from 'crypto'
import { CustomerPurchaseApproval } from '../../data/entities'
import type { CustomerGroupsService, ResolvedTerms } from '../customerGroupsService'

const emitCustomerGroupsEventMock = jest.fn(async () => {})
jest.mock('../../events', () => ({
  emitCustomerGroupsEvent: (...args: unknown[]) => emitCustomerGroupsEventMock(...args),
}))

// Same shortcut `customers/__tests__/configEntityCommandGuards.test.ts` and siblings use:
// forwards straight to the fake EM's own `find`/`findOne` — `isTenantDataEncryptionEnabled()`
// defaults to true, and exercising the real KMS/decrypt pipeline against a bare fake EM is
// not this file's concern (the module's own `encryption.ts` registration is what matters
// here, not the decrypt mechanics, which `shared`'s own suite covers).
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (
    em: { findOne: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options: unknown,
  ) => em.findOne(entity, where, options),
  findWithDecryption: async (
    em: { find: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options: unknown,
  ) => em.find(entity, where, options),
}))

import {
  DefaultCustomerPurchaseApprovalService,
  CustomerPurchaseApprovalServiceError,
  type ApprovalActor,
  type CommerceScope,
} from '../customerPurchaseApprovalService'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const SCOPE: CommerceScope = { tenantId: TENANT, organizationId: ORG }
const COMPANY_ID = 'company-1'
const CART_ID = 'cart-1'
const CURRENCY = 'USD'

const REQUESTER: ApprovalActor = { actorType: 'customer_user', actorId: 'customer-user-requester', customerEntityId: COMPANY_ID }
const BUYER_DECIDER: ApprovalActor = { actorType: 'customer_user', actorId: 'customer-user-decider', customerEntityId: COMPANY_ID }
const MERCHANT_DECIDER: ApprovalActor = { actorType: 'staff_user', actorId: 'staff-user-decider' }

type Row = Record<string, unknown>

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>
    if ('$gt' in ops) {
      const target = ops.$gt
      if (value instanceof Date && target instanceof Date) return value.getTime() > target.getTime()
      return (value as string) > (target as string)
    }
    if ('$lte' in ops) {
      const target = ops.$lte
      if (value instanceof Date && target instanceof Date) return value.getTime() <= target.getTime()
      return (value as string) <= (target as string)
    }
    if ('$in' in ops) return (ops.$in as unknown[]).includes(value)
  }
  if (condition === null) return value === null || value === undefined
  return value === condition
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => matchesCondition(row[key], condition))
}

type CustomerUserFixture = { id: string; tenantId: string; customerEntityId: string | null }

function createFakeEm(options: { customerUsers?: CustomerUserFixture[] } = {}) {
  const rows: Row[] = []
  const customerUsers = options.customerUsers ?? []

  const em = {
    find: async (_entity: unknown, where: Row, opts?: { limit?: number; orderBy?: unknown }) => {
      const matched = rows.filter((row) => matchesWhere(row, where)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      return opts?.limit ? matched.slice(0, opts.limit) : matched
    },
    findOne: async (_entity: unknown, where: Row) => rows.find((row) => matchesWhere(row, where)) ?? null,
    create: (_entity: unknown, data: Row) => {
      const row: Row = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      return row
    },
    persist: (row: Row) => {
      rows.push(row)
    },
    flush: async () => {
      // Partial unique index (tenant_id, subject_type, subject_id) WHERE status='pending'
      // (§5.6/G8) — simulated at flush time against every OTHER row already persisted.
      for (const row of rows) {
        if (row.status !== 'pending') continue
        const duplicates = rows.filter(
          (other) =>
            other !== row &&
            other.status === 'pending' &&
            other.tenantId === row.tenantId &&
            other.subjectType === row.subjectType &&
            other.subjectId === row.subjectId,
        )
        if (duplicates.length > 0) {
          const index = rows.indexOf(row)
          if (index !== -1) rows.splice(index, 1)
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
        }
      }
    },
    nativeUpdate: async (_entity: unknown, where: Row, set: Row) => {
      const matched = rows.filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    },
    transactional: async (cb: (trx: unknown) => Promise<unknown>) => cb(em),
    fork: () => em,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        if (sql.includes('customer_users')) {
          const id = params[0] as string
          const user = customerUsers.find((candidate) => candidate.id === id)
          return user ? [{ customer_entity_id: user.customerEntityId }] : []
        }
        // `customer_entities` kind lookup (`resolveCompanyFirstCustomerId`) — this suite
        // always passes a single-id `customerIds` array (already resolved to the
        // company) or relies on the fallback-to-first-id branch, so no row is needed.
        return []
      },
    }),
  }
  return { em, rows }
}

function allowPolicy(policy: ResolvedTerms['approvalPolicy']): CustomerGroupsService {
  return {
    resolveGroups: jest.fn(),
    resolveTerms: jest.fn(async () => ({ approvalPolicy: policy }) as unknown as ResolvedTerms),
    resolveAssortmentScope: jest.fn(),
  }
}

function buildService(em: ReturnType<typeof createFakeEm>['em'], groupsService: CustomerGroupsService) {
  return new DefaultCustomerPurchaseApprovalService(em as never, groupsService, null)
}

function seedApproval(rows: Row[], overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    customerId: COMPANY_ID,
    requestedByActorType: 'customer_user',
    requestedByActorId: REQUESTER.actorId,
    subjectType: 'cart',
    subjectId: CART_ID,
    amountGross: '1000.00',
    currencyCode: CURRENCY,
    approvalPolicy: 'both',
    status: 'pending',
    buyerDecision: 'pending',
    merchantDecision: 'pending',
    buyerDecidedByActorType: null,
    buyerDecidedByActorId: null,
    buyerDecidedAt: null,
    buyerDecisionNote: null,
    merchantDecidedByActorType: null,
    merchantDecidedByActorId: null,
    merchantDecidedAt: null,
    merchantDecisionNote: null,
    decidedAt: null,
    withdrawnReason: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
  rows.push(row)
  return row
}

beforeEach(() => {
  emitCustomerGroupsEventMock.mockClear()
})

describe('customerPurchaseApprovalService', () => {
  describe('requestApproval', () => {
    test('creates a pending request snapshotting the resolved policy, both slots pending for "both"', async () => {
      const { em, rows } = createFakeEm()
      const service = buildService(em, allowPolicy('both'))

      const result = await service.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: REQUESTER,
        subjectType: 'cart',
        subjectId: CART_ID,
        amountGross: '1000.00',
        currencyCode: CURRENCY,
      })

      expect(result.created).toBe(true)
      expect(result.approval.status).toBe('pending')
      expect(result.approval.approvalPolicy).toBe('both')
      expect(result.approval.buyer.decision).toBe('pending')
      expect(result.approval.merchant.decision).toBe('pending')
      expect(rows).toHaveLength(1)
      expect(emitCustomerGroupsEventMock).toHaveBeenCalledWith(
        'customer_groups.approval.requested',
        expect.objectContaining({ approvalId: result.approval.id, tenantId: TENANT, organizationId: ORG }),
        expect.anything(),
      )
    })

    test('sets the un-named slot to not_required for a single-sided policy', async () => {
      const { em } = createFakeEm()
      const buyerOnly = buildService(em, allowPolicy('buyer'))
      const buyerOnlyResult = await buyerOnly.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: REQUESTER,
        subjectType: 'cart',
        subjectId: CART_ID,
        amountGross: '100.00',
        currencyCode: CURRENCY,
      })
      expect(buyerOnlyResult.approval.buyer.decision).toBe('pending')
      expect(buyerOnlyResult.approval.merchant.decision).toBe('not_required')

      const { em: em2 } = createFakeEm()
      const merchantOnly = buildService(em2, allowPolicy('merchant'))
      const merchantOnlyResult = await merchantOnly.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: REQUESTER,
        subjectType: 'cart',
        subjectId: 'cart-2',
        amountGross: '100.00',
        currencyCode: CURRENCY,
      })
      expect(merchantOnlyResult.approval.buyer.decision).toBe('not_required')
      expect(merchantOnlyResult.approval.merchant.decision).toBe('pending')
    })

    test('is idempotent per (subjectType, subjectId) while pending — returns the existing request, created: false (G8)', async () => {
      const { em, rows } = createFakeEm()
      seedApproval(rows, { id: 'existing-approval' })
      const service = buildService(em, allowPolicy('both'))

      const result = await service.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: REQUESTER,
        subjectType: 'cart',
        subjectId: CART_ID,
        amountGross: '1000.00',
        currencyCode: CURRENCY,
      })

      expect(result.created).toBe(false)
      expect(result.approval.id).toBe('existing-approval')
      expect(rows).toHaveLength(1)
      expect(emitCustomerGroupsEventMock).not.toHaveBeenCalled()
    })

    test('recovers from a unique-violation race (concurrent insert won first) by re-reading the winner, same pattern as reserveCredit', async () => {
      const { em, rows } = createFakeEm()
      const service = buildService(em, allowPolicy('both'))
      const originalFlush = em.flush.bind(em)
      ;(em as unknown as { flush: typeof em.flush }).flush = async () => {
        // Simulate a concurrent requestApproval winning the insert race right between
        // this call's own pre-check and its flush.
        seedApproval(rows, { id: 'racer-approval' })
        await originalFlush()
      }

      const result = await service.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: REQUESTER,
        subjectType: 'cart',
        subjectId: CART_ID,
        amountGross: '1000.00',
        currencyCode: CURRENCY,
      })

      expect(result.created).toBe(false)
      expect(result.approval.id).toBe('racer-approval')
    })

    test('rejects an empty buyer.customerIds', async () => {
      const { em } = createFakeEm()
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.requestApproval({
          scope: SCOPE,
          buyer: { customerIds: [] },
          requestedBy: REQUESTER,
          subjectType: 'cart',
          subjectId: CART_ID,
          amountGross: '1.00',
          currencyCode: CURRENCY,
        }),
      ).rejects.toMatchObject({ code: 'invalid_buyer' })
    })
  })

  describe('decideApproval — policy "both" (D-R5-1)', () => {
    test('buyer approves then merchant approves → approved, with exactly one terminal event', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      const afterBuyer = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: BUYER_DECIDER })
      expect(afterBuyer.status).toBe('pending')
      expect(afterBuyer.buyer.decision).toBe('approved')
      expect(emitCustomerGroupsEventMock).not.toHaveBeenCalled()

      const afterMerchant = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: MERCHANT_DECIDER })
      expect(afterMerchant.status).toBe('approved')
      expect(emitCustomerGroupsEventMock).toHaveBeenCalledTimes(1)
      expect(emitCustomerGroupsEventMock).toHaveBeenCalledWith(
        'customer_groups.approval.approved',
        expect.objectContaining({
          status: 'approved',
          decidedBy: { actorType: 'staff_user', actorId: MERCHANT_DECIDER.actorId },
        }),
        expect.anything(),
      )
    })

    test('merchant approves first, then buyer → approved (order-independent)', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: MERCHANT_DECIDER })
      const final = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: BUYER_DECIDER })

      expect(final.status).toBe('approved')
    })

    test('either side rejecting ends it immediately, even with the other slot still pending', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      const result = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'rejected', actor: BUYER_DECIDER })

      expect(result.status).toBe('rejected')
      expect(result.merchant.decision).toBe('pending')
      expect(emitCustomerGroupsEventMock).toHaveBeenCalledWith('customer_groups.approval.rejected', expect.anything(), expect.anything())
    })
  })

  describe('decideApproval — single-sided policies resolve on their one applicable slot', () => {
    test('policy "buyer": a buyer approval resolves the whole request; a merchant decide answers approval_not_pending (slot not_required)', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows, { approvalPolicy: 'buyer', merchantDecision: 'not_required' })
      const service = buildService(em, allowPolicy('buyer'))

      const result = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: BUYER_DECIDER })
      expect(result.status).toBe('approved')

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: MERCHANT_DECIDER }),
      ).rejects.toMatchObject({ code: 'approval_not_pending' })
    })

    test('policy "merchant": the mirror case', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows, { approvalPolicy: 'merchant', buyerDecision: 'not_required' })
      const service = buildService(em, allowPolicy('merchant'))

      const result = await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: MERCHANT_DECIDER })
      expect(result.status).toBe('approved')
    })
  })

  describe('decideApproval — double decide on the same slot (sequential proof; real concurrency lives in the .pg.test.ts)', () => {
    test('a second decide on an already-resolved slot gets approval_not_pending', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows, { approvalPolicy: 'merchant', buyerDecision: 'not_required' })
      const service = buildService(em, allowPolicy('merchant'))

      await service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: MERCHANT_DECIDER })

      await expect(
        service.decideApproval({
          scope: SCOPE,
          approvalId: approval.id as string,
          decision: 'rejected',
          actor: { actorType: 'staff_user', actorId: 'some-other-staff-user' },
        }),
      ).rejects.toMatchObject({ code: 'approval_not_pending' })
    })

    // Mutation-test proof that this test is not vacuous: without the slot-pending AND
    // overall-pending guard in the CAS `WHERE`, the exact same sequence above would
    // succeed twice and corrupt the decision (two different deciders both "winning").
    // Demonstrated here against a local test double of the CAS step — never against the
    // real service file, which stays untouched.
    test('(mutation proof) removing the slot-pending guard from the CAS lets a second decide overwrite an already-decided slot', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows, { approvalPolicy: 'merchant', buyerDecision: 'not_required' })

      // The unguarded variant: a CAS with no `merchantDecision: 'pending'` condition —
      // exactly the mistake the real service's `decideApproval` never makes.
      const unguardedDecide = async (decision: 'approved' | 'rejected') =>
        em.nativeUpdate(CustomerPurchaseApproval, { id: approval.id, tenantId: TENANT, status: 'pending' }, { merchantDecision: decision })

      expect(await unguardedDecide('approved')).toBe(1)
      // A SECOND decide, on an already-`approved` slot, still succeeds under the
      // unguarded variant — proving the guard (not just CAS-shaped syntax) is what the
      // real test above depends on.
      expect(await unguardedDecide('rejected')).toBe(1)
      expect((approval as Row).merchantDecision).toBe('rejected')
    })
  })

  describe('decideApproval — decision-authority guards (G24)', () => {
    test('self-approval is refused: the requester cannot decide their own request', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: REQUESTER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: REQUESTER }),
      ).rejects.toMatchObject({ code: 'approval_self_decision_forbidden' })
    })

    test('a customer_user decider from a DIFFERENT company is refused with approval_not_found, not a disclosing error', async () => {
      const otherCompanyUser: ApprovalActor = { actorType: 'customer_user', actorId: 'other-company-user', customerEntityId: 'other-company' }
      const { em, rows } = createFakeEm({ customerUsers: [{ id: otherCompanyUser.actorId, tenantId: TENANT, customerEntityId: 'other-company' }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: otherCompanyUser }),
      ).rejects.toMatchObject({ code: 'approval_not_found' })
    })

    test('the cross-company check re-derives the real company from customer_users by actor id — a forged customerEntityId on the actor payload does not pass it', async () => {
      // The actor CLAIMS to belong to the approval's company, but the (defensively
      // re-checked) `customer_users` row says otherwise.
      const forgedActor: ApprovalActor = { actorType: 'customer_user', actorId: 'forged-actor', customerEntityId: COMPANY_ID }
      const { em, rows } = createFakeEm({ customerUsers: [{ id: forgedActor.actorId, tenantId: TENANT, customerEntityId: 'a-different-company' }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: forgedActor }),
      ).rejects.toMatchObject({ code: 'approval_not_found' })
    })

    test('an expired-but-not-yet-swept request refuses a decide with approval_not_pending', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows, { expiresAt: new Date(Date.now() - 1000) })
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: approval.id as string, decision: 'approved', actor: BUYER_DECIDER }),
      ).rejects.toMatchObject({ code: 'approval_not_pending' })
    })

    test('an unknown approval id answers approval_not_found', async () => {
      const { em } = createFakeEm()
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({ scope: SCOPE, approvalId: 'does-not-exist', decision: 'approved', actor: MERCHANT_DECIDER }),
      ).rejects.toMatchObject({ code: 'approval_not_found' })
    })
  })

  describe('withdrawApproval', () => {
    test('the requester withdraws their own pending request', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      const result = await service.withdrawApproval({ scope: SCOPE, approvalId: approval.id as string, actor: REQUESTER })

      expect(result.status).toBe('withdrawn')
      expect(result.withdrawnReason).toBe('requester')
      expect(emitCustomerGroupsEventMock).toHaveBeenCalledWith('customer_groups.approval.withdrawn', expect.anything(), expect.anything())
    })

    test('a non-requester withdraw is refused', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.withdrawApproval({ scope: SCOPE, approvalId: approval.id as string, actor: BUYER_DECIDER }),
      ).rejects.toMatchObject({ code: 'approval_withdraw_forbidden' })
    })

    test('a system actor withdraws regardless of requester, carrying its own reason (cart lifecycle, G8)', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      const result = await service.withdrawApproval({
        scope: SCOPE,
        approvalId: approval.id as string,
        actor: { actorType: 'system', reason: 'cart_merged' },
      })

      expect(result.status).toBe('withdrawn')
      expect(result.withdrawnReason).toBe('cart_merged')
    })

    test('withdrawing a non-pending request answers approval_not_pending', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows, { status: 'approved' })
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.withdrawApproval({ scope: SCOPE, approvalId: approval.id as string, actor: REQUESTER }),
      ).rejects.toMatchObject({ code: 'approval_not_pending' })
    })
  })

  describe('getApproval / getActiveApprovalForSubject', () => {
    test('getApproval returns null for an unknown id, and the view for a known one', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      expect(await service.getApproval({ scope: SCOPE, approvalId: 'unknown' })).toBeNull()
      const found = await service.getApproval({ scope: SCOPE, approvalId: approval.id as string })
      expect(found?.id).toBe(approval.id)
    })

    test('getActiveApprovalForSubject returns the pending request for a subject, or null once it is resolved', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      const active = await service.getActiveApprovalForSubject({ scope: SCOPE, subjectType: 'cart', subjectId: CART_ID })
      expect(active?.id).toBe(approval.id)

      ;(approval as Row).status = 'approved'
      const afterResolve = await service.getActiveApprovalForSubject({ scope: SCOPE, subjectType: 'cart', subjectId: CART_ID })
      expect(afterResolve).toBeNull()
    })
  })

  describe('tenant/organization isolation', () => {
    test('decideApproval scoped to another tenant answers approval_not_found', async () => {
      const { em, rows } = createFakeEm({ customerUsers: [{ id: BUYER_DECIDER.actorId, tenantId: TENANT, customerEntityId: COMPANY_ID }] })
      const approval = seedApproval(rows)
      const service = buildService(em, allowPolicy('both'))

      await expect(
        service.decideApproval({
          scope: { tenantId: 'other-tenant', organizationId: ORG },
          approvalId: approval.id as string,
          decision: 'approved',
          actor: BUYER_DECIDER,
        }),
      ).rejects.toMatchObject({ code: 'approval_not_found' })
    })

    test('getApproval and getActiveApprovalForSubject refuse to read a row scoped to a different organization in the same tenant', async () => {
      const { em, rows } = createFakeEm()
      const approval = seedApproval(rows, { organizationId: 'other-org' })
      const service = buildService(em, allowPolicy('both'))

      expect(await service.getApproval({ scope: SCOPE, approvalId: approval.id as string })).toBeNull()
      expect(await service.getActiveApprovalForSubject({ scope: SCOPE, subjectType: 'cart', subjectId: CART_ID })).toBeNull()
    })
  })

  test('CustomerPurchaseApprovalServiceError carries the not_pending details body (status + both slots)', async () => {
    const { em, rows } = createFakeEm()
    const approval = seedApproval(rows, { status: 'approved' })
    const service = buildService(em, allowPolicy('both'))

    await expect(
      service.withdrawApproval({ scope: SCOPE, approvalId: approval.id as string, actor: REQUESTER }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'approval_not_pending',
        details: { status: 'approved', buyerDecision: 'pending', merchantDecision: 'pending' },
      }),
    )
  })
})

describe('CustomerPurchaseApprovalServiceError', () => {
  test('is an instance of Error with a stable name', () => {
    const err = new CustomerPurchaseApprovalServiceError('approval_not_found', 'not found')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CustomerPurchaseApprovalServiceError')
  })
})
