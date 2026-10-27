/** @jest-environment node */

import type { CrudCommandActionConfig, CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { currencyCreateSchema, exchangeRateCreateSchema } from '../../../data/validators'
import '../route'
import '../../exchange-rates/route'

type CapturedRoute = {
  actions: { create: CrudCommandActionConfig }
}

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const homeOrganizationId = '22222222-2222-4222-8222-222222222222'
const selectedOrganizationId = '33333333-3333-4333-8333-333333333333'
const explicitOrganizationId = '44444444-4444-4444-8444-444444444444'
const explicitTenantId = '55555555-5555-4555-8555-555555555555'

function createContext(scope: { tenantId?: string | null; organizationId?: string | null; selectedOrganizationId?: string | null } = {}): CrudCtx {
  return {
    container: {} as CrudCtx['container'],
    auth: {
      sub: 'user-1',
      tenantId: scope.tenantId === undefined ? tenantId : scope.tenantId,
      orgId: scope.organizationId === undefined ? homeOrganizationId : scope.organizationId,
      roles: [],
    } as CrudCtx['auth'],
    selectedOrganizationId: scope.selectedOrganizationId === undefined ? selectedOrganizationId : scope.selectedOrganizationId,
    organizationScope: null,
    organizationIds: [selectedOrganizationId],
  }
}

const routes = [
  {
    name: 'currency', commandId: 'currencies.currencies.create', schema: currencyCreateSchema,
    fields: { code: 'EUR', name: 'Euro', decimalPlaces: 4, isBase: false, isActive: true },
  },
  {
    name: 'exchange rate', commandId: 'currencies.exchange_rates.create', schema: exchangeRateCreateSchema,
    fields: {
      fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.12500000',
      date: '2026-10-13T09:30:00.000Z', source: 'Manual', type: 'buy', isActive: true,
    },
  },
]

describe.each(routes)('$name create route scope', ({ commandId, fields, schema }) => {
  async function mapCreateInput(payload: Record<string, unknown>, ctx = createContext()): Promise<Record<string, unknown>> {
    const route = jest.mocked(makeCrudRoute).mock.calls
      .map(([config]) => config as CapturedRoute)
      .find((config) => config.actions.create.commandId === commandId)
    expect(route).toBeDefined()
    const mapInput = route?.actions.create.mapInput
    expect(mapInput).toBeDefined()
    return await mapInput?.({ parsed: payload, raw: payload, ctx }) as Record<string, unknown>
  }

  it('resolves omitted IDs from the authenticated selected organization before command validation', async () => {
    const input = await mapCreateInput(fields)
    expect(input).toEqual({ ...fields, tenantId, organizationId: selectedOrganizationId })
    expect(schema.safeParse(input).success).toBe(true)
  })

  it('uses the authenticated home organization when no organization is selected', async () => {
    const input = await mapCreateInput(fields, createContext({ selectedOrganizationId: null }))
    expect(input).toEqual({ ...fields, tenantId, organizationId: homeOrganizationId })
  })

  it.each([
    { tenantId },
    { organizationId: explicitOrganizationId },
    { organizationId: explicitOrganizationId, tenantId: explicitTenantId },
  ])('preserves explicit IDs for the existing authorization guards: %j', async (explicitScope) => {
    const input = await mapCreateInput({ ...fields, ...explicitScope })
    expect(input).toEqual({ ...fields, tenantId, organizationId: selectedOrganizationId, ...explicitScope })
    expect(schema.safeParse(input).success).toBe(true)
  })

  it('returns a translated error when there is no authenticated tenant', async () => {
    await expect(mapCreateInput(fields, createContext({ tenantId: null }))).rejects.toMatchObject({
      status: 400, body: { error: 'translated:errors.tenant_required' },
    })
  })

  it('returns a translated error when there is no organization to target', async () => {
    const result = mapCreateInput(fields, createContext({ organizationId: null, selectedOrganizationId: null }))
    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({
      status: 400, body: { error: 'translated:errors.organization_required' },
    })
  })
})
