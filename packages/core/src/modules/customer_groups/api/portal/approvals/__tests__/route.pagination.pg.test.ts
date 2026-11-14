/**
 * Review finding: `loadPortalApprovalIdPage` used to load EVERY matching
 * `CustomerPurchaseApproval` row into memory and rank/paginate it in JS — an unbounded
 * read that grows with the company's entire request history, not with `pageSize`. The
 * fix pushes the pending-first-then-newest ordering and the `limit`/`offset` into two
 * SQL queries (one per side of the pending/non-pending split). This is the live proof,
 * against a real Postgres, that the fix still produces the EXACT SAME ordering a
 * sequential-scan-and-sort would have — including the case that most risks drifting: a
 * page whose boundary falls exactly between the pending rows and the rest.
 *
 * Gated on OM_CUSTOMER_GROUPS_PG_URL — a throwaway database (the suite creates and drops
 * its own schema). Never point it at a development or shared database. Run it with:
 *
 *   docker run -d --rm --name om-customer-groups-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54374:5432 postgres:18-alpine
 *   OM_CUSTOMER_GROUPS_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/core jest route.pagination.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { CustomerPurchaseApproval } from '../../../../data/entities'
import type { PortalApprovalPrincipal } from '../../../../lib/portalApprovalAccess'
import { loadPortalApprovalIdPage } from '../route'

const PG_URL = process.env.OM_CUSTOMER_GROUPS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

// A fresh `customerEntityId` per test: `loadPortalApprovalIdPage`'s WHERE always scopes
// by it, so distinct values keep each test's rows isolated without truncating the
// shared schema between tests.
function makePrincipal(): PortalApprovalPrincipal {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    customerEntityId: randomUUID(),
    customerUserId: randomUUID(),
    canDecide: true,
  }
}

maybe('loadPortalApprovalIdPage against real Postgres', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerPurchaseApproval],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function emFor(): EntityManager {
    return orm.em.fork()
  }

  async function seedApproval(
    principal: PortalApprovalPrincipal,
    overrides: { status: string; createdAt: Date },
  ): Promise<string> {
    const em = emFor()
    const approval = em.create(CustomerPurchaseApproval, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId: principal.customerEntityId,
      requestedByActorType: 'customer_user',
      requestedByActorId: principal.customerUserId,
      subjectType: 'cart',
      subjectId: randomUUID(),
      amountGross: '100.00',
      currencyCode: 'USD',
      approvalPolicy: 'merchant',
      status: overrides.status as never,
      buyerDecision: 'not_required',
      merchantDecision: overrides.status === 'pending' ? 'pending' : 'approved',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      createdAt: overrides.createdAt,
    })
    em.persist(approval)
    await em.flush()
    return approval.id
  }

  test('ranks pending-first then newest-first, matching a full sequential scan across a page that straddles the boundary', async () => {
    const em = emFor()
    const principal = makePrincipal()
    const base = Date.now()
    // 3 pending rows (oldest to newest) + 3 non-pending rows (oldest to newest) — the
    // expected order is ALL pending newest-first, THEN all non-pending newest-first.
    const pendingIds = await Promise.all(
      [0, 1, 2].map((i) => seedApproval(principal, { status: 'pending', createdAt: new Date(base + i * 1000) })),
    )
    const otherIds = await Promise.all(
      [0, 1, 2].map((i) => seedApproval(principal, { status: 'approved', createdAt: new Date(base + 10_000 + i * 1000) })),
    )
    const expectedOrder = [...pendingIds].reverse().concat([...otherIds].reverse())

    // pageSize 2 straddles the pending/non-pending boundary on page 2 (ids[2] is the
    // last pending row, ids[3] is the first non-pending row).
    const pageSize = 2
    const page1 = await loadPortalApprovalIdPage(em, principal, 1, pageSize)
    const page2 = await loadPortalApprovalIdPage(em, principal, 2, pageSize)
    const page3 = await loadPortalApprovalIdPage(em, principal, 3, pageSize)

    expect(page1.total).toBe(6)
    expect(page1.ids).toEqual(expectedOrder.slice(0, 2))
    expect(page2.ids).toEqual(expectedOrder.slice(2, 4))
    expect(page3.ids).toEqual(expectedOrder.slice(4, 6))
  })

  test('a page entirely past the end returns no ids but the correct total', async () => {
    const em = emFor()
    const principal = makePrincipal()
    await seedApproval(principal, { status: 'pending', createdAt: new Date() })

    const result = await loadPortalApprovalIdPage(em, principal, 5, 10)

    expect(result.ids).toEqual([])
    expect(result.total).toBe(1)
  })
})
