const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getValueMock = jest.fn()
const setValueMock = jest.fn()

let canViewSettings = false

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getValue: (...args: unknown[]) => getValueMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
    }
    if (name === 'rbacService') {
      return { userHasAllFeatures: async () => canViewSettings }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { GET, PUT } from '../route'

const makePutRequest = (unitPriceDisplayEnabled: boolean) =>
  new Request('http://localhost/api/catalog/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unitPriceDisplayEnabled }),
  })

const priceKindId = '44444444-4444-4444-8444-444444444444'

const makeOmnibusPutRequest = (omnibus: Record<string, unknown>) =>
  new Request('http://localhost/api/catalog/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ omnibus }),
  })

// The route reads both config keys through the same service; tests that care about the
// omnibus block need the stored value to depend on which key is being read.
const stubStoredConfig = (stored: { unitPriceDisplayEnabled?: boolean; omnibus?: Record<string, unknown> }) => {
  getValueMock.mockImplementation(async (_moduleId: unknown, key: unknown) =>
    key === 'omnibus' ? stored.omnibus : stored.unitPriceDisplayEnabled,
  )
}

describe('catalog settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    canViewSettings = false
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    getValueMock.mockResolvedValue(undefined)
    setValueMock.mockResolvedValue(undefined)
  })

  it('defaults unitPriceDisplayEnabled to true when no config row exists', async () => {
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: true })
    expect(getValueMock).toHaveBeenCalledWith(
      'catalog',
      'unit_price_display_enabled',
      expect.objectContaining({ defaultValue: true, scope: { tenantId } }),
    )
  })

  it('returns the stored tenant value when set to false', async () => {
    getValueMock.mockResolvedValue(false)
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: false })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    expect(response.status).toBe(401)
  })

  it('persists the tenant-scoped value and runs the mutation guard', async () => {
    const response = await PUT(makePutRequest(false))

    expect(response.status).toBe(200)
    // The response gained an additive `omnibus` key (EU Omnibus config shares this route);
    // `{}` is the unset config. A PUT that omits `omnibus` must leave it untouched.
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: false, omnibus: {} })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'catalog.settings',
        resourceId: 'unit_price_display_enabled',
        operation: 'custom',
        requestMethod: 'PUT',
      }),
    )
    expect(setValueMock).toHaveBeenCalledWith('catalog', 'unit_price_display_enabled', false, { tenantId })
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'catalog.settings', metadata: { token: 'guard' } }),
    )
  })

  it('aborts the write before persisting when the guard blocks it', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    const response = await PUT(makePutRequest(true))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Conflict' })
    expect(setValueMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})

// The omnibus block rides on this route rather than owning one, so the read gate, the two
// enable gates and the key isolation are all route-level behavior with no CRUD factory behind
// them. Compliance case C13 lives here.
describe('catalog settings route — omnibus block', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    canViewSettings = false
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({
      ok: true,
      shouldRunAfterSuccess: true,
      metadata: { token: 'guard' },
    })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    getValueMock.mockResolvedValue(undefined)
    setValueMock.mockResolvedValue(undefined)
  })

  describe('GET gating', () => {
    it('omits the omnibus key entirely for a caller without catalog.settings.view', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: { enabled: true } })

      const response = await GET(new Request('http://localhost/api/catalog/settings'))
      const body = await response.json()

      // Omission, not 403 — the sibling unit-price consumer must keep working.
      expect(response.status).toBe(200)
      expect(Object.prototype.hasOwnProperty.call(body, 'omnibus')).toBe(false)
      expect(getValueMock).not.toHaveBeenCalledWith('catalog', 'omnibus', expect.anything())
    })

    it('returns the stored config for a caller holding catalog.settings.view', async () => {
      canViewSettings = true
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: { enabled: true, lookbackDays: 30 } })

      const response = await GET(new Request('http://localhost/api/catalog/settings'))

      await expect(response.json()).resolves.toEqual({
        unitPriceDisplayEnabled: true,
        omnibus: { enabled: true, lookbackDays: 30 },
      })
    })

    it('defers the wildcard and super-admin ordering to the realm service', async () => {
      canViewSettings = true
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: { enabled: true } })

      const response = await GET(new Request('http://localhost/api/catalog/settings'))
      const body = await response.json()

      expect(body.omnibus).toEqual({ enabled: true })
    })

    it('resolves to an empty object when omnibus has never been configured', async () => {
      canViewSettings = true
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: undefined })

      const response = await GET(new Request('http://localhost/api/catalog/settings'))

      await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: true, omnibus: {} })
    })
  })

  describe('enable gates', () => {
    it('rejects enabling with 422 when an in-scope EU channel has no backfill coverage (C13)', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: true,
          enabledCountryCodes: ['PL'],
          defaultPresentedPriceKindId: priceKindId,
          channels: { 'ch-pl': { countryCode: 'PL' } },
        }),
      )

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        field: 'omnibus.enabled',
        error: 'backfill_required_before_enable',
        channels: ['ch-pl'],
      })
      // Nothing is persisted — neither key — and the guard never runs.
      expect(setValueMock).not.toHaveBeenCalled()
      expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
    })

    it('rejects enabling with 400 when an in-scope EU channel has no presented price kind', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: true,
          enabledCountryCodes: ['PL'],
          channels: { 'ch-pl': { countryCode: 'PL' } },
          backfillCoverage: { 'ch-pl': { completedAt: '2026-07-01T00:00:00.000Z', lookbackDays: 30 } },
        }),
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Invalid request',
        details: {
          field: 'omnibus.defaultPresentedPriceKindId',
          error: 'presented_price_kind_required',
          channels: ['ch-pl'],
        },
      })
      expect(setValueMock).not.toHaveBeenCalled()
    })

    it('accepts enabling when a per-channel presented price kind and coverage are present', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: true,
          enabledCountryCodes: ['PL'],
          channels: { 'ch-pl': { countryCode: 'PL', presentedPriceKindId: priceKindId } },
          backfillCoverage: { 'ch-pl': { completedAt: '2026-07-01T00:00:00.000Z', lookbackDays: 30 } },
        }),
      )

      expect(response.status).toBe(200)
      expect(setValueMock).toHaveBeenCalledWith('catalog', 'omnibus', expect.objectContaining({ enabled: true }), {
        tenantId,
      })
    })

    it('accepts enabling when an unscoped backfill covers every channel', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: true,
          enabledCountryCodes: ['PL'],
          defaultPresentedPriceKindId: priceKindId,
          channels: { 'ch-pl': { countryCode: 'PL' } },
          backfillCoverage: { '': { completedAt: '2026-07-01T00:00:00.000Z', lookbackDays: 30 } },
        }),
      )

      expect(response.status).toBe(200)
    })

    it('does not gate a channel whose country is outside enabledCountryCodes', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: true,
          enabledCountryCodes: ['PL'],
          defaultPresentedPriceKindId: priceKindId,
          channels: {
            'ch-pl': { countryCode: 'PL' },
            'ch-us': { countryCode: 'US' },
          },
          backfillCoverage: { 'ch-pl': { completedAt: '2026-07-01T00:00:00.000Z', lookbackDays: 30 } },
        }),
      )

      // Only ch-pl is in scope; the US channel neither needs coverage nor blocks the save.
      expect(response.status).toBe(200)
    })

    it('applies no gate when the incoming config leaves omnibus disabled', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(
        makeOmnibusPutRequest({
          enabled: false,
          enabledCountryCodes: ['PL'],
          channels: { 'ch-pl': { countryCode: 'PL' } },
        }),
      )

      expect(response.status).toBe(200)
    })
  })

  describe('persistence', () => {
    it('writes the omnibus key without touching unit_price_display_enabled', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: false, omnibus: {} })

      const response = await PUT(makeOmnibusPutRequest({ lookbackDays: 45 }))

      expect(response.status).toBe(200)
      const written = setValueMock.mock.calls.map((call) => call[1])
      expect(written).toEqual(['omnibus'])
      // The untouched sibling setting is still reported back from storage.
      await expect(response.json()).resolves.toEqual({
        unitPriceDisplayEnabled: false,
        omnibus: { lookbackDays: 45, backfillCoverage: {} },
      })
    })

    it('scopes the mutation guard to the omnibus config key', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      await PUT(makeOmnibusPutRequest({ lookbackDays: 45 }))

      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'catalog.settings', resourceId: 'omnibus', operation: 'custom' }),
      )
      expect(validateCrudMutationGuardMock).toHaveBeenCalledTimes(1)
    })

    it('preserves recorded backfill coverage when the form omits it', async () => {
      const coverage = { 'ch-pl': { completedAt: '2026-07-01T00:00:00.000Z', lookbackDays: 30 } }
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: { lookbackDays: 30, backfillCoverage: coverage } })

      // The settings form never sends backfillCoverage; erasing it would make the 422 gate
      // permanently unsatisfiable.
      const response = await PUT(makeOmnibusPutRequest({ lookbackDays: 60 }))

      expect(response.status).toBe(200)
      expect(setValueMock).toHaveBeenCalledWith(
        'catalog',
        'omnibus',
        expect.objectContaining({ lookbackDays: 60, backfillCoverage: coverage }),
        { tenantId },
      )
    })

    it('rejects an empty body', async () => {
      const response = await PUT(
        new Request('http://localhost/api/catalog/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )

      expect(response.status).toBe(400)
      expect(setValueMock).not.toHaveBeenCalled()
    })

    it('rejects "EU" as a country code', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(makeOmnibusPutRequest({ enabledCountryCodes: ['EU'] }))

      expect(response.status).toBe(400)
      expect(setValueMock).not.toHaveBeenCalled()
    })

    it('rejects a lookback outside the supported range', async () => {
      stubStoredConfig({ unitPriceDisplayEnabled: true, omnibus: {} })

      const response = await PUT(makeOmnibusPutRequest({ lookbackDays: 400 }))

      expect(response.status).toBe(400)
      expect(setValueMock).not.toHaveBeenCalled()
    })
  })
})
