/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const SETTINGS_ID = '44444444-4444-4444-8444-444444444444'
const UPDATED_AT = new Date('2026-10-08T08:00:00.000Z')
const PRECISE_MAX_AMOUNT = '12345678901234.123456789012345678'
const TINY_MAX_AMOUNT = '0.000000000000000001'

const getAuthMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const enforceWithGuardsMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthMock(...args),
}))

const containerStub = {
  resolve: (key: string) => {
    if (key === 'commandBus') return { execute: commandBusExecuteMock }
    return {}
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => containerStub,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => null,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: () => ORG_ID,
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/optimistic-lock-command'),
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => enforceWithGuardsMock(...(args as [])),
}))

jest.mock('../lib/settings', () => {
  const actual = jest.requireActual('../lib/settings')
  return { ...actual, loadWarrantyClaimSettings: jest.fn() }
})

import { WarrantyClaimSettings } from '../data/entities'
import { PUT } from '../api/settings-general/route'
import { saveWarrantyClaimSettingsCommand } from '../commands/settings'
import { loadWarrantyClaimSettings } from '../lib/settings'

const loadWarrantyClaimSettingsMock = loadWarrantyClaimSettings as jest.MockedFunction<typeof loadWarrantyClaimSettings>

function existingSettings(): WarrantyClaimSettings {
  return Object.assign(new WarrantyClaimSettings(), {
    id: SETTINGS_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    autoApproveEnabled: false,
    autoApproveMaxAmount: null,
    autoApproveCurrencyCode: null,
    updatedAt: UPDATED_AT,
  })
}

function commandCtx(): CommandRuntimeContext {
  const forkEm = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
  const rootEm = { fork: () => forkEm } as unknown as EntityManager
  return {
    container: { resolve: () => rootEm },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
}

function putRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/warranty_claims/settings-general', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dispatchedInput(): Record<string, unknown> {
  const call = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'warranty_claims.settings.save')
  if (!call) throw new Error('[internal] warranty_claims.settings.save was not dispatched')
  return (call[1] as { input: Record<string, unknown> }).input
}

beforeEach(() => {
  getAuthMock.mockReset()
  getAuthMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  runRouteMutationGuardsMock.mockReset()
  runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: async () => undefined })
  commandBusExecuteMock.mockReset()
  commandBusExecuteMock.mockImplementation(async (_commandId: string, { input }: { input: Record<string, unknown> }) => ({
    result: {
      autoApproveMaxAmount: input.autoApproveMaxAmount,
      autoApproveMaxAmountExact: input.autoApproveMaxAmountExact,
    },
  }))
  enforceWithGuardsMock.mockClear()
  loadWarrantyClaimSettingsMock.mockReset()
  loadWarrantyClaimSettingsMock.mockResolvedValue(existingSettings())
})

describe('PUT /api/warranty_claims/settings-general exact autoApproveMaxAmount', () => {
  it('hands the command the exact request digits next to the coerced number', async () => {
    const response = await PUT(putRequest({ autoApproveMaxAmount: PRECISE_MAX_AMOUNT }))

    expect(response.status).toBe(200)
    expect(dispatchedInput()).toMatchObject({
      autoApproveMaxAmount: Number(PRECISE_MAX_AMOUNT),
      autoApproveMaxAmountExact: PRECISE_MAX_AMOUNT,
    })
    const body = await response.json() as { result: Record<string, unknown> }
    expect(body.result.autoApproveMaxAmountExact).toBe(PRECISE_MAX_AMOUNT)
  })

  it('uses a mutation-guard override of the amount instead of the request digits', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: { autoApproveMaxAmount: 5 },
      runAfterSuccess: async () => undefined,
    })

    const response = await PUT(putRequest({ autoApproveMaxAmount: PRECISE_MAX_AMOUNT }))

    expect(response.status).toBe(200)
    expect(dispatchedInput()).toMatchObject({ autoApproveMaxAmount: 5, autoApproveMaxAmountExact: '5' })
  })
})

describe('warranty_claims.settings.save exact autoApproveMaxAmount', () => {
  it('accepts route-attached exact keys and stores the exact digits', async () => {
    const settings = existingSettings()
    loadWarrantyClaimSettingsMock.mockResolvedValue(settings)

    const result = await saveWarrantyClaimSettingsCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      autoApproveMaxAmount: Number(PRECISE_MAX_AMOUNT),
      autoApproveMaxAmountExact: PRECISE_MAX_AMOUNT,
    } as Parameters<typeof saveWarrantyClaimSettingsCommand.execute>[0], commandCtx())

    expect(settings.autoApproveMaxAmount).toBe(PRECISE_MAX_AMOUNT)
    expect(result.autoApproveMaxAmountExact).toBe(PRECISE_MAX_AMOUNT)
    expect(result.autoApproveMaxAmount).toBe(Number(PRECISE_MAX_AMOUNT))
  })

  it('stores exact digits from a raw string input dispatched without the route', async () => {
    const settings = existingSettings()
    loadWarrantyClaimSettingsMock.mockResolvedValue(settings)

    const result = await saveWarrantyClaimSettingsCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      autoApproveMaxAmount: TINY_MAX_AMOUNT,
    } as unknown as Parameters<typeof saveWarrantyClaimSettingsCommand.execute>[0], commandCtx())

    expect(settings.autoApproveMaxAmount).toBe(TINY_MAX_AMOUNT)
    expect(result.autoApproveMaxAmountExact).toBe(TINY_MAX_AMOUNT)
  })

  it('still rejects unknown keys after stripping the exact keys', async () => {
    await expect(saveWarrantyClaimSettingsCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      autoApproveMaxAmountExact: PRECISE_MAX_AMOUNT,
      unexpectedField: true,
    } as unknown as Parameters<typeof saveWarrantyClaimSettingsCommand.execute>[0], commandCtx())).rejects.toMatchObject({
      status: 400,
    })
  })
})
