jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: jest.fn(),
}))

process.env.UPGRADE_ACTIONS_ENABLED = 'true'

import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
import { listPendingUpgradeActions, executeUpgradeAction } from '../upgradeActionsService'

const getEnabledModuleIdsMock = getEnabledModuleIds as jest.Mock

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001'

function createEm(runs: unknown[] = []) {
  return {
    find: jest.fn().mockResolvedValue(runs),
  } as any
}

describe('listPendingUpgradeActions module gating', () => {
  afterEach(() => {
    getEnabledModuleIdsMock.mockReset()
  })

  it('omits an action whose required module is disabled', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs', 'customers', 'devices'])
    const em = createEm()

    const actions = await listPendingUpgradeActions(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })

    expect(actions.some((action) => action.id === 'payment_gateways.register-session-initialization-prune')).toBe(false)
  })

  it('includes the action once its required module is enabled', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs', 'customers', 'devices', 'payment_gateways'])
    const em = createEm()

    const actions = await listPendingUpgradeActions(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })

    expect(actions.some((action) => action.id === 'payment_gateways.register-session-initialization-prune')).toBe(true)
  })

  it('fails closed (excludes gated actions) when the module registry is empty', async () => {
    getEnabledModuleIdsMock.mockReturnValue([])
    const em = createEm()

    const actions = await listPendingUpgradeActions(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })

    expect(actions.some((action) => action.id === 'payment_gateways.register-session-initialization-prune')).toBe(false)
  })
})

describe('executeUpgradeAction module gating', () => {
  afterEach(() => {
    getEnabledModuleIdsMock.mockReset()
  })

  it('rejects executing an action whose required module is disabled', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs'])
    const container = {
      resolve: jest.fn(),
    } as any

    await expect(
      executeUpgradeAction(container, {
        actionId: 'payment_gateways.register-session-initialization-prune',
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        version: '0.6.6',
      }),
    ).rejects.toThrow('UPGRADE_ACTION_NOT_AVAILABLE')
  })
})
