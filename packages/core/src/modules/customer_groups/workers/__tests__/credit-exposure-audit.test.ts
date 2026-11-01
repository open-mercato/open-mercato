// Release 5 Phase 3 (G21, Step 1.8) — the exposure-audit job recomputes `SUM(amount)`
// per `CustomerCreditAccount` and compares it against the latest ledger entry's
// `balance_after`. Proves the comparison actually catches a genuine divergence (not just
// "no crash"), and that the reused `limit_exceeded` notification fires ONLY when the
// drifting account is also over its limit.

const reportErrorMock = jest.fn()
const createCreditLimitExceededNotificationMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))
jest.mock('../../lib/creditNotifications', () => ({
  createCreditLimitExceededNotification: (...args: unknown[]) => createCreditLimitExceededNotificationMock(...args),
}))

import { randomUUID } from 'crypto'
import handle from '../credit-exposure-audit'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../data/entities'
import { DefaultCustomerCreditService, type CommerceScope } from '../../services/customerCreditService'
import type { CustomerGroupsService, ResolvedTerms } from '../../services/customerGroupsService'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const ACCOUNT_ID = 'account-1'
const CUSTOMER_ID = 'customer-1'

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    return value === condition
  })
}

function createFakeEm(tables: Map<Function, Row[]>) {
  const em = {
    find: async (entity: Function, where: Row) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
    clear: () => {},
    fork: () => em,
  }
  return em as unknown as import('@mikro-orm/postgresql').EntityManager
}

function buildCtx(em: import('@mikro-orm/postgresql').EntityManager) {
  return { resolve: <T = unknown>(name: string) => (name === 'em' ? (em as unknown as T) : (undefined as T)) }
}

function buildAccount(overrides: Partial<Row> = {}): Row {
  return {
    id: ACCOUNT_ID,
    tenantId: TENANT,
    organizationId: ORG,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    creditLimit: '100.00',
    isOnHold: false,
    deletedAt: null,
    ...overrides,
  }
}

function buildLedger(): Row[] {
  return [
    {
      id: 'entry-1',
      tenantId: TENANT,
      creditAccountId: ACCOUNT_ID,
      entryType: 'reserve',
      amount: '80.00',
      balanceAfter: '80.00',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'entry-2',
      tenantId: TENANT,
      creditAccountId: ACCOUNT_ID,
      entryType: 'adjust',
      amount: '10.00',
      // Intentionally wrong: `SUM(amount)` is 80.00 + 10.00 = 90.00, but this entry's own
      // `balance_after` claims 95.00 — the drift this job must catch.
      balanceAfter: '95.00',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    },
  ]
}

describe('customer_groups credit-exposure-audit worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('detects a drifting account and reports it without notifying when still under the limit', async () => {
    const tables = new Map<Function, Row[]>([
      [CustomerCreditAccount, [buildAccount({ creditLimit: '100.00' })]],
      [CustomerCreditLedgerEntry, buildLedger()],
    ])
    const em = createFakeEm(tables)

    await handle({ id: 'job-1', payload: { scope: { tenantId: TENANT, organizationId: ORG } }, createdAt: new Date().toISOString() }, buildCtx(em))

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'customer_groups',
        code: 'customer_groups.credit_exposure_drift',
        attributes: expect.objectContaining({ creditAccountId: ACCOUNT_ID }),
      }),
    )
    expect(createCreditLimitExceededNotificationMock).not.toHaveBeenCalled()
  })

  it('reuses the limit_exceeded notification when the drifting exposure is also over the limit', async () => {
    const tables = new Map<Function, Row[]>([
      [CustomerCreditAccount, [buildAccount({ creditLimit: '50.00' })]],
      [CustomerCreditLedgerEntry, buildLedger()],
    ])
    const em = createFakeEm(tables)

    await handle({ id: 'job-2', payload: { scope: { tenantId: TENANT, organizationId: ORG } }, createdAt: new Date().toISOString() }, buildCtx(em))

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(createCreditLimitExceededNotificationMock).toHaveBeenCalledTimes(1)
    expect(createCreditLimitExceededNotificationMock).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT,
        organizationId: ORG,
        creditAccountId: ACCOUNT_ID,
        customerId: CUSTOMER_ID,
        currencyCode: 'USD',
        requestedAmount: '90.00',
        creditLimit: '50.00',
      }),
    )
  })

  it('reports no drift when SUM(amount) matches the latest balance_after', async () => {
    const tables = new Map<Function, Row[]>([
      [CustomerCreditAccount, [buildAccount({ creditLimit: '100.00' })]],
      [
        CustomerCreditLedgerEntry,
        [
          {
            id: 'entry-1',
            tenantId: TENANT,
            creditAccountId: ACCOUNT_ID,
            entryType: 'reserve',
            amount: '80.00',
            balanceAfter: '80.00',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      ],
    ])
    const em = createFakeEm(tables)

    await handle({ id: 'job-3', payload: { scope: { tenantId: TENANT, organizationId: ORG } }, createdAt: new Date().toISOString() }, buildCtx(em))

    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(createCreditLimitExceededNotificationMock).not.toHaveBeenCalled()
  })

  it('is a no-op without a scope in the payload', async () => {
    const em = createFakeEm(new Map())
    await expect(handle({ id: 'job-4', payload: {}, createdAt: new Date().toISOString() }, buildCtx(em))).resolves.toBeUndefined()
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

// Step 6.1 (G21 gap-fill). The suite above only ever hand-seeds ledger rows directly —
// it never proves the audit reports zero drift against a ledger that
// `customerCreditService#reserveCredit` itself actually produced. This closes that gap:
// a mocked-EM equivalent of the N=20 concurrent-reserve scenario (the real-Postgres row-
// lock race lives in the sibling `customerCreditService.concurrency.pg.test.ts`, out of
// this Step's scope) against the SAME account, then the audit run against the resulting
// rows — proving `SUM(amount) === balance_after` holds for every one of them.
describe('customer_groups credit-exposure-audit worker — against a real reserveCredit-produced ledger (G21)', () => {
  const SCOPE: CommerceScope = { tenantId: TENANT, organizationId: ORG }

  function createReserveFakeEm(tables: Map<Function, Row[]>) {
    let pendingCreates: Array<{ entity: Function; row: Row }> = []
    // `createdAt` is a MikroORM `onCreate` default on the real entity (OptionalProps) —
    // this fake `create` never runs that hook, so it stamps one itself. Strictly
    // increasing per call (never `Date.now()`, which can tie within the same
    // millisecond) so `pickLatestEntry`'s chronological-order comparison stays
    // deterministic across 20+ sequential writes.
    let createdAtCounter = 0
    const nextCreatedAt = () => new Date(Date.UTC(2026, 0, 1) + createdAtCounter++)
    const em: any = {
      find: async (entity: Function, where: Row) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
      findOne: async (entity: Function, where: Row) => (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
      create: (entity: Function, data: Row) => {
        const row: Row = { id: randomUUID(), createdAt: nextCreatedAt(), ...data }
        pendingCreates.push({ entity, row })
        return row
      },
      persist: () => {},
      flush: async () => {
        const toApply = pendingCreates
        pendingCreates = []
        for (const { entity, row } of toApply) {
          const rows = tables.get(entity) ?? []
          rows.push(row)
          tables.set(entity, rows)
        }
      },
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
      clear: () => {},
      fork: () => em,
    }
    return em
  }

  function allowTermsGroupsService(): CustomerGroupsService {
    return {
      resolveGroups: jest.fn(),
      resolveTerms: jest.fn(async () => ({ allowPurchaseOnAccount: true }) as unknown as ResolvedTerms),
      resolveAssortmentScope: jest.fn(),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reports zero drift after 20 sequential reserveCredit calls against the same account', async () => {
    const tables = new Map<Function, Row[]>([[CustomerCreditAccount, [buildAccount({ creditLimit: '10000.00' })]]])
    const em = createReserveFakeEm(tables)
    const service = new DefaultCustomerCreditService(em, allowTermsGroupsService())

    for (let i = 0; i < 20; i += 1) {
      const result = await service.reserveCredit({
        scope: SCOPE,
        buyer: { customerId: CUSTOMER_ID },
        currencyCode: 'USD',
        amount: '50.00',
        sourceType: 'checkout',
        sourceId: `session-${i}`,
        idempotencyKey: `reserve-${i}`,
      })
      expect(result.reserved).toBe(true)
    }

    expect(tables.get(CustomerCreditLedgerEntry)).toHaveLength(20)

    await handle(
      { id: 'job-g21-1', payload: { scope: { tenantId: TENANT, organizationId: ORG } }, createdAt: new Date().toISOString() },
      buildCtx(em),
    )

    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(createCreditLimitExceededNotificationMock).not.toHaveBeenCalled()
  })

  it('reports zero drift after a mixed sequence of reserves and releases against the same account', async () => {
    const tables = new Map<Function, Row[]>([[CustomerCreditAccount, [buildAccount({ creditLimit: '10000.00' })]]])
    const em = createReserveFakeEm(tables)
    const service = new DefaultCustomerCreditService(em, allowTermsGroupsService())

    for (let i = 0; i < 20; i += 1) {
      const result = await service.reserveCredit({
        scope: SCOPE,
        buyer: { customerId: CUSTOMER_ID },
        currencyCode: 'USD',
        amount: '50.00',
        sourceType: 'checkout',
        sourceId: `session-${i}`,
        idempotencyKey: `reserve-${i}`,
      })
      expect(result.reserved).toBe(true)
      // Every third reservation is immediately released, so the resulting ledger mixes
      // `reserve` and `release` entries — the same SUM(amount) comparison must still hold.
      if (i % 3 === 0) {
        const released = await service.releaseCredit({
          scope: SCOPE,
          reserveIdempotencyKey: `reserve-${i}`,
          reason: 'cancelled',
        })
        expect(released.released).toBe(true)
      }
    }

    await handle(
      { id: 'job-g21-2', payload: { scope: { tenantId: TENANT, organizationId: ORG } }, createdAt: new Date().toISOString() },
      buildCtx(em),
    )

    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(createCreditLimitExceededNotificationMock).not.toHaveBeenCalled()
  })
})
