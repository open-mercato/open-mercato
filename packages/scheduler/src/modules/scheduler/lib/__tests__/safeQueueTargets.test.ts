import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import {
  buildTrustedScheduleScope,
  sanitizeSchedulerTargetPayload,
  listSchedulerSafeQueueTargets,
  isSchedulerSafeQueue,
  canDispatchScheduleQueueTarget,
  getSchedulerQueueRequiredFeatures,
  assertSchedulerQueueTargetAuthorized,
  validateSchedulerTargetPayload,
  auditSchedulerModuleQueueRows,
} from '../safeQueueTargets'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

const REGISTRY_KEY = '__openMercatoModulesRegistry__'

beforeAll(() => {
  registerModules([
    {
      id: 'alpha',
      workers: [
        {
          id: 'alpha:workers:safe',
          queue: 'alpha-safe',
          concurrency: 1,
          schedulerSafe: true,
          handler: async () => {},
        },
        {
          id: 'alpha:workers:internal',
          queue: 'alpha-internal',
          concurrency: 1,
          handler: async () => {},
        },
        {
          id: 'alpha:workers:mixed-safe',
          queue: 'mixed-queue',
          concurrency: 1,
          schedulerSafe: true,
          handler: async () => {},
        },
        {
          id: 'alpha:workers:gated',
          queue: 'gated-queue',
          concurrency: 1,
          schedulerSafe: true,
          schedulerRequiredFeatures: ['orders.export'],
          handler: async () => {},
        },
      ],
    },
    {
      id: 'beta',
      workers: [
        {
          id: 'beta:workers:safe',
          queue: 'alpha-safe',
          concurrency: 1,
          schedulerSafe: true,
          handler: async () => {},
        },
        {
          id: 'beta:workers:freeloader',
          queue: 'mixed-queue',
          concurrency: 1,
          handler: async () => {},
        },
      ],
    },
  ] as never)
})

afterAll(() => {
  ;(globalThis as Record<string, unknown>)[REGISTRY_KEY] = null
})

describe('listSchedulerSafeQueueTargets', () => {
  it('returns only queues whose workers ALL opted into scheduling, deduplicated and sorted', () => {
    expect(listSchedulerSafeQueueTargets()).toEqual([
      { queue: 'alpha-safe', moduleId: 'alpha', requiredFeatures: [] },
      { queue: 'gated-queue', moduleId: 'alpha', requiredFeatures: ['orders.export'] },
    ])
  })

  it('hides a queue when even one consumer did not opt in (#5213 M2)', () => {
    // mixed-queue: alpha opts in, beta does not — the whole queue must stay hidden
    expect(isSchedulerSafeQueue('mixed-queue')).toBe(false)
  })
})

describe('target descriptors', () => {
  it('surfaces required creator features from opted-in workers (#5213 M3)', () => {
    expect(getSchedulerQueueRequiredFeatures('alpha-safe')).toEqual([])
    expect(getSchedulerQueueRequiredFeatures('gated-queue')).toEqual(['orders.export'])
    expect(getSchedulerQueueRequiredFeatures('unknown')).toEqual([])
  })
})

describe('assertSchedulerQueueTargetAuthorized (#5213 M3)', () => {
  const base = { queue: 'gated-queue' } as const

  it('passes when the creator holds every required feature', async () => {
    const reason = await assertSchedulerQueueTargetAuthorized({
      ...base,
      actorUserId: 'user-1',
      tenantId: 't-1',
      organizationId: 'o-1',
      rbacService: { userHasAllFeatures: async () => true },
    })
    expect(reason).toBeNull()
  })

  it('rejects when the creator lacks a target-specific feature', async () => {
    const reason = await assertSchedulerQueueTargetAuthorized({
      ...base,
      actorUserId: 'user-1',
      tenantId: 't-1',
      organizationId: 'o-1',
      rbacService: { userHasAllFeatures: async () => false },
    })
    expect(reason).toContain('orders.export')
  })

  it('bypasses for super admins and feature-less targets', async () => {
    expect(await assertSchedulerQueueTargetAuthorized({
      ...base,
      isSuperAdmin: true,
      rbacService: { userHasAllFeatures: async () => false },
    })).toBeNull()
    expect(await assertSchedulerQueueTargetAuthorized({
      queue: 'alpha-safe',
      actorUserId: null,
    })).toBeNull()
  })
})

describe('isSchedulerSafeQueue', () => {
  it('accepts opted-in queues', () => {
    expect(isSchedulerSafeQueue('alpha-safe')).toBe(true)
  })

  it('rejects internal worker queues', () => {
    expect(isSchedulerSafeQueue('alpha-internal')).toBe(false)
  })

  it('rejects unknown, empty, and missing queues', () => {
    expect(isSchedulerSafeQueue('nope')).toBe(false)
    expect(isSchedulerSafeQueue('')).toBe(false)
    expect(isSchedulerSafeQueue(null)).toBe(false)
    expect(isSchedulerSafeQueue(undefined)).toBe(false)
  })
})

describe('canDispatchScheduleQueueTarget', () => {
  it('allows module-authored schedules to target queues their own module owns', () => {
    expect(canDispatchScheduleQueueTarget({
      targetQueue: 'alpha-internal',
      sourceType: 'module',
      sourceModule: 'alpha',
    })).toBe(true)
  })

  it('fails closed on pre-upgrade/forged module rows (#5213 B1)', () => {
    // legacy row without any recorded owner
    expect(canDispatchScheduleQueueTarget({ targetQueue: 'alpha-internal', sourceType: 'module' })).toBe(false)
    // row claiming a module that does not own the queue — e.g. data_sync → stripe-webhook
    expect(canDispatchScheduleQueueTarget({
      targetQueue: 'stripe-webhook',
      sourceType: 'module',
      sourceModule: 'data_sync',
    })).toBe(false)
    expect(canDispatchScheduleQueueTarget({
      targetQueue: 'alpha-internal',
      sourceType: 'module',
      sourceModule: 'beta',
    })).toBe(false)
  })

  it('restricts user-authored schedules to scheduler-safe queues', () => {
    expect(canDispatchScheduleQueueTarget({ targetQueue: 'alpha-safe', sourceType: 'user' })).toBe(true)
    expect(canDispatchScheduleQueueTarget({ targetQueue: 'stripe-webhook', sourceType: 'user' })).toBe(false)
  })

  it('rejects schedules without a queue', () => {
    expect(canDispatchScheduleQueueTarget({ targetQueue: null })).toBe(false)
    expect(canDispatchScheduleQueueTarget({})).toBe(false)
  })
})

describe('validateSchedulerTargetPayload (#5213 M3)', () => {
  it('enforces registered schemas for known targets', async () => {
    expect(validateSchedulerTargetPayload('scheduler-test', { message: 'hi' })).toBeNull()
    expect(validateSchedulerTargetPayload('scheduler-test', { message: 123 })).toMatch(/message/)
    expect(validateSchedulerTargetPayload('unregistered-queue', { anything: true })).toBeNull()
  })
})

describe('buildTrustedScheduleScope', () => {
  it('derives scope exclusively from the stored schedule row', () => {
    expect(buildTrustedScheduleScope({ tenantId: 't1', organizationId: 'o1' }))
      .toEqual({ tenantId: 't1', organizationId: 'o1' })
    expect(buildTrustedScheduleScope({}))
      .toEqual({ tenantId: null, organizationId: null })
  })
})

describe('sanitizeSchedulerTargetPayload', () => {
  const schedule = { tenantId: 't-1', organizationId: 'o-1' }

  it('strips caller-supplied authority keys at the payload root', () => {
    const result = sanitizeSchedulerTargetPayload({
      scope: { tenantId: 'forged', organizationId: 'forged' },
      tenantId: 'forged',
      organizationId: 'forged',
      keep: 'me',
    }, schedule)

    expect(result).toEqual({
      keep: 'me',
      scope: { tenantId: 't-1', organizationId: 'o-1' },
    })
  })

  it('strips reserved keys inside the local-strategy payload wrapper level', () => {
    const result = sanitizeSchedulerTargetPayload({
      payload: {
        nested: 'data',
        scope: { tenantId: 'forged' },
        _jobOrigin: 'inbound-webhook',
      },
    }, schedule)

    expect(result).toEqual({
      payload: { nested: 'data' },
      scope: { tenantId: 't-1', organizationId: 'o-1' },
    })
  })

  it('strips the reserved underscore-prefixed envelope namespace', () => {
    const result = sanitizeSchedulerTargetPayload({
      _idempotencyKey: 'forged',
      _jobOrigin: 'inbound-webhook',
      data: 1,
    }, schedule)

    expect(result).toEqual({
      data: 1,
      scope: { tenantId: 't-1', organizationId: 'o-1' },
    })
  })

  it('does not mutate the input payload', () => {
    const input = {
      scope: { tenantId: 'forged' },
      deep: { value: { x: 1 } },
    }
    const snapshot = structuredClone(input)

    sanitizeSchedulerTargetPayload(input, schedule)

    expect(input).toEqual(snapshot)
  })

  it('injects trusted scope for empty and missing payloads', () => {
    expect(sanitizeSchedulerTargetPayload(null, schedule))
      .toEqual({ scope: { tenantId: 't-1', organizationId: 'o-1' } })
    expect(sanitizeSchedulerTargetPayload({}, schedule))
      .toEqual({ scope: { tenantId: 't-1', organizationId: 'o-1' } })
  })
})

describe('auditSchedulerModuleQueueRows (#5213 B1-residual-2)', () => {
  it('flags API-key-authored forgeries that the runtime guard cannot distinguish', () => {
    // A non-user-bound API key stamps no actor: at rest this row is
    // indistinguishable from a genuine registration even though it was forged
    // pre-upgrade. The runtime guard must keep allowing it (it cannot know),
    // and the audit must surface it for operator review.
    const apiKeyForged = {
      id: 'row-forged',
      name: 'Looks legitimate',
      targetQueue: 'alpha-internal',
      sourceType: 'module',
      sourceModule: 'alpha',
      createdByUserId: null,
      isEnabled: true,
    }
    const genuine = { ...apiKeyForged, id: 'row-genuine', name: 'Real registration' }
    const mismatched = {
      ...apiKeyForged,
      id: 'row-mismatched',
      targetQueue: 'stripe-webhook',
      sourceModule: 'alpha',
    }

    const audits = auditSchedulerModuleQueueRows([apiKeyForged, genuine, mismatched])

    expect(audits).toHaveLength(3)
    const forged = audits.find((a) => a.scheduleId === 'row-forged')
    expect(forged?.dispatchAllowed).toBe(true)
    // the mismatched-name row fails closed and is reported as blocked
    expect(audits.find((a) => a.scheduleId === 'row-mismatched')?.dispatchAllowed).toBe(false)
    expect(audits.find((a) => a.scheduleId === 'row-genuine')?.dispatchAllowed).toBe(true)
  })

  it('ignores user-authored rows entirely', () => {
    const audits = auditSchedulerModuleQueueRows([
      { id: 'row-user', targetQueue: 'alpha-internal', sourceType: 'user', sourceModule: null },
    ])
    expect(audits).toHaveLength(0)
  })
})
