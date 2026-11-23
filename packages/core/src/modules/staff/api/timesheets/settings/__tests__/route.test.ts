import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const configStore = new Map<string, unknown>()
const storeKey = (tenantId: string | null | undefined, name: string) => `${tenantId ?? 'global'}::${name}`

const setValueSpy = jest.fn()
const setTenantValuesSpy = jest.fn()

const moduleConfigService = {
  async getRecord(moduleId: string, name: string, scope?: { tenantId?: string | null }) {
    const key = storeKey(scope?.tenantId, name)
    if (!configStore.has(key)) return null
    return {
      moduleId,
      name,
      value: configStore.get(key) ?? null,
      tenantId: scope?.tenantId ?? null,
      organizationId: null,
      source: 'tenant' as const,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  },
  async setTenantValues(moduleId: string, values: Record<string, unknown>, tenantId: string) {
    setTenantValuesSpy(moduleId, values, tenantId)
    for (const [name, value] of Object.entries(values)) configStore.set(storeKey(tenantId, name), value)
  },
  async setValue(moduleId: string, name: string, value: unknown, scope?: { tenantId?: string | null }) {
    setValueSpy(moduleId, name, value, scope)
    configStore.set(storeKey(scope?.tenantId, name), value)
    return null
  },
}

const defaultConfigService = moduleConfigService
let activeConfigService: Pick<ModuleConfigService, 'getRecord' | 'setValue' | 'setTenantValues'> = defaultConfigService

let grantedFeatures: string[] = ['staff.timesheets.view', 'staff.timesheets.settings.manage']

const container = {
  hasRegistration: (name: string) => name === 'moduleConfigService' || name === 'rbacService',
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return activeConfigService
    if (name === 'rbacService') {
      return {
      getGrantedFeatures: async () => grantedFeatures,
      // Same grants, asked the way the code now asks — a test that grants a
      // feature must still grant it once the check goes through the service.
      userHasAllFeatures: async (_u: string, required: string[]) =>
        required.every((feature: string) =>
          (grantedFeatures ?? []).some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        ),
    }
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId: tenantA, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { GET, PUT, metadata } from '../route'
import { DEFAULT_TIME_TRACKING_SETTINGS, STAFF_TIME_TRACKING_MODULE_ID, TIME_TRACKING_SETTING_KEYS } from '../../../../lib/time-tracking/settings'

const getRequest = () => new Request('http://localhost/api/staff/timesheets/settings')

const putRequest = (body: unknown, query = '') =>
  new Request(`http://localhost/api/staff/timesheets/settings${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const fullSettings = {
  rounding: { unitMinutes: 15, direction: 'nearest' },
  defaults: { billable: false, chainStartFromPreviousEnd: false, entryMode: 'project' },
  targets: { dailyHours: 6 },
  warnings: { overlap: false, runningTimer: false },
  access: { assignmentGraceDays: 30 },
  support: { referencePrefix: 'SUP' },
}

describe('staff time tracking settings route', () => {
  beforeEach(() => {
    activeConfigService = defaultConfigService
    configStore.clear()
    setValueSpy.mockClear()
    setTenantValuesSpy.mockClear()
    container.resolve.mockClear()
    registerMutationGuards([])
    grantedFeatures = ['staff.timesheets.view', 'staff.timesheets.settings.manage']
    authValue = { tenantId: tenantA, sub: userId, orgId: organizationId }
  })

  afterAll(() => {
    registerMutationGuards([])
  })

  it('declares the feature guards required by the spec', () => {
    expect(metadata.GET.requireFeatures).toEqual(['staff.timesheets.view'])
    expect(metadata.PUT.requireFeatures).toEqual(['staff.timesheets.settings.manage'])
  })

  it('returns the spec defaults when no config rows exist', async () => {
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(DEFAULT_TIME_TRACKING_SETTINGS)
    expect(body).toEqual({
      rounding: { unitMinutes: 0, direction: 'up' },
      defaults: { billable: true, chainStartFromPreviousEnd: true, entryMode: 'task' },
      targets: { dailyHours: 8 },
      warnings: { overlap: true, runningTimer: true },
      access: { assignmentGraceDays: 14 },
      support: { referencePrefix: 'SUP' },
    })
  })

  it('fills absent keys with defaults when only part of the record was written', async () => {
    configStore.set(storeKey(tenantA, 'rounding.unitMinutes'), 10)

    const response = await GET(getRequest())
    await expect(response.json()).resolves.toEqual({
      ...DEFAULT_TIME_TRACKING_SETTINGS,
      rounding: { unitMinutes: 10, direction: 'up' },
    })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('round-trips a write through a subsequent read', async () => {
    const putResponse = await PUT(putRequest(fullSettings))
    expect(putResponse.status).toBe(200)
    await expect(putResponse.json()).resolves.toEqual(fullSettings)

    const getResponse = await GET(getRequest())
    await expect(getResponse.json()).resolves.toEqual(fullSettings)

    expect(setValueSpy).toHaveBeenCalledWith(
      STAFF_TIME_TRACKING_MODULE_ID,
      'rounding.unitMinutes',
      15,
      { tenantId: tenantA },
    )
    expect(setValueSpy).toHaveBeenCalledTimes(TIME_TRACKING_SETTING_KEYS.length)
  })

  it('updates only selected keys from a stale draft and returns the current settings', async () => {
    configStore.set(storeKey(tenantA, 'defaults.chainStartFromPreviousEnd'), false)
    configStore.set(storeKey(tenantA, 'support.referencePrefix'), 'HELP')
    configStore.set(storeKey(tenantB, 'targets.dailyHours'), 9)

    const response = await PUT(putRequest({
      ...fullSettings,
      defaults: { ...fullSettings.defaults, chainStartFromPreviousEnd: true },
      targets: { dailyHours: null },
    }, '?changedKeys=targets.dailyHours'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...DEFAULT_TIME_TRACKING_SETTINGS,
      defaults: { ...DEFAULT_TIME_TRACKING_SETTINGS.defaults, chainStartFromPreviousEnd: false },
      targets: { dailyHours: null },
      support: { referencePrefix: 'HELP' },
    })
    expect(setTenantValuesSpy).toHaveBeenCalledWith(STAFF_TIME_TRACKING_MODULE_ID, { 'targets.dailyHours': null }, tenantA)
    expect(setValueSpy).not.toHaveBeenCalled()
    expect(configStore.get(storeKey(tenantB, 'targets.dailyHours'))).toBe(9)
  })

  it('persists guard-modified keys from a masked save without replaying stale data or resetting sibling keys', async () => {
    configStore.set(storeKey(tenantA, 'defaults.chainStartFromPreviousEnd'), false)
    configStore.set(storeKey(tenantA, 'warnings.runningTimer'), false)
    const guard: MutationGuard = {
      id: 'test.settings-transform',
      targetEntity: 'staff.timesheets.settings',
      operations: ['update'],
      validate: async () => ({ ok: true, modifiedPayload: { warnings: { overlap: false } } }),
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await PUT(putRequest({ targets: { dailyHours: 7.5 } }, '?changedKeys=targets.dailyHours'))

    expect(response.status).toBe(200)
    expect(setTenantValuesSpy).toHaveBeenCalledWith(STAFF_TIME_TRACKING_MODULE_ID, {
      'targets.dailyHours': 7.5,
      'warnings.overlap': false,
    }, tenantA)
    await expect(response.json()).resolves.toMatchObject({
      defaults: { chainStartFromPreviousEnd: false },
      targets: { dailyHours: 7.5 },
      warnings: { overlap: false, runningTimer: false },
    })
  })

  it('applies only selected keys with a Configs service that implements the original contract', async () => {
    activeConfigService = { getRecord: defaultConfigService.getRecord, setValue: defaultConfigService.setValue }
    configStore.set(storeKey(tenantA, 'defaults.chainStartFromPreviousEnd'), false)

    const response = await PUT(putRequest({ targets: { dailyHours: 7.5 } }, '?changedKeys=targets.dailyHours'))

    expect(response.status).toBe(200)
    expect(setValueSpy).toHaveBeenCalledTimes(1)
    expect(setValueSpy).toHaveBeenCalledWith(STAFF_TIME_TRACKING_MODULE_ID, 'targets.dailyHours', 7.5, { tenantId: tenantA })
    await expect(response.json()).resolves.toMatchObject({
      defaults: { chainStartFromPreviousEnd: false },
      targets: { dailyHours: 7.5 },
    })
  })

  it.each(['', 'unknown.key', 'targets.dailyHours,warnings.overlap'])(
    'rejects invalid or omitted changed keys (%s) without writing',
    async (changedKeys) => {
      const response = await PUT(putRequest({ targets: { dailyHours: 7.5 } }, `?changedKeys=${changedKeys}`))
      expect(response.status).toBe(400)
      expect(setValueSpy).not.toHaveBeenCalled()
      expect(setTenantValuesSpy).not.toHaveBeenCalled()
    },
  )

  it('applies schema defaults to a partial payload', async () => {
    const response = await PUT(putRequest({ targets: { dailyHours: null } }))
    await expect(response.json()).resolves.toEqual({
      ...DEFAULT_TIME_TRACKING_SETTINGS,
      targets: { dailyHours: null },
    })
  })

  it('keeps the stored support reference prefix when an older client omits the support group', async () => {
    configStore.set(storeKey(tenantA, 'support.referencePrefix'), 'HELP')
    const { support: _omittedSupport, ...legacySettings } = fullSettings

    const response = await PUT(putRequest(legacySettings))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ...fullSettings, support: { referencePrefix: 'HELP' } })
    expect(setValueSpy).toHaveBeenCalledWith(
      STAFF_TIME_TRACKING_MODULE_ID,
      'support.referencePrefix',
      'HELP',
      { tenantId: tenantA },
    )
    expect(setValueSpy).toHaveBeenCalledTimes(TIME_TRACKING_SETTING_KEYS.length)
  })

  it('keeps the stored support reference prefix when the support group omits it', async () => {
    configStore.set(storeKey(tenantA, 'support.referencePrefix'), 'HELP')

    const response = await PUT(putRequest({ ...fullSettings, support: {} }))

    await expect(response.json()).resolves.toEqual({ ...fullSettings, support: { referencePrefix: 'HELP' } })
  })

  it('overwrites the stored support reference prefix when the payload carries one', async () => {
    configStore.set(storeKey(tenantA, 'support.referencePrefix'), 'HELP')

    const response = await PUT(putRequest({ ...fullSettings, support: { referencePrefix: 'TCK' } }))

    await expect(response.json()).resolves.toEqual({ ...fullSettings, support: { referencePrefix: 'TCK' } })
    expect(configStore.get(storeKey(tenantA, 'support.referencePrefix'))).toBe('TCK')
  })

  it('falls back to the default prefix when nothing is stored and the payload omits it', async () => {
    const { support: _omittedSupport, ...legacySettings } = fullSettings

    const response = await PUT(putRequest(legacySettings))

    await expect(response.json()).resolves.toEqual({ ...fullSettings, support: { referencePrefix: 'SUP' } })
  })

  it('rejects an invalid payload with 400', async () => {
    const response = await PUT(putRequest({ rounding: { unitMinutes: 7 } }))
    expect(response.status).toBe(400)
    expect(setValueSpy).not.toHaveBeenCalled()
  })

  it('keeps settings isolated per tenant', async () => {
    await PUT(putRequest(fullSettings))

    authValue = { tenantId: tenantB, sub: userId, orgId: organizationId }
    const otherTenant = await GET(getRequest())
    await expect(otherTenant.json()).resolves.toEqual(DEFAULT_TIME_TRACKING_SETTINGS)

    await PUT(putRequest({ rounding: { unitMinutes: 5, direction: 'up' } }))
    await expect((await GET(getRequest())).json()).resolves.toEqual({
      ...DEFAULT_TIME_TRACKING_SETTINGS,
      rounding: { unitMinutes: 5, direction: 'up' },
    })

    authValue = { tenantId: tenantA, sub: userId, orgId: organizationId }
    await expect((await GET(getRequest())).json()).resolves.toEqual(fullSettings)
  })

  it('rejects PUT when the caller lacks staff.timesheets.settings.manage', async () => {
    grantedFeatures = ['staff.timesheets.view']

    const response = await PUT(putRequest(fullSettings))

    expect(response.status).toBe(403)
    expect(setValueSpy).not.toHaveBeenCalled()
  })

  it('refuses a PUT pinned to a tenant other than the one the request resolves to', async () => {
    const response = await PUT(
      new Request(`http://localhost/api/staff/timesheets/settings?expectedTenantId=${tenantB}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fullSettings),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'tenant_scope_changed' })
    expect(setValueSpy).not.toHaveBeenCalled()
  })

  it('accepts a PUT pinned to the tenant the request resolves to', async () => {
    const response = await PUT(
      new Request(`http://localhost/api/staff/timesheets/settings?expectedTenantId=${tenantA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fullSettings),
      }),
    )

    expect(response.status).toBe(200)
    expect(setValueSpy).toHaveBeenCalled()
  })

  it('accepts PUT for a wildcard grant', async () => {
    grantedFeatures = ['staff.*']

    const response = await PUT(putRequest(fullSettings))

    expect(response.status).toBe(200)
  })

  it('blocks the write when a registered mutation guard rejects it', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked' } }))
    const guard: MutationGuard = {
      id: 'test.settings-guard',
      targetEntity: 'staff.timesheets.settings',
      operations: ['update'],
      validate,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await PUT(putRequest(fullSettings))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'Locked' })
    expect(setValueSpy).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantA,
        organizationId,
        userId,
        resourceKind: 'staff.timesheets.settings',
        operation: 'update',
        requestMethod: 'PUT',
      }),
    )
  })

  it('runs guard afterSuccess callbacks once the write committed', async () => {
    const afterSuccess = jest.fn(async () => {})
    const guard: MutationGuard = {
      id: 'test.settings-after-success',
      targetEntity: '*',
      operations: ['update'],
      features: ['staff.timesheets.settings.manage'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } }),
      afterSuccess,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await PUT(putRequest(fullSettings))

    expect(response.status).toBe(200)
    expect(setValueSpy).toHaveBeenCalledTimes(TIME_TRACKING_SETTING_KEYS.length)
    expect(afterSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'staff.timesheets.settings',
        operation: 'update',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('skips feature-gated guards the caller cannot trigger', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 422, body: { error: 'Blocked' } }))
    const guard: MutationGuard = {
      id: 'test.settings-gated-guard',
      targetEntity: '*',
      operations: ['update'],
      features: ['some_other_module.special'],
      validate,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await PUT(putRequest(fullSettings))

    expect(response.status).toBe(200)
    expect(validate).not.toHaveBeenCalled()
  })
})
