import {
  BUILT_IN_CAPACITY_PROVIDER_ID,
  normalizeCapacityResult,
  registerCapacityProvider,
  resolveTimesheetCapacity,
  resolveTimesheetCapacityAsync,
} from '../capacity'
import { buildCapacityDateRange, resolveCapacityForRange, CAPACITY_RESOLVER_OVERRIDE_ID } from '../capacityService'

const FLAT = () => ({ targetMinutesByDate: {}, totalTargetMinutes: null })

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const range = { from: '2026-01-01', to: '2026-01-02', workingDays: ['2026-01-01', '2026-01-02'] }

describe('EP-40 asynchronous capacity resolution (#6934)', () => {
  it('answers the flat daily target and names the built-in when nothing is registered', async () => {
    await expect(resolveTimesheetCapacityAsync('member-1', range, { ...SCOPE, dailyHours: 8 })).resolves.toEqual({
      targetMinutesByDate: { '2026-01-01': 480, '2026-01-02': 480 },
      totalTargetMinutes: 960,
      providerId: BUILT_IN_CAPACITY_PROVIDER_ID,
      isBuiltIn: true,
    })
  })

  it('awaits a provider that reads its own data and reports which provider answered', async () => {
    const dispose = registerCapacityProvider({
      id: 'test.contract_hours',
      resolve: FLAT,
      resolveAsync: async (staffMemberId) => {
        await Promise.resolve()
        return staffMemberId === 'member-1'
          ? { targetMinutesByDate: { '2026-01-01': 240 }, totalTargetMinutes: 240, label: 'Contract' }
          : { targetMinutesByDate: {}, totalTargetMinutes: 0 }
      },
    })
    try {
      await expect(resolveTimesheetCapacityAsync('member-1', range, { ...SCOPE, dailyHours: 8 })).resolves.toEqual({
        targetMinutesByDate: { '2026-01-01': 240 },
        totalTargetMinutes: 240,
        label: 'Contract',
        providerId: 'test.contract_hours',
        isBuiltIn: false,
      })
      const unscoped = await resolveTimesheetCapacityAsync('member-1', range, { dailyHours: 8 })
      expect(unscoped.isBuiltIn).toBe(true)
      expect(unscoped.totalTargetMinutes).toBe(960)
    } finally {
      dispose()
    }
  })

  it('falls back to the built-in when an async provider rejects or answers nonsense', async () => {
    const disposeRejecting = registerCapacityProvider({
      id: 'test.capacity_rejecting',
      priority: 10,
      resolve: FLAT,
      resolveAsync: async () => {
        throw new Error('[internal] contract hours table unavailable')
      },
    })
    try {
      const answer = await resolveTimesheetCapacityAsync('member-1', range, { ...SCOPE, dailyHours: 8 })
      expect(answer.isBuiltIn).toBe(true)
      expect(answer.totalTargetMinutes).toBe(960)
    } finally {
      disposeRejecting()
    }

    const disposeNonsense = registerCapacityProvider({
      id: 'test.capacity_bad_label',
      priority: 10,
      resolve: FLAT,
      resolveAsync: async () => ({ targetMinutesByDate: {}, totalTargetMinutes: 0, label: 42 }) as never,
    })
    try {
      const answer = await resolveTimesheetCapacityAsync('member-1', range, { ...SCOPE, dailyHours: 8 })
      expect(answer.providerId).toBe(BUILT_IN_CAPACITY_PROVIDER_ID)
    } finally {
      disposeNonsense()
    }
  })

  it('answers a synchronous provider through the async resolver too', async () => {
    const dispose = registerCapacityProvider({
      id: 'test.capacity_sync_only',
      resolve: () => ({ targetMinutesByDate: { '2026-01-01': 300 }, totalTargetMinutes: 300 }),
    })
    try {
      const answer = await resolveTimesheetCapacityAsync('member-1', range, { ...SCOPE, dailyHours: 8 })
      expect(answer).toMatchObject({ totalTargetMinutes: 300, providerId: 'test.capacity_sync_only', isBuiltIn: false })
    } finally {
      dispose()
    }
  })

  it('keeps the deprecated synchronous resolver on the synchronous answer', () => {
    const resolveAsync = jest.fn(async () => ({ targetMinutesByDate: {}, totalTargetMinutes: 1 }))
    const dispose = registerCapacityProvider({
      id: 'test.capacity_both',
      resolve: () => ({ targetMinutesByDate: { '2026-01-01': 120 }, totalTargetMinutes: 120 }),
      resolveAsync,
    })
    try {
      expect(resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: 8 }).totalTargetMinutes).toBe(120)
      expect(resolveAsync).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })
})

describe('normalizeCapacityResult', () => {
  it('rounds minutes, drops days outside the range and keeps the caption fields', () => {
    expect(
      normalizeCapacityResult(
        {
          targetMinutesByDate: { '2026-01-01': 240.4, '2026-02-01': 480 },
          totalTargetMinutes: 240.4,
          label: 'Contract',
          labelKey: 'app.capacity.contract',
        },
        range,
      ),
    ).toEqual({
      targetMinutesByDate: { '2026-01-01': 240 },
      totalTargetMinutes: 240,
      label: 'Contract',
      labelKey: 'app.capacity.contract',
    })
  })

  it('reads a null total as "no target anywhere"', () => {
    expect(normalizeCapacityResult({ targetMinutesByDate: { '2026-01-01': 240 }, totalTargetMinutes: null }, range)).toEqual({
      targetMinutesByDate: {},
      totalTargetMinutes: null,
    })
  })

  it('derives the total from the per-day targets so the footer matches the bars', () => {
    expect(
      normalizeCapacityResult({ targetMinutesByDate: { '2026-01-01': 240, '2026-01-02': 120 }, totalTargetMinutes: 9999 }, range)
        ?.totalTargetMinutes,
    ).toBe(360)
  })

  it('treats a null label or labelKey as absent', () => {
    expect(
      normalizeCapacityResult({ targetMinutesByDate: {}, totalTargetMinutes: 0, label: null, labelKey: null }, range),
    ).toEqual({ targetMinutesByDate: {}, totalTargetMinutes: 0 })
  })

  it('refuses a date that does not exist on the calendar', () => {
    const crossMonth = { from: '2026-02-01', to: '2026-03-31', workingDays: [] }
    expect(normalizeCapacityResult({ targetMinutesByDate: { '2026-02-30': 60 }, totalTargetMinutes: 60 }, crossMonth)).toBeNull()
    expect(normalizeCapacityResult({ targetMinutesByDate: { '2026-02-28': 60 }, totalTargetMinutes: 60 }, crossMonth)).not.toBeNull()
  })

  it('refuses negative minutes, malformed dates and missing maps', () => {
    expect(normalizeCapacityResult({ targetMinutesByDate: { '2026-01-01': -60 }, totalTargetMinutes: 0 }, range)).toBeNull()
    expect(normalizeCapacityResult({ targetMinutesByDate: {}, totalTargetMinutes: -1 }, range)).toBeNull()
    expect(normalizeCapacityResult({ targetMinutesByDate: { monday: 60 }, totalTargetMinutes: 60 }, range)).toBeNull()
    expect(normalizeCapacityResult({ totalTargetMinutes: 60 }, range)).toBeNull()
    expect(normalizeCapacityResult(Promise.resolve({}), range)).toBeNull()
  })
})

describe('resolveCapacityForRange', () => {
  it('passes the Mon–Fri days of the period as working days', () => {
    expect(buildCapacityDateRange({ from: '2026-08-21', to: '2026-08-24' })).toEqual({
      from: '2026-08-21',
      to: '2026-08-24',
      workingDays: ['2026-08-21', '2026-08-24'],
    })
  })

  it('goes through the timeCapacityResolver DI key so an override is honoured', async () => {
    const resolveCapacityAsync = jest.fn(async () => ({
      targetMinutesByDate: { '2026-08-24': 300 },
      totalTargetMinutes: 300,
      providerId: 'app.capacity',
      isBuiltIn: false,
    }))
    const container = { resolve: jest.fn(() => ({ resolveCapacityAsync })) }
    const answer = await resolveCapacityForRange({
      container,
      staffMemberId: 'member-1',
      range: { from: '2026-08-24', to: '2026-08-24' },
      ...SCOPE,
      dailyHours: 8,
    })
    expect(container.resolve).toHaveBeenCalledWith('timeCapacityResolver')
    expect(resolveCapacityAsync).toHaveBeenCalledWith(
      'member-1',
      { from: '2026-08-24', to: '2026-08-24', workingDays: ['2026-08-24'] },
      { ...SCOPE, dailyHours: 8 },
    )
    expect(answer.providerId).toBe('app.capacity')
  })

  it('falls back to the registry when an async override answers garbage or rejects', async () => {
    const garbage = { resolve: () => ({ resolveCapacityAsync: async () => ({ totalTargetMinutes: 'x' }) }) }
    const rejecting = {
      resolve: () => ({
        resolveCapacityAsync: async () => {
          throw new Error('[internal] override down')
        },
      }),
    }
    for (const container of [garbage, rejecting]) {
      const answer = await resolveCapacityForRange({
        container,
        staffMemberId: 'member-1',
        range: { from: '2026-08-24', to: '2026-08-24' },
        ...SCOPE,
        dailyHours: 8,
      })
      expect(answer).toMatchObject({ isBuiltIn: true, totalTargetMinutes: 480 })
    }
  })

  it('honours an override that replaced only the synchronous method of the default resolver', async () => {
    const container = {
      resolve: () => ({
        resolveCapacity: () => ({ targetMinutesByDate: { '2026-08-24': 90 }, totalTargetMinutes: 90 }),
        resolveCapacityAsync: resolveTimesheetCapacityAsync,
      }),
    }
    const answer = await resolveCapacityForRange({
      container,
      staffMemberId: 'member-1',
      range: { from: '2026-08-24', to: '2026-08-24' },
      ...SCOPE,
      dailyHours: 8,
    })
    expect(answer).toMatchObject({ totalTargetMinutes: 90, providerId: CAPACITY_RESOLVER_OVERRIDE_ID, isBuiltIn: false })
  })

  it('reports an override that is the stock synchronous resolver as the built-in', async () => {
    const container = { resolve: () => ({ resolveCapacity: resolveTimesheetCapacity }) }
    const answer = await resolveCapacityForRange({
      container,
      staffMemberId: 'member-1',
      range: { from: '2026-08-24', to: '2026-08-24' },
      ...SCOPE,
      dailyHours: 8,
    })
    expect(answer).toMatchObject({ isBuiltIn: true, providerId: BUILT_IN_CAPACITY_PROVIDER_ID, totalTargetMinutes: 480 })
  })

  it('treats a synchronous-only override as a contributed answer', async () => {
    const container = {
      resolve: () => ({ resolveCapacity: () => ({ targetMinutesByDate: { '2026-08-24': 120 }, totalTargetMinutes: 120 }) }),
    }
    const answer = await resolveCapacityForRange({
      container,
      staffMemberId: 'member-1',
      range: { from: '2026-08-24', to: '2026-08-24' },
      ...SCOPE,
      dailyHours: 8,
    })
    expect(answer).toEqual({
      targetMinutesByDate: { '2026-08-24': 120 },
      totalTargetMinutes: 120,
      providerId: CAPACITY_RESOLVER_OVERRIDE_ID,
      isBuiltIn: false,
    })
  })

  it('falls back to the registry when the DI key cannot be resolved', async () => {
    const container = {
      resolve: () => {
        throw new Error('[internal] not registered')
      },
    }
    const answer = await resolveCapacityForRange({
      container,
      staffMemberId: 'member-1',
      range: { from: '2026-08-24', to: '2026-08-24' },
      ...SCOPE,
      dailyHours: 8,
    })
    expect(answer.isBuiltIn).toBe(true)
    expect(answer.totalTargetMinutes).toBe(480)
  })
})
