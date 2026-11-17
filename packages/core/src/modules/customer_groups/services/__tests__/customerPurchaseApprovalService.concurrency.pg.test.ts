/**
 * Real-Postgres concurrency proof for `customerPurchaseApprovalService` (G6, spec §6.6,
 * §13 "double decide... exactly one wins", "decide versus expiry at the boundary
 * instant", "requestApproval twice for the same cart... also under concurrency").
 *
 * `customerPurchaseApprovalService.test.ts` already proves the SEQUENTIAL decision
 * logic (policy transitions, G24 guards, idempotency) against a fake, single-threaded
 * `EntityManager`. This file is the live proof that the CAS (`em.nativeUpdate` inside
 * `em.transactional`) actually serializes concurrent writers against a REAL Postgres: N
 * real MikroORM EntityManagers, each with its own connection out of the pool, racing the
 * SAME row.
 *
 * Gated on OM_CUSTOMER_GROUPS_PG_URL — a throwaway database, since the suite creates and
 * drops its own schema (same convention as the sibling `customerCreditService.concurrency
 * .pg.test.ts`). Never point it at a development or shared database. Run it with:
 *
 *   docker run -d --rm --name om-customer-groups-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54374:5432 postgres:18-alpine
 *   OM_CUSTOMER_GROUPS_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/core jest customerPurchaseApprovalService.concurrency.pg
 */
import 'reflect-metadata'
import { randomBytes, randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { CustomerPurchaseApproval } from '../../data/entities'
import {
  DefaultCustomerPurchaseApprovalService,
  type ApprovalActor,
  type CommerceScope,
  type CustomerPurchaseApprovalService,
} from '../customerPurchaseApprovalService'
import type { CustomerGroupsService, ResolvedTerms } from '../customerGroupsService'
import { expirePendingApprovals } from '../../lib/expireApprovals'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import * as customFieldValuesModule from '@open-mercato/shared/lib/encryption/customFieldValues'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const PG_URL = process.env.OM_CUSTOMER_GROUPS_PG_URL ?? ''
const PARALLEL = Number(process.env.OM_CUSTOMER_GROUPS_RACE_PARALLEL ?? '20')
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const CURRENCY = 'USD'
const SCOPE: CommerceScope = { tenantId: TENANT_ID, organizationId: ORG_ID }

// This suite is about the CAS, not terms resolution (G11) — a fixed stub keeps the
// schema to just `CustomerPurchaseApproval`, same simplification the credit concurrency
// suite's own `ALWAYS_ALLOWED_GROUPS_SERVICE` makes.
function groupsServiceWithPolicy(policy: 'buyer' | 'merchant' | 'both'): CustomerGroupsService {
  return {
    resolveGroups: async () => ({ groupIds: [], groups: [] }),
    resolveTerms: async () => ({ approvalPolicy: policy }) as unknown as ResolvedTerms,
    resolveAssortmentScope: async () => ({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null }),
  }
}

maybe('customerPurchaseApprovalService under real concurrency (G6)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerPurchaseApproval],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: PARALLEL * 2 + 4 },
    })
    await orm.schema.refresh()
    // `resolveCustomerUserCompanyId` (G24's cross-company defense-in-depth check) queries
    // `customer_accounts.CustomerUser`'s own table by raw SQL (FK-id coupling, no ORM
    // import) — a minimal stand-in table satisfies that query shape in this disposable
    // schema without pulling the whole `customer_accounts` module's entities in.
    await orm.em.getConnection().execute(
      'create table if not exists customer_users (id uuid primary key, tenant_id uuid not null, customer_entity_id uuid, deleted_at timestamptz)',
    )
    // C1's own regression (below) needs the REAL policy table `TenantDataEncryptionService`
    // reads via raw SQL (`loadPolicy`) — same minimal stand-in convention as `customer_users`
    // above, with exactly the columns that query selects.
    await orm.em.getConnection().execute(
      `create table if not exists encryption_maps (
        id uuid primary key default gen_random_uuid(),
        entity_id text not null,
        tenant_id uuid,
        organization_id uuid,
        fields_json jsonb,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        deleted_at timestamptz
      )`,
    )
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function serviceFor(em: EntityManager, policy: 'buyer' | 'merchant' | 'both'): CustomerPurchaseApprovalService {
    return new DefaultCustomerPurchaseApprovalService(em, groupsServiceWithPolicy(policy), null)
  }

  async function seedApproval(
    overrides: Partial<{
      approvalPolicy: 'buyer' | 'merchant' | 'both'
      buyerDecision: 'pending' | 'not_required'
      merchantDecision: 'pending' | 'not_required'
      expiresAt: Date
    }> = {},
  ): Promise<string> {
    const em = orm.em.fork()
    const approval = em.create(CustomerPurchaseApproval, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId: COMPANY_ID,
      requestedByActorType: 'customer_user',
      requestedByActorId: randomUUID(),
      subjectType: 'cart',
      subjectId: randomUUID(),
      amountGross: '1000.00',
      currencyCode: CURRENCY,
      approvalPolicy: overrides.approvalPolicy ?? 'both',
      status: 'pending',
      buyerDecision: overrides.buyerDecision ?? 'pending',
      merchantDecision: overrides.merchantDecision ?? 'pending',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000),
    })
    em.persist(approval)
    await em.flush()
    return approval.id
  }

  async function insertCustomerUser(customerEntityId: string): Promise<string> {
    const id = randomUUID()
    await orm.em.getConnection().execute('insert into customer_users (id, tenant_id, customer_entity_id) values (?, ?, ?)', [
      id,
      TENANT_ID,
      customerEntityId,
    ])
    return id
  }

  test(`${PARALLEL} concurrent decideApproval calls on the SAME slot — exactly one wins, the rest get approval_not_pending (G6)`, async () => {
    const approvalId = await seedApproval({ approvalPolicy: 'merchant', buyerDecision: 'not_required' })

    const attempts = Array.from({ length: PARALLEL }, (_unused, index) => {
      // Each caller forks its OWN EntityManager — a real, independent connection out of
      // the pool — so the only thing that can prevent a double win is the CAS itself.
      const em = orm.em.fork()
      const service = serviceFor(em, 'merchant')
      const actor: ApprovalActor = { actorType: 'staff_user', actorId: randomUUID() }
      return service
        .decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor })
        .then((approval) => ({ ok: true as const, approval }))
        .catch((error: { code?: string }) => ({ ok: false as const, code: error.code }))
    })

    const results = await Promise.all(attempts)
    const wins = results.filter((result) => result.ok)
    const losses = results.filter((result) => !result.ok)

    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(PARALLEL - 1)
    for (const loss of losses) {
      expect((loss as { code?: string }).code).toBe('approval_not_pending')
    }

    const em = orm.em.fork()
    const final = await em.findOne(CustomerPurchaseApproval, { id: approvalId })
    expect(final?.status).toBe('approved')
    expect(final?.merchantDecision).toBe('approved')
  })

  test(`policy "both": ${PARALLEL} concurrent decideApproval calls on the SAME (buyer) slot — exactly one wins, even though the OTHER slot staying "pending" means the overall status never flips to guard it`, async () => {
    // Deliberately the harder case than the single-slot test above: with policy "both",
    // a lone buyer decision leaves the overall `status` at `pending` (§6.6 — it only
    // flips once BOTH required slots are settled), so the overall-status condition in
    // the CAS WHERE cannot be what excludes a second buyer decider here. Only the
    // slot-specific `buyerDecision = 'pending'` condition can — this is the scenario the
    // mutation test (removing just that condition) targets.
    const buyerActorId = await insertCustomerUser(COMPANY_ID)
    const approvalId = await seedApproval({ approvalPolicy: 'both' })

    const attempts = Array.from({ length: PARALLEL }, () => {
      const em = orm.em.fork()
      const service = serviceFor(em, 'both')
      const actor: ApprovalActor = { actorType: 'customer_user', actorId: buyerActorId, customerEntityId: COMPANY_ID }
      return service
        .decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor })
        .then(() => ({ ok: true as const }))
        .catch((error: { code?: string }) => ({ ok: false as const, code: error.code }))
    })

    const results = await Promise.all(attempts)
    const wins = results.filter((result) => result.ok)
    const losses = results.filter((result) => !result.ok)

    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(PARALLEL - 1)
    for (const loss of losses) {
      expect((loss as { code?: string }).code).toBe('approval_not_pending')
    }

    const em = orm.em.fork()
    const final = await em.findOne(CustomerPurchaseApproval, { id: approvalId })
    expect(final?.status).toBe('pending') // merchant has not decided yet
    expect(final?.buyerDecision).toBe('approved')
  })

  test('policy "both": simultaneous buyer and merchant approvals from DIFFERENT real connections both land, final status approved', async () => {
    const buyerActorId = await insertCustomerUser(COMPANY_ID)
    const approvalId = await seedApproval({ approvalPolicy: 'both' })

    const buyerEm = orm.em.fork()
    const merchantEm = orm.em.fork()
    const buyerActor: ApprovalActor = { actorType: 'customer_user', actorId: buyerActorId, customerEntityId: COMPANY_ID }
    const merchantActor: ApprovalActor = { actorType: 'staff_user', actorId: randomUUID() }

    const [buyerResult, merchantResult] = await Promise.all([
      serviceFor(buyerEm, 'both').decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor: buyerActor }),
      serviceFor(merchantEm, 'both').decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor: merchantActor }),
    ])

    // Whichever one committed second sees the other's already-committed slot and flips
    // the overall status — exactly one of the two results is `approved`, and a fresh read
    // confirms the row itself landed on `approved` with BOTH slots recorded.
    expect([buyerResult.status, merchantResult.status]).toContain('approved')
    const em = orm.em.fork()
    const final = await em.findOne(CustomerPurchaseApproval, { id: approvalId })
    expect(final?.status).toBe('approved')
    expect(final?.buyerDecision).toBe('approved')
    expect(final?.merchantDecision).toBe('approved')
  })

  test('policy "both": a simultaneous reject on one side and approve on the other ends rejected, regardless of commit order', async () => {
    const buyerActorId = await insertCustomerUser(COMPANY_ID)
    const approvalId = await seedApproval({ approvalPolicy: 'both' })

    const buyerEm = orm.em.fork()
    const merchantEm = orm.em.fork()
    const buyerActor: ApprovalActor = { actorType: 'customer_user', actorId: buyerActorId, customerEntityId: COMPANY_ID }
    const merchantActor: ApprovalActor = { actorType: 'staff_user', actorId: randomUUID() }

    const [buyerOutcome, merchantOutcome] = await Promise.allSettled([
      serviceFor(buyerEm, 'both').decideApproval({ scope: SCOPE, approvalId, decision: 'rejected', actor: buyerActor }),
      serviceFor(merchantEm, 'both').decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor: merchantActor }),
    ])

    // When the reject commits first the request is already terminal, so the approve that
    // follows is refused with `approval_not_pending`; when the approve commits first it only
    // fills its own slot and the reject still lands. The reject can never be the refused one.
    expect(buyerOutcome.status).toBe('fulfilled')
    if (merchantOutcome.status === 'rejected') {
      expect((merchantOutcome.reason as { code?: string }).code).toBe('approval_not_pending')
    }
    const em = orm.em.fork()
    const final = await em.findOne(CustomerPurchaseApproval, { id: approvalId })
    expect(final?.status).toBe('rejected')
    expect(final?.buyerDecision).toBe('rejected')
  })

  test('decide versus expire at the boundary: an already-past-due pending row always expires, never decides, even racing a real concurrent decide attempt', async () => {
    const approvalId = await seedApproval({ approvalPolicy: 'merchant', buyerDecision: 'not_required', expiresAt: new Date(Date.now() - 1000) })

    const decideEm = orm.em.fork()
    const decideActor: ApprovalActor = { actorType: 'staff_user', actorId: randomUUID() }
    const expireContainer = { resolve: <T = unknown>(name: string) => (name === 'em' ? (orm.em as unknown as T) : (undefined as T)) }

    const [decideOutcome] = await Promise.all([
      serviceFor(decideEm, 'merchant')
        .decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor: decideActor })
        .then(() => ({ ok: true as const }))
        .catch((error: { code?: string }) => ({ ok: false as const, code: error.code })),
      expirePendingApprovals(expireContainer, { tenantId: TENANT_ID }),
    ])

    expect(decideOutcome.ok).toBe(false)
    expect((decideOutcome as { code?: string }).code).toBe('approval_not_pending')

    const em = orm.em.fork()
    const final = await em.findOne(CustomerPurchaseApproval, { id: approvalId })
    expect(final?.status).toBe('expired')
  })

  test(`${PARALLEL} concurrent requestApproval calls for the SAME subject create exactly one pending row (G8)`, async () => {
    const subjectId = randomUUID()
    const groupsService = groupsServiceWithPolicy('both')

    const attempts = Array.from({ length: PARALLEL }, () => {
      const em = orm.em.fork()
      const service = new DefaultCustomerPurchaseApprovalService(em, groupsService, null)
      return service.requestApproval({
        scope: SCOPE,
        buyer: { customerIds: [COMPANY_ID] },
        requestedBy: { actorType: 'customer_user', actorId: randomUUID(), customerEntityId: COMPANY_ID },
        subjectType: 'cart',
        subjectId,
        amountGross: '500.00',
        currencyCode: CURRENCY,
      })
    })

    const results = await Promise.all(attempts)
    const created = results.filter((result) => result.created)
    expect(created).toHaveLength(1)
    const distinctIds = new Set(results.map((result) => result.approval.id))
    expect(distinctIds.size).toBe(1)

    const em = orm.em.fork()
    const rows = await em.find(CustomerPurchaseApproval, { tenantId: TENANT_ID, subjectType: 'cart', subjectId, status: 'pending' })
    expect(rows).toHaveLength(1)
  })

  describe('decideApproval note encryption (C1 — nativeUpdate bypasses the beforeUpdate subscriber)', () => {
    const previousEncryption = process.env.TENANT_DATA_ENCRYPTION

    beforeAll(async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'yes'
      // The subscriber's read-side decrypt resolves `entityId` from ORM metadata through
      // this registry (`resolveEntityIdFromMetadata`) — never populated in this isolated
      // PG suite (no app bootstrap registers it), so without this the decrypt silently
      // no-ops (unresolved entityId) and the regression below would pass for the wrong
      // reason (nothing ever decrypts, ciphertext just never got attempted either way).
      registerEntityIds({ customer_groups: { customer_purchase_approval: 'customer_groups:customer_purchase_approval' } })
      await orm.em.getConnection().execute(
        'insert into encryption_maps (entity_id, tenant_id, organization_id, fields_json, is_active) values (?, ?, null, ?, true)',
        [
          'customer_groups:customer_purchase_approval',
          TENANT_ID,
          JSON.stringify([{ field: 'buyer_decision_note' }, { field: 'merchant_decision_note' }]),
        ],
      )
    })

    afterAll(async () => {
      if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
      registerEntityIds({})
      await orm.em.getConnection().execute('delete from encryption_maps where tenant_id = ?', [TENANT_ID])
    })

    test('stores the decision note as ciphertext at rest and still returns the readable note from the API', async () => {
      const approvalId = await seedApproval({ approvalPolicy: 'merchant', buyerDecision: 'not_required' })
      const plaintext = 'approved — matches the quoted volume discount, PO #44821'
      const em = orm.em.fork()
      // `decideApproval`'s own pre-transaction encrypt AND its final `loadDecrypted` read
      // each independently call `resolveTenantEncryptionService(this.em)` with no `provided`
      // override — passing one there (as this helper otherwise allows) is a cache MISS, not
      // a seed, so it would only cover the first of the two calls. Replace the helper itself
      // for the duration of this test so both call sites deterministically share ONE fake
      // KMS-backed service — this suite's disposable schema has no real Vault, and the point
      // here is the encrypt/decrypt round-trip through the real service, not which KMS
      // backend answers it.
      const key = randomBytes(32).toString('base64')
      const fakeEncryptionService = new TenantDataEncryptionService(em, {
        kms: {
          isHealthy: () => true,
          getTenantDek: async (tenantId) => ({ tenantId, key, fetchedAt: Date.now() }),
          createTenantDek: async (tenantId) => ({ tenantId, key, fetchedAt: Date.now() }),
        },
      })
      const resolveSpy = jest
        .spyOn(customFieldValuesModule, 'resolveTenantEncryptionService')
        .mockReturnValue(fakeEncryptionService)

      let result: Awaited<ReturnType<CustomerPurchaseApprovalService['decideApproval']>>
      try {
        const service = serviceFor(em, 'merchant')
        const actor: ApprovalActor = { actorType: 'staff_user', actorId: randomUUID() }
        result = await service.decideApproval({ scope: SCOPE, approvalId, decision: 'approved', actor, note: plaintext })
      } finally {
        resolveSpy.mockRestore()
      }

      // Readable from the API: `loadDecrypted` inside `decideApproval` decrypts it back.
      expect(result.merchant.note).toBe(plaintext)

      // Ciphertext at rest: the raw column, read without going through the service/ORM
      // decrypt path, must never equal the plaintext and must look like a sealed envelope.
      const [raw] = (await orm.em.getConnection().execute(
        'select merchant_decision_note from customer_purchase_approvals where id = ?',
        [approvalId],
      )) as Array<{ merchant_decision_note: string | null }>
      expect(raw?.merchant_decision_note).toBeTruthy()
      expect(raw?.merchant_decision_note).not.toBe(plaintext)
      expect(isEncryptedPayloadShape(raw?.merchant_decision_note)).toBe(true)
    })
  })
})
