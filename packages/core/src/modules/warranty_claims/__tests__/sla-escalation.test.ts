import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  addBusinessMillis,
  businessMillisBetween,
  slaProgressPct,
  slaProgressPctFromDue,
  type BusinessHoursConfig,
} from '../lib/businessHours'
import {
  isSlaEscalationCandidate,
  parseEscalationTiers,
  tiersToFire,
  type EscalationTier,
} from '../lib/escalation'
import type { WarrantyClaim } from '../data/entities'
import type { WarrantyClaimEffectiveSettings } from '../lib/settings'

const emitWarrantyClaimsEventMock = jest.fn<Promise<void>, [string, unknown, unknown?]>()
const resolveEffectiveWarrantyClaimSettingsMock = jest.fn<Promise<WarrantyClaimEffectiveSettings>, [unknown, unknown]>()
const enforceWithGuardsMock = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()

let mockClaims: WarrantyClaim[] = []

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

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (container: unknown, input: Record<string, unknown>) =>
    enforceWithGuardsMock(container, input),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) {
      await phase()
    }
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => mockClaims[0] ?? null,
  findWithDecryption: async () => mockClaims,
}))

import handleSlaEscalationSweep from '../workers/sla-escalation-sweep'
import { transitionClaimCommand } from '../commands/claims'

const HOUR_MS = 60 * 60 * 1000

const utcWorkweek: BusinessHoursConfig = {
  timezone: 'UTC',
  week: {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
  },
}

describe('warranty claim SLA escalation helpers', () => {
  test('businessMillisBetween falls back to wall-clock elapsed time without a config', () => {
    expect(businessMillisBetween(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T02:30:00.000Z'),
      null,
    )).toBe(2.5 * HOUR_MS)
  })

  test('businessMillisBetween skips weekends and configured holidays', () => {
    const start = new Date('2026-01-02T16:00:00.000Z')
    const end = new Date('2026-01-05T10:00:00.000Z')

    expect(businessMillisBetween(start, end, utcWorkweek)).toBe(2 * HOUR_MS)
    expect(businessMillisBetween(start, end, {
      ...utcWorkweek,
      holidays: ['2026-01-05'],
    })).toBe(1 * HOUR_MS)
  })

  test('slaProgressPct uses business time and can exceed one hundred percent', () => {
    expect(slaProgressPct(
      new Date('2026-01-05T09:00:00.000Z'),
      new Date('2026-01-05T13:00:00.000Z'),
      8,
      utcWorkweek,
    )).toBe(50)

    expect(slaProgressPct(
      new Date('2026-01-05T09:00:00.000Z'),
      new Date('2026-01-06T13:00:00.000Z'),
      8,
      utcWorkweek,
    )).toBe(150)
  })

  test('addBusinessMillis falls back to wall-clock addition without a config', () => {
    expect(addBusinessMillis(
      new Date('2026-01-01T00:00:00.000Z'),
      2.5 * HOUR_MS,
      null,
    ).toISOString()).toBe('2026-01-01T02:30:00.000Z')
  })

  test('addBusinessMillis walks weekends and holidays forward', () => {
    const fridayAfternoon = new Date('2026-01-02T16:00:00.000Z')

    expect(addBusinessMillis(fridayAfternoon, 2 * HOUR_MS, utcWorkweek).toISOString())
      .toBe('2026-01-05T10:00:00.000Z')
    expect(addBusinessMillis(fridayAfternoon, 2 * HOUR_MS, {
      ...utcWorkweek,
      holidays: ['2026-01-05'],
    }).toISOString()).toBe('2026-01-06T10:00:00.000Z')
  })

  test('addBusinessMillis is the inverse of businessMillisBetween', () => {
    const start = new Date('2026-01-02T11:00:00.000Z')
    const dueAt = addBusinessMillis(start, 8 * HOUR_MS, utcWorkweek)

    expect(businessMillisBetween(start, dueAt, utcWorkweek)).toBe(8 * HOUR_MS)
  })

  test('slaProgressPctFromDue anchors on the due date in the configured time base', () => {
    const dueAt = new Date('2026-01-05T13:00:00.000Z')

    expect(slaProgressPctFromDue(new Date('2026-01-05T11:00:00.000Z'), dueAt, 8, null)).toBe(75)
    expect(slaProgressPctFromDue(dueAt, dueAt, 8, null)).toBe(100)
    expect(slaProgressPctFromDue(new Date('2026-01-05T17:00:00.000Z'), dueAt, 8, null)).toBe(150)
    expect(slaProgressPctFromDue(new Date('2026-01-05T09:00:00.000Z'), dueAt, 8, utcWorkweek)).toBe(50)
  })

  test('parseEscalationTiers sorts valid tiers and drops malformed tiers', () => {
    expect(parseEscalationTiers([
      { atPct: 90, action: 'reassign', toUserId: 'user-2' },
      { atPct: '50', action: 'notify' },
      { atPct: 'bad', action: 'notify' },
      { atPct: 75, action: 'reassign' },
      { atPct: 80, action: 'page' },
      null,
    ])).toEqual([
      { atPct: 50, action: 'notify' },
      { atPct: 90, action: 'reassign', toUserId: 'user-2' },
    ])
  })

  test('tiersToFire only returns crossed tiers above the current escalation level', () => {
    const tiers: EscalationTier[] = [
      { atPct: 50, action: 'notify' },
      { atPct: 75, action: 'notify' },
      { atPct: 90, action: 'reassign', toUserId: 'user-3' },
    ]

    expect(tiersToFire(95, 1, tiers)).toEqual([
      { tierIndex: 2, tier: tiers[1] },
      { tierIndex: 3, tier: tiers[2] },
    ])
    expect(tiersToFire(95, 3, tiers)).toEqual([])
    expect(tiersToFire(70, 0, tiers)).toEqual([{ tierIndex: 1, tier: tiers[0] }])
  })

  test('isSlaEscalationCandidate excludes paused and terminal claims', () => {
    const base = {
      status: 'submitted' as const,
      slaDueAt: new Date('2026-01-05T17:00:00.000Z'),
      submittedAt: new Date('2026-01-05T09:00:00.000Z'),
      slaPausedAt: null,
    }

    expect(isSlaEscalationCandidate(base)).toBe(true)
    expect(isSlaEscalationCandidate({ ...base, slaPausedAt: new Date() })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, status: 'resolved' })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, status: 'rejected' })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, slaDueAt: null })).toBe(false)
  })
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'

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

function makeSweepClaim(fields: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    claimNumber: 'WTY-000001',
    claimType: 'warranty',
    status: 'submitted',
    customerId: null,
    escalationLevel: 0,
    slaDueAt: new Date(Date.now() + 2 * HOUR_MS),
    slaPausedAt: null,
    slaAtRiskNotifiedAt: null,
    slaBreachedNotifiedAt: null,
    submittedAt: new Date(Date.now() - 6 * HOUR_MS),
    ...fields,
  } as unknown as WarrantyClaim
}

type SweepHandlerArgs = Parameters<typeof handleSlaEscalationSweep>

function makeSweepContext(): { ctx: SweepHandlerArgs[1]; nativeUpdate: jest.Mock } {
  const nativeUpdate = jest.fn(async (_entity: unknown, _where: unknown, data: Record<string, unknown>) => {
    if (mockClaims[0]) Object.assign(mockClaims[0], data)
    return 1
  })
  const em = { nativeUpdate } as unknown as EntityManager
  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`[internal] unexpected sweep dependency ${name}`)
    },
  } as unknown as SweepHandlerArgs[1]
  return { ctx, nativeUpdate }
}

function makeSweepJob(): SweepHandlerArgs[0] {
  return {
    payload: { scope: { tenantId: TENANT_ID, organizationId: ORG_ID } },
  } as unknown as SweepHandlerArgs[0]
}

function emittedEventIds(): string[] {
  return emitWarrantyClaimsEventMock.mock.calls.map(([eventId]) => eventId)
}

describe('warranty claim SLA escalation sweep dedupe', () => {
  beforeEach(() => {
    mockClaims = []
    emitWarrantyClaimsEventMock.mockReset()
    emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
    resolveEffectiveWarrantyClaimSettingsMock.mockReset()
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...sweepSettings })
  })

  test('first sweep emits at-risk once and stamps it; second sweep does not re-emit', async () => {
    mockClaims = [makeSweepClaim()]
    const { ctx, nativeUpdate } = makeSweepContext()

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(emittedEventIds()).toEqual(['warranty_claims.claim.sla_at_risk'])
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { slaAtRiskNotifiedAt: expect.any(Date) },
    )
    expect(mockClaims[0].slaAtRiskNotifiedAt).toBeInstanceOf(Date)

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(emittedEventIds()).toEqual(['warranty_claims.claim.sla_at_risk'])
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })

  test('breach emits once, stamps both timestamps, and never re-emits', async () => {
    mockClaims = [makeSweepClaim({
      submittedAt: new Date(Date.now() - 10 * HOUR_MS),
      slaDueAt: new Date(Date.now() - 2 * HOUR_MS),
    })]
    const { ctx, nativeUpdate } = makeSweepContext()

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(emittedEventIds()).toEqual(['warranty_claims.claim.sla_breached'])
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { slaBreachedNotifiedAt: expect.any(Date), slaAtRiskNotifiedAt: expect.any(Date) },
    )
    expect(mockClaims[0].slaBreachedNotifiedAt).toBeInstanceOf(Date)
    expect(mockClaims[0].slaAtRiskNotifiedAt).toBeInstanceOf(Date)

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(emittedEventIds()).toEqual(['warranty_claims.claim.sla_breached'])
  })

  test('sweep honors the pause-shifted due date instead of elapsed-since-submission', async () => {
    mockClaims = [makeSweepClaim({
      submittedAt: new Date(Date.now() - 5 * 24 * HOUR_MS),
      slaDueAt: new Date(Date.now() + 6 * HOUR_MS),
    })]
    const { ctx } = makeSweepContext()

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(emittedEventIds()).toEqual([])
  })

  test('applies every crossed escalation tier in one sweep, not only the highest', async () => {
    mockClaims = [makeSweepClaim({
      submittedAt: new Date(Date.now() - 10 * HOUR_MS),
      slaDueAt: new Date(Date.now() - 2 * HOUR_MS),
      slaAtRiskNotifiedAt: new Date(Date.now() - HOUR_MS),
      slaBreachedNotifiedAt: new Date(Date.now() - HOUR_MS),
    })]
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({
      ...sweepSettings,
      escalationTiers: [
        { atPct: 50, action: 'reassign', toUserId: USER_ID },
        { atPct: 80, action: 'notify' },
      ],
    })
    const executeMock = jest.fn(async (
      _commandId: string,
      { input }: { input: { id: string; toLevel: number; reassignToUserId?: string } },
    ) => ({
      result: { claimId: input.id, escalationLevel: input.toLevel, escalated: true },
    }))
    const nativeUpdate = jest.fn(async () => 1)
    const em = { nativeUpdate } as unknown as EntityManager
    const ctx = {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        if (name === 'commandBus') return { execute: executeMock } as T
        throw new Error(`[internal] unexpected sweep dependency ${name}`)
      },
    } as unknown as SweepHandlerArgs[1]

    await handleSlaEscalationSweep(makeSweepJob(), ctx)

    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(executeMock.mock.calls[0][1].input).toMatchObject({ toLevel: 1, reassignToUserId: USER_ID })
    expect(executeMock.mock.calls[1][1].input).toMatchObject({ toLevel: 2 })
    expect(executeMock.mock.calls[1][1].input.reassignToUserId).toBeUndefined()
    expect(mockClaims[0].assigneeUserId).toBe(USER_ID)
  })
})

function makeCommandFork(): EntityManager {
  const kyselyBuilder = {
    select: () => kyselyBuilder,
    where: () => kyselyBuilder,
    limit: () => kyselyBuilder,
    execute: async () => [],
    executeTakeFirst: async () => undefined,
  }
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: () => undefined,
    flush: async () => undefined,
    transactional: async (fn: (tx: EntityManager) => Promise<unknown>) => fn(fork as unknown as EntityManager),
    getKysely: () => ({ selectFrom: () => kyselyBuilder }),
    fork: () => fork,
  }
  return fork as unknown as EntityManager
}

function makeCommandContext(): CommandRuntimeContext {
  const fork = makeCommandFork()
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return { fork: () => fork }
        if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unregistered test dependency ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: USER_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
}

describe('warranty claim SLA resume re-arms notification stamps', () => {
  beforeEach(() => {
    mockClaims = []
    emitWarrantyClaimsEventMock.mockReset()
    emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
    resolveEffectiveWarrantyClaimSettingsMock.mockReset()
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...sweepSettings })
    enforceWithGuardsMock.mockReset()
    enforceWithGuardsMock.mockResolvedValue(undefined)
  })

  test('resuming from info_requested clears both notification stamps', async () => {
    const claim = makeSweepClaim({
      status: 'info_requested',
      slaPausedAt: new Date(Date.now() - HOUR_MS),
      slaAtRiskNotifiedAt: new Date(Date.now() - 3 * HOUR_MS),
      slaBreachedNotifiedAt: new Date(Date.now() - 2 * HOUR_MS),
    })
    mockClaims = [claim]

    await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'in_review' }, makeCommandContext())

    expect(claim.status).toBe('in_review')
    expect(claim.slaPausedAt).toBeNull()
    expect(claim.slaAtRiskNotifiedAt).toBeNull()
    expect(claim.slaBreachedNotifiedAt).toBeNull()
  })

  test('resume preserves the business time remaining when the clock stopped', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-07T09:00:00.000Z') })
    try {
      resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...sweepSettings, businessHours: utcWorkweek })
      const claim = makeSweepClaim({
        status: 'info_requested',
        slaPausedAt: new Date('2026-01-02T16:00:00.000Z'),
        slaDueAt: new Date('2026-01-05T10:00:00.000Z'),
      })
      mockClaims = [claim]

      await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'in_review' }, makeCommandContext())

      expect(claim.slaPausedAt).toBeNull()
      expect(claim.slaDueAt?.toISOString()).toBe('2026-01-07T11:00:00.000Z')
    } finally {
      jest.useRealTimers()
    }
  })

  test('resume keeps a claim that was already past due when paused past due', async () => {
    const pastDue = new Date(Date.now() - 2 * HOUR_MS)
    const claim = makeSweepClaim({
      status: 'info_requested',
      slaPausedAt: new Date(Date.now() - HOUR_MS),
      slaDueAt: pastDue,
    })
    mockClaims = [claim]

    await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'in_review' }, makeCommandContext())

    expect(claim.slaPausedAt).toBeNull()
    expect(claim.slaDueAt?.getTime()).toBe(pastDue.getTime())
  })
})
