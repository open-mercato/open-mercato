jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1' })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: jest.fn() })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => `t:${key}` })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({ scope: { tenantId: 'tenant-1' }, organizationId: 'org-1' })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: jest.fn(() => 'org-1'),
}))
jest.mock('../../../services/upgradeActionsService', () => {
  const actual = jest.requireActual('../../../services/upgradeActionsService')
  return {
    ...actual,
    isUpgradeActionsEnabled: jest.fn(() => true),
    getCurrentVersion: jest.fn(() => '1.0.0'),
    executeUpgradeAction: jest.fn(),
  }
})

import { POST } from '../route'
import { executeUpgradeAction, UpgradeActionPostCommitError } from '../../../services/upgradeActionsService'

const executeMock = executeUpgradeAction as jest.Mock

function postRequest(): Request {
  return new Request('http://localhost/api/configs/upgrade-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: 'cart.register-sweeper-schedules' }),
  })
}

const action = { id: 'cart.register-sweeper-schedules', version: '0.9.1', successKey: 'cart.success' }

describe('POST /api/configs/upgrade-actions', () => {
  it('reports a committed action as completed when only a post-commit step failed', async () => {
    executeMock.mockRejectedValueOnce(new UpgradeActionPostCommitError(action as never, [new Error('redis down')]))
    const response = await POST(postRequest())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'completed', message: 't:cart.success', version: '1.0.0' })
  })

  it('still answers 500 when the action itself failed', async () => {
    executeMock.mockRejectedValueOnce(new Error('handler blew up'))
    const response = await POST(postRequest())
    expect(response.status).toBe(500)
  })

  it('passes the request scope to the runner', async () => {
    executeMock.mockResolvedValueOnce({ action, status: 'completed' })
    const response = await POST(postRequest())
    expect(response.status).toBe(200)
    expect(executeMock).toHaveBeenLastCalledWith(expect.anything(), {
      actionId: 'cart.register-sweeper-schedules',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      version: '1.0.0',
    })
  })
})
