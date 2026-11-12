/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const salesOrderId = '44444444-4444-4444-8444-444444444444'

const commandBusExecuteMock = jest.fn()
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const runCustomRouteAfterInterceptorsMock = jest.fn()

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
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-route-interceptor', () => ({
  runCustomRouteAfterInterceptors: (...args: unknown[]) => runCustomRouteAfterInterceptorsMock(...args),
}))

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { DELETE } from '../route'

function deleteRequest(): Request {
  return new Request(`http://localhost/api/wms/sales-orders/${salesOrderId}/warehouse-assignment`, {
    method: 'DELETE',
  })
}

const routeContext = { params: { salesOrderId } }

describe('wms sales-order warehouse-assignment DELETE command interceptor rejections', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false, metadata: null })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: null, logEntry: null })
    runCustomRouteAfterInterceptorsMock.mockImplementation(async ({ response }: { response: { statusCode: number; body: unknown } }) => ({
      ok: true,
      statusCode: response.statusCode,
      body: response.body,
    }))
  })

  it('removes the assignment when nothing blocks the command', async () => {
    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'wms.sales-order.unassign-warehouse',
      expect.objectContaining({
        input: expect.objectContaining({ salesOrderId, tenantId, organizationId }),
      }),
    )
  })

  it('surfaces the status and body of an interceptor rejection that carries one', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(
      new CommandInterceptorError('Unassignment blocked by policy', {
        status: 422,
        body: { error: 'Unassignment blocked by policy', policy: 'reserved-stock' },
      }),
    )

    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Unassignment blocked by policy',
      policy: 'reserved-stock',
    })
  })

  it('keeps the generic 500 when an interceptor rejection carries no status', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))

    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
