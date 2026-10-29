/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const selectedOrganizationId = '22222222-2222-4222-8222-222222222222'
const allowedOrganizationId = '33333333-3333-4333-8333-333333333333'
const disallowedOrganizationId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

const commandBusExecuteMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const runCustomRouteAfterInterceptorsMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    if (name === 'em') return { fork: jest.fn() }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-route-interceptor', () => ({
  runCustomRouteAfterInterceptors: (...args: unknown[]) => runCustomRouteAfterInterceptorsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import { z } from 'zod'
import { executeWmsCustomPostRoute } from '../helpers'

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
})

const warehouseId = '66666666-6666-4666-8666-666666666666'

function postRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/wms/inventory/receive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function runRoute(body: Record<string, unknown>) {
  return executeWmsCustomPostRoute({
    request: postRequest(body),
    routePath: 'wms/inventory/receive',
    inputSchema,
    commandId: 'wms.inventory.receive',
    describeResource: (input) => ({
      resourceKind: 'wms.inventory',
      resourceId: input.warehouseId,
    }),
    mapSuccess: () => ({ ok: true }),
  })
}

describe('executeWmsCustomPostRoute organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: selectedOrganizationId,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: selectedOrganizationId,
      filterIds: [selectedOrganizationId, allowedOrganizationId],
      allowedIds: [selectedOrganizationId, allowedOrganizationId],
    })
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      runAfterSuccess: jest.fn(async () => undefined),
    })
    commandBusExecuteMock.mockResolvedValue({ result: { movementId: warehouseId }, logEntry: null })
    runCustomRouteAfterInterceptorsMock.mockImplementation(
      async ({ response }: { response: { statusCode: number; body: unknown } }) => ({
        ok: true,
        statusCode: response.statusCode,
        body: response.body,
      }),
    )
  })

  it('defaults organizationId to the session selected org when the body omits it', async () => {
    const response = await runRoute({ warehouseId, tenantId })

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'wms.inventory.receive',
      expect.objectContaining({
        input: expect.objectContaining({
          organizationId: selectedOrganizationId,
          tenantId,
          warehouseId,
        }),
      }),
    )
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ organizationId: selectedOrganizationId }),
      }),
    )
  })

  it('passes through a body organizationId that is in the caller allowed org scope', async () => {
    const response = await runRoute({
      warehouseId,
      tenantId,
      organizationId: allowedOrganizationId,
    })

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'wms.inventory.receive',
      expect.objectContaining({
        input: expect.objectContaining({
          organizationId: allowedOrganizationId,
          tenantId,
        }),
      }),
    )
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ organizationId: allowedOrganizationId }),
      }),
    )
  })

  it('rejects a body organizationId outside the caller allowed org scope', async () => {
    const response = await runRoute({
      warehouseId,
      tenantId,
      organizationId: disallowedOrganizationId,
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('still overwrites body tenantId with the authenticated tenant', async () => {
    const foreignTenantId = '77777777-7777-4777-8777-777777777777'
    const response = await runRoute({
      warehouseId,
      tenantId: foreignTenantId,
      organizationId: selectedOrganizationId,
    })

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'wms.inventory.receive',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId,
          organizationId: selectedOrganizationId,
        }),
      }),
    )
  })
})
