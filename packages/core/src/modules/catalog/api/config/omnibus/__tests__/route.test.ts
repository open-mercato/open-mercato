import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const priceKindId = '55555555-5555-4555-8555-555555555555'
const otherPriceKindId = '66666666-6666-4666-8666-666666666666'
const channelPl = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const channelDe = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let authValue: Record<string, unknown> | null = null
let storedValue: unknown = null
let guards: MutationGuard[] = []
const getValueMock = jest.fn(async () => storedValue)
const setValueMock = jest.fn(async (_moduleId: string, _name: string, value: unknown) => {
  storedValue = value
  return null
})
const deleteByTagsMock = jest.fn(async () => 0)
const cache = { deleteByTags: deleteByTagsMock }
let grantedFeatures: string[] = ['catalog.settings.manage']
const userHasAllFeaturesMock = jest.fn(async (_userId: string, required: string[]) =>
  required.every((feature) => grantedFeatures.includes(feature)),
)

const container = {
  hasRegistration: (name: string) => name === 'moduleConfigService' || name === 'cache',
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return { getValue: getValueMock, setValue: setValueMock }
    if (name === 'cache') return cache
    if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))

import { GET, PATCH, metadata, openApi } from '../route'

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/catalog/config/omnibus', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function getRequest(): Request {
  return new Request('http://localhost/api/catalog/config/omnibus')
}

const coverage = { completedAt: '2026-06-01T00:00:00.000Z', lookbackDays: 30 }

function plChannel(overrides: Record<string, unknown> = {}) {
  return { [channelPl]: { presentedPriceKindId: priceKindId, countryCode: 'PL', ...overrides } }
}

describe('catalog omnibus config route', () => {
  beforeEach(() => {
    authValue = { sub: userId, tenantId, orgId: organizationId, features: ['catalog.settings.manage'] }
    storedValue = null
    guards = []
    grantedFeatures = ['catalog.settings.manage']
    jest.clearAllMocks()
  })

  it('declares view/manage features and exports openApi', () => {
    expect(metadata.GET).toEqual({ requireAuth: true })
    expect(metadata.PATCH.requireFeatures).toEqual(['catalog.settings.manage'])
    expect(openApi.methods?.GET).toBeDefined()
    expect(openApi.methods?.PATCH).toBeDefined()
  })

  it('lets GET through with either the view or the manage feature and rejects neither', async () => {
    grantedFeatures = ['catalog.settings.view']
    expect((await GET(getRequest())).status).toBe(200)
    grantedFeatures = ['catalog.settings.manage']
    expect((await GET(getRequest())).status).toBe(200)
    grantedFeatures = []
    expect((await GET(getRequest())).status).toBe(403)
    expect(getValueMock).toHaveBeenCalledTimes(2)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(userId, ['catalog.settings.view'], { tenantId, organizationId })
  })

  it('returns 401 without a tenant-bound auth context', async () => {
    authValue = null
    expect((await GET(getRequest())).status).toBe(401)
    expect((await PATCH(patchRequest({ lookbackDays: 30 }))).status).toBe(401)
  })

  it('returns {} when the config is unset', async () => {
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(getValueMock).toHaveBeenCalledWith('catalog', 'omnibus', { scope: { tenantId } })
  })

  it('returns the stored config with defaults applied', async () => {
    storedValue = { enabled: false, lookbackDays: 45 }
    const response = await GET(getRequest())
    expect(await response.json()).toEqual({
      enabled: false,
      enabledCountryCodes: [],
      noChannelMode: 'best_effort',
      lookbackDays: 45,
      minimizationAxis: 'gross',
      backfillCoverage: {},
      channels: {},
    })
  })

  it('reads and writes with the tenant from auth, never from input', async () => {
    const response = await PATCH(patchRequest({ lookbackDays: 60, tenantId: otherTenantId }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()

    const ok = await PATCH(patchRequest({ lookbackDays: 60 }))
    expect(ok.status).toBe(200)
    expect(getValueMock).toHaveBeenCalledWith('catalog', 'omnibus', { scope: { tenantId } })
    expect(setValueMock).toHaveBeenCalledWith('catalog', 'omnibus', expect.objectContaining({ lookbackDays: 60 }), { tenantId })
  })

  it('merges the patch into the stored config and returns the merged result', async () => {
    storedValue = {
      enabled: false,
      enabledCountryCodes: ['PL'],
      lookbackDays: 30,
      defaultPresentedPriceKindId: priceKindId,
      backfillCoverage: { [channelPl]: coverage },
      channels: plChannel(),
    }
    const response = await PATCH(patchRequest({ minimizationAxis: 'net', defaultPresentedPriceKindId: null }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      enabledCountryCodes: ['PL'],
      minimizationAxis: 'net',
      backfillCoverage: { [channelPl]: coverage },
      channels: plChannel(),
    })
    expect(body.defaultPresentedPriceKindId).toBeUndefined()
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await PATCH(patchRequest('{not json'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' })
  })

  it.each([
    ['EU pseudo-country', { enabledCountryCodes: ['EU'] }, 'enabledCountryCodes.0'],
    ['lowercase country', { enabledCountryCodes: ['pl'] }, 'enabledCountryCodes.0'],
    ['three-letter country', { enabledCountryCodes: ['POL'] }, 'enabledCountryCodes.0'],
    ['unknown alpha-2 country', { enabledCountryCodes: ['QQ'] }, 'enabledCountryCodes.0'],
    ['channel country EU', { channels: plChannel({ countryCode: 'EU' }) }, `channels.${channelPl}.countryCode`],
    ['lookback below range', { lookbackDays: 0 }, 'lookbackDays'],
    ['lookback above range', { lookbackDays: 366 }, 'lookbackDays'],
    ['non-integer lookback', { lookbackDays: 30.5 }, 'lookbackDays'],
    ['channel lookback above range', { channels: plChannel({ lookbackDays: 400 }) }, `channels.${channelPl}.lookbackDays`],
    ['non-uuid default kind', { defaultPresentedPriceKindId: 'regular' }, 'defaultPresentedPriceKindId'],
    ['non-uuid channel kind', { channels: { [channelPl]: { presentedPriceKindId: 'regular' } } }, `channels.${channelPl}.presentedPriceKindId`],
    ['unknown axis', { minimizationAxis: 'lowest' }, 'minimizationAxis'],
    ['unknown no-channel mode', { noChannelMode: 'strict' }, 'noChannelMode'],
    ['backfill coverage from input', { backfillCoverage: { [channelPl]: coverage } }, 'backfillCoverage'],
    ['unknown top-level field', { organizationId }, 'organizationId'],
  ])('rejects %s with a 400 field error', async (_label, body, path) => {
    const response = await PATCH(patchRequest(body))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe('Invalid config')
    expect(payload.details.fieldErrors[path]).toBeDefined()
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('accepts valid alpha-2 country codes and lookback bounds', async () => {
    for (const lookbackDays of [1, 365]) {
      const response = await PATCH(patchRequest({ enabledCountryCodes: ['PL', 'DE'], lookbackDays }))
      expect(response.status).toBe(200)
    }
  })

  it.each([
    'progressiveReductionRule',
    'progressiveMaxGapDays',
    'perishableGoodsRule',
    'newArrivalRule',
    'newArrivalsLookbackDays',
  ])('rejects the unsupported derogation field %s instead of dropping it', async (field) => {
    const response = await PATCH(patchRequest({ channels: plChannel({ [field]: 'standard' }) }))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.details.fieldErrors[`channels.${channelPl}.${field}`]).toEqual(['omnibus_derogation_not_supported'])
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('rejects enabled:true without any resolvable presented price kind', async () => {
    const response = await PATCH(patchRequest({ enabled: true, enabledCountryCodes: ['PL'] }))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.details.fieldErrors.defaultPresentedPriceKindId).toEqual(['omnibus_presented_price_kind_required'])
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('returns 422 when enabling with an in-scope EU channel lacking backfill coverage', async () => {
    const response = await PATCH(
      patchRequest({
        enabled: true,
        enabledCountryCodes: ['PL', 'DE'],
        lookbackDays: 30,
        channels: {
          ...plChannel(),
          [channelDe]: { presentedPriceKindId: otherPriceKindId, countryCode: 'DE' },
        },
      }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      field: 'enabled',
      error: 'backfill_required_before_enable',
      channels: [channelPl, channelDe].sort(),
    })
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('enables once every in-scope channel is backfilled, ignoring non-EU channels', async () => {
    storedValue = { backfillCoverage: { [channelPl]: coverage } }
    const response = await PATCH(
      patchRequest({
        enabled: true,
        enabledCountryCodes: ['PL'],
        channels: {
          ...plChannel(),
          [channelDe]: { presentedPriceKindId: otherPriceKindId },
        },
      }),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).enabled).toBe(true)
    expect(setValueMock).toHaveBeenCalledTimes(1)
  })

  it('enables with a default presented kind and no in-scope channels', async () => {
    const response = await PATCH(patchRequest({ enabled: true, defaultPresentedPriceKindId: priceKindId }))
    expect(response.status).toBe(200)
  })

  it('returns the guard error and skips persistence when a mutation guard blocks', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked' } }))
    guards = [{ id: 'test.lock', targetEntity: 'catalog.settings', operations: ['update'], validate }]
    const response = await PATCH(patchRequest({ lookbackDays: 45 }))
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Locked' })
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'catalog.settings',
        resourceId: 'omnibus',
        operation: 'update',
        mutationPayload: { lookbackDays: 45 },
      }),
    )
    expect(setValueMock).not.toHaveBeenCalled()
    expect(deleteByTagsMock).not.toHaveBeenCalled()
  })

  it('merges the guard modified payload, re-validates it and runs afterSuccess callbacks', async () => {
    const afterSuccess = jest.fn(async () => {
      throw new Error('callback failure')
    })
    guards = [
      {
        id: 'test.modify',
        targetEntity: 'catalog.*',
        operations: ['update'],
        validate: async () => ({ ok: true, modifiedPayload: { lookbackDays: 90 }, shouldRunAfterSuccess: true, metadata: { marker: 1 } }),
        afterSuccess,
      },
    ]
    const response = await PATCH(patchRequest({ lookbackDays: 45 }))
    expect(response.status).toBe(200)
    expect((await response.json()).lookbackDays).toBe(90)
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'omnibus', metadata: { marker: 1 } }))
  })

  it('re-validates an invalid guard modified payload', async () => {
    guards = [
      {
        id: 'test.invalid',
        targetEntity: 'catalog.settings',
        operations: ['update'],
        validate: async () => ({ ok: true, modifiedPayload: { lookbackDays: 999 } }),
      },
    ]
    const response = await PATCH(patchRequest({ lookbackDays: 45 }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('invalidates the tenant omnibus resolution cache after a successful PATCH', async () => {
    const response = await PATCH(patchRequest({ lookbackDays: 45 }))
    expect(response.status).toBe(200)
    expect(deleteByTagsMock).toHaveBeenCalledWith([`catalog:omnibus:${tenantId}`])
  })
})
