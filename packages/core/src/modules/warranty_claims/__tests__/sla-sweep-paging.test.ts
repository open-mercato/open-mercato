import type { EntityManager } from '@mikro-orm/postgresql'
import type { WarrantyClaim } from '../data/entities'
import type { WarrantyClaimEffectiveSettings } from '../lib/settings'

const emitWarrantyClaimsEventMock = jest.fn<Promise<void>, [string, unknown, unknown?]>()
const resolveEffectiveWarrantyClaimSettingsMock = jest.fn<Promise<WarrantyClaimEffectiveSettings>, [unknown, unknown]>()

let mockBacklog: WarrantyClaim[] = []
const mockQueryCalls: Array<{ limit: unknown; cursor: { slaDueAt: Date; id: string } | null }> = []

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: (eventId: string, payload: unknown, options?: unknown) =>
    emitWarrantyClaimsEventMock(eventId, payload, options),
}))

jest.mock('../lib/settings', () => ({
  resolveEffectiveWarrantyClaimSettings: (em: unknown, scope: unknown) =>
    resolveEffectiveWarrantyClaimSettingsMock(em, scope),
}))

jest.mock('../../notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: jest.fn(),
  buildNotificationFromType: jest.fn(),
}))

jest.mock('../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

jest.mock('../notifications', () => ({
  notificationTypes: [],
}))

// Stands in for the database: honours the keyset cursor and the page limit the
// sweep passes, so a regression that drops either one shows up as a duplicate
// visit, a skipped claim, or an unbounded read.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => null,
  findWithDecryption: async (
    _em: unknown,
    _entity: unknown,
    where: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => {
    const cursor = readCursorFromWhere(where)
    mockQueryCalls.push({ limit: options?.limit, cursor })
    const ordered = [...mockBacklog].sort(compareByKeyset)
    const after = cursor
      ? ordered.filter((claim) => compareByKeyset(claim, { slaDueAt: cursor.slaDueAt, id: cursor.id } as WarrantyClaim) > 0)
      : ordered
    const limit = typeof options?.limit === 'number' ? options.limit : after.length
    return after.slice(0, limit)
  },
}))

import handleSlaEscalationSweep from '../workers/sla-escalation-sweep'

const HOUR_MS = 60 * 60 * 1000
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const SWEEP_PAGE_SIZE = 500

function compareByKeyset(left: Pick<WarrantyClaim, 'slaDueAt' | 'id'>, right: Pick<WarrantyClaim, 'slaDueAt' | 'id'>): number {
  const leftDue = left.slaDueAt ? left.slaDueAt.getTime() : 0
  const rightDue = right.slaDueAt ? right.slaDueAt.getTime() : 0
  if (leftDue !== rightDue) return leftDue - rightDue
  return left.id.localeCompare(right.id)
}

function readCursorFromWhere(where: Record<string, unknown>): { slaDueAt: Date; id: string } | null {
  const clauses = Array.isArray(where?.$and) ? where.$and : null
  if (!clauses) return null
  for (const clause of clauses) {
    const alternatives = (clause as Record<string, unknown>)?.$or
    if (!Array.isArray(alternatives) || alternatives.length !== 2) continue
    const tieBreak = alternatives[1] as { slaDueAt?: Date; id?: { $gt?: string } }
    if (tieBreak?.slaDueAt instanceof Date && typeof tieBreak.id?.$gt === 'string') {
      return { slaDueAt: tieBreak.slaDueAt, id: tieBreak.id.$gt }
    }
  }
  return null
}

const sweepSettings: WarrantyClaimEffectiveSettings = {
  slaHours: 8,
  slaPauseOnInfoRequested: true,
  slaAtRiskThresholdPct: 75,
  autoApproveEnabled: false,
  autoApproveMaxAmount: null,
  autoApproveCurrencyCode: null,
  autoApproveRequireInWarranty: true,
  defaultWarrantyMonths: null,
  businessHours: null,
  escalationTiers: null,
  adjudicationUseRules: false,
  quarantineGrades: null,
  returnLabelProvider: null,
}

// Every claim sits at exactly the at-risk threshold, so each one that the sweep
// visits stamps `slaAtRiskNotifiedAt` exactly once.
function makeAtRiskClaim(index: number, slaDueAt: Date): WarrantyClaim {
  return {
    id: `claim-${String(index).padStart(5, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    claimNumber: `WTY-${String(index).padStart(6, '0')}`,
    claimType: 'warranty',
    status: 'submitted',
    customerId: null,
    escalationLevel: 0,
    slaDueAt,
    slaPausedAt: null,
    slaAtRiskNotifiedAt: null,
    slaBreachedNotifiedAt: null,
    submittedAt: new Date(Date.now() - 6 * HOUR_MS),
  } as unknown as WarrantyClaim
}

type SweepHandlerArgs = Parameters<typeof handleSlaEscalationSweep>

function makeSweepContext(): { ctx: SweepHandlerArgs[1]; stampedIds: string[]; clear: jest.Mock } {
  const stampedIds: string[] = []
  const nativeUpdate = jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
    const id = typeof where?.id === 'string' ? where.id : null
    if (id) {
      stampedIds.push(id)
      const claim = mockBacklog.find((candidate) => candidate.id === id)
      if (claim) Object.assign(claim, data)
    }
    return 1
  })
  const clear = jest.fn()
  const em = { nativeUpdate, clear } as unknown as EntityManager
  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`[internal] unexpected sweep dependency ${name}`)
    },
  } as unknown as SweepHandlerArgs[1]
  return { ctx, stampedIds, clear }
}

function makeSweepJob(): SweepHandlerArgs[0] {
  return {
    payload: { scope: { tenantId: TENANT_ID, organizationId: ORG_ID } },
  } as unknown as SweepHandlerArgs[0]
}

describe('warranty claim SLA sweep paging', () => {
  beforeEach(() => {
    mockBacklog = []
    mockQueryCalls.length = 0
    emitWarrantyClaimsEventMock.mockReset()
    emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
    resolveEffectiveWarrantyClaimSettingsMock.mockReset()
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...sweepSettings })
  })

  test('a backlog larger than one page is swept in bounded pages, visiting every claim exactly once', async () => {
    const dueAt = new Date(Date.now() + 2 * HOUR_MS)
    const backlogSize = SWEEP_PAGE_SIZE * 2 + 37
    // Claims repeat a small set of `slaDueAt` values so the `(slaDueAt, id)`
    // tiebreak is what carries the page boundary, not the timestamp alone. The
    // spread stays inside 50ms so every claim remains at the at-risk threshold.
    mockBacklog = Array.from({ length: backlogSize }, (_unused, index) =>
      makeAtRiskClaim(index, new Date(dueAt.getTime() - (index % 50))))

    const { ctx, stampedIds } = makeSweepContext()
    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(stampedIds).toHaveLength(backlogSize)
    expect(new Set(stampedIds).size).toBe(backlogSize)
    expect(new Set(stampedIds)).toEqual(new Set(mockBacklog.map((claim) => claim.id)))
  })

  test('every page query is capped at the sweep page size', async () => {
    const dueAt = new Date(Date.now() + 2 * HOUR_MS)
    mockBacklog = Array.from({ length: SWEEP_PAGE_SIZE + 1 }, (_unused, index) => makeAtRiskClaim(index, dueAt))

    const { ctx } = makeSweepContext()
    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(mockQueryCalls.length).toBeGreaterThan(1)
    for (const call of mockQueryCalls) {
      expect(call.limit).toBe(SWEEP_PAGE_SIZE)
    }
    expect(mockQueryCalls[0].cursor).toBeNull()
    expect(mockQueryCalls[1].cursor).not.toBeNull()
  })

  test('the identity map is released between pages so a long backlog does not accumulate', async () => {
    const dueAt = new Date(Date.now() + 2 * HOUR_MS)
    mockBacklog = Array.from({ length: SWEEP_PAGE_SIZE + 1 }, (_unused, index) => makeAtRiskClaim(index, dueAt))

    const { ctx, clear } = makeSweepContext()
    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(clear).toHaveBeenCalledTimes(mockQueryCalls.length - 1)
  })

  test('a backlog that fits in one page issues a single bounded query and never clears', async () => {
    mockBacklog = [makeAtRiskClaim(0, new Date(Date.now() + 2 * HOUR_MS))]

    const { ctx, stampedIds, clear } = makeSweepContext()
    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(mockQueryCalls).toHaveLength(1)
    expect(mockQueryCalls[0].limit).toBe(SWEEP_PAGE_SIZE)
    expect(stampedIds).toEqual([mockBacklog[0].id])
    expect(clear).not.toHaveBeenCalled()
  })
})
