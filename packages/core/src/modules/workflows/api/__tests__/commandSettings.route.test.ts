/**
 * Tenant UPDATE_ENTITY command enablement route.
 *
 * Four properties are asserted through the real handlers:
 *
 * 1. A tenant that has never saved reads `configured: false` and the
 *    grandfathered answers — today's reachable set, unchanged.
 * 2. `tenantId` comes from the authenticated context, never from the body, and
 *    the read/write are scoped to it.
 * 3. A command id outside the code-declared catalogue is REFUSED, not stored.
 *    This is the whole safety model: an admin who could type an arbitrary id
 *    would reach commands with no declared permission to check.
 * 4. A save never silently unticks a stored command whose declaring module is
 *    absent from this process.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { GET as getCommandSettings, PUT as putCommandSettings } from '../command-settings/route'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '../../lib/workflow-safe-commands'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const OTHER_TENANT_ID = '11111111-2222-4333-8444-eeeeeeeeeeee'

let stored: Record<string, unknown>
let moduleConfigService: { getValue: jest.Mock; setValue: jest.Mock }

function useContainer(): void {
  createRequestContainer.mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'moduleConfigService') return moduleConfigService
      throw new Error(`[internal] unexpected DI token ${token}`)
    },
  })
}

function getRequest(): Request {
  return new Request('http://localhost/api/workflows/command-settings')
}

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/workflows/command-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function registerCatalogue(): void {
  registerWorkflowSafeCommands([
    {
      commandId: 'sales.orders.update',
      requiredFeatures: ['sales.orders.manage'],
      labelKey: 'sales.workflows.commands.orders.update',
      defaultEnabled: true,
    },
    {
      commandId: 'customers.deals.update',
      requiredFeatures: ['customers.deals.manage'],
      labelKey: 'customers.workflows.commands.deals.update',
    },
  ])
}

beforeEach(() => {
  clearWorkflowSafeCommandsForTests()
  stored = {}
  moduleConfigService = {
    getValue: jest.fn(async (_moduleId: string, _name: string, options?: any) => {
      const tenantId = options?.scope?.tenantId ?? null
      return stored[String(tenantId)]
    }),
    setValue: jest.fn(async (_moduleId: string, _name: string, value: unknown, scope?: any) => {
      stored[String(scope?.tenantId ?? null)] = value
      return null
    }),
  }
  useContainer()
  getAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID, sub: 'user-1' })
})

afterEach(() => {
  clearWorkflowSafeCommandsForTests()
  jest.clearAllMocks()
})

describe('GET /api/workflows/command-settings', () => {
  test('a tenant that never saved reads the grandfathered set and configured:false', async () => {
    registerCatalogue()

    const body = await (await getCommandSettings(getRequest())).json()

    expect(body.configured).toBe(false)
    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'sales.orders.update', enabled: true, defaultEnabled: true }),
      expect.objectContaining({ commandId: 'customers.deals.update', enabled: false, defaultEnabled: false }),
    ])
  })

  test('reads the tenant from the authenticated context', async () => {
    registerCatalogue()

    await getCommandSettings(getRequest())

    expect(moduleConfigService.getValue).toHaveBeenCalledWith(
      'workflows',
      'update_entity_enabled_commands',
      expect.objectContaining({ scope: { tenantId: TENANT_ID } }),
    )
  })

  test('returns 401 without a tenant', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    expect((await getCommandSettings(getRequest())).status).toBe(401)
  })
})

describe('PUT /api/workflows/command-settings', () => {
  test('ticking a candidate persists it against the authenticated tenant only', async () => {
    registerCatalogue()

    const response = await putCommandSettings(putRequest({ enabledCommandIds: ['customers.deals.update'] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(moduleConfigService.setValue).toHaveBeenCalledWith(
      'workflows',
      'update_entity_enabled_commands',
      ['customers.deals.update'],
      { tenantId: TENANT_ID },
    )
    expect(stored[OTHER_TENANT_ID]).toBeUndefined()
  })

  test('another tenant reading afterwards is unaffected', async () => {
    registerCatalogue()
    await putCommandSettings(putRequest({ enabledCommandIds: ['customers.deals.update'] }))

    getAuthFromRequest.mockResolvedValue({ tenantId: OTHER_TENANT_ID, sub: 'user-2' })
    const body = await (await getCommandSettings(getRequest())).json()

    expect(body.configured).toBe(false)
    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'sales.orders.update', enabled: true }),
      expect.objectContaining({ commandId: 'customers.deals.update', enabled: false }),
    ])
  })

  test('an id outside the catalogue is refused and nothing is written', async () => {
    registerCatalogue()

    const response = await putCommandSettings(putRequest({ enabledCommandIds: ['auth.users.delete'] }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('WORKFLOW_COMMAND_NOT_IN_CATALOGUE')
    expect(body.commandIds).toEqual(['auth.users.delete'])
    expect(moduleConfigService.setValue).not.toHaveBeenCalled()
  })

  test('a save keeps a stored id whose declaring module is absent from this process', async () => {
    registerCatalogue()
    stored[TENANT_ID] = ['wms.stock.update']

    await putCommandSettings(putRequest({ enabledCommandIds: ['customers.deals.update'] }))

    expect(moduleConfigService.setValue).toHaveBeenCalledWith(
      'workflows',
      'update_entity_enabled_commands',
      ['customers.deals.update', 'wms.stock.update'],
      { tenantId: TENANT_ID },
    )
  })

  test('an empty submission is a real answer and turns the grandfathered command off', async () => {
    registerCatalogue()

    const body = await (await putCommandSettings(putRequest({ enabledCommandIds: [] }))).json()

    expect(stored[TENANT_ID]).toEqual([])
    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'sales.orders.update', enabled: false }),
      expect.objectContaining({ commandId: 'customers.deals.update', enabled: false }),
    ])
  })

  test('rejects a malformed body', async () => {
    registerCatalogue()
    expect((await putCommandSettings(putRequest({ enabledCommandIds: 'all' }))).status).toBe(400)
  })

  test('returns 401 without a tenant', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    expect((await putCommandSettings(putRequest({ enabledCommandIds: [] }))).status).toBe(401)
  })
})
