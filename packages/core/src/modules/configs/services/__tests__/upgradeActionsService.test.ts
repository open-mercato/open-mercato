jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: jest.fn(),
}))

process.env.UPGRADE_ACTIONS_ENABLED = 'true'

import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
import { listPendingUpgradeActions, executeUpgradeAction } from '../upgradeActionsService'
import { upgradeActions, type UpgradeActionDefinition } from '../../lib/upgrade-actions'

const getEnabledModuleIdsMock = getEnabledModuleIds as jest.Mock

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001'
const POST_COMMIT_ACTION_ID = 'test.post-commit-encryption-map-invalidation'

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
    const actionIndex = upgradeActions.findIndex((action) => action.id === POST_COMMIT_ACTION_ID)
    if (actionIndex >= 0) upgradeActions.splice(actionIndex, 1)
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

  it('runs deferred cache invalidation only after the outer transaction commits', async () => {
    const order: string[] = []
    const action: UpgradeActionDefinition = {
      id: POST_COMMIT_ACTION_ID,
      version: '99.0.0',
      messageKey: 'test.message',
      ctaKey: 'test.cta',
      successKey: 'test.success',
      async run({ deferAfterCommit }) {
        order.push('map-write')
        deferAfterCommit?.(() => {
          order.push('cache-invalidation')
        })
      },
    }
    upgradeActions.push(action)
    const transactionalEm = {
      findOne: jest.fn(async () => null),
      create: jest.fn((_Entity: unknown, input: unknown) => input),
      persist: jest.fn(),
      flush: jest.fn(async () => {
        order.push('run-record-flush')
      }),
    }
    const em = {
      transactional: jest.fn(async (callback: (transactionalEm: typeof transactionalEm) => Promise<unknown>) => {
        const result = await callback(transactionalEm)
        order.push('commit')
        return result
      }),
    }
    const container = { resolve: jest.fn(() => em) } as never

    await expect(executeUpgradeAction(container, {
      actionId: POST_COMMIT_ACTION_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '99.0.0',
    })).resolves.toMatchObject({ status: 'completed' })

    expect(order).toEqual(['map-write', 'run-record-flush', 'commit', 'cache-invalidation'])
  })

  it('does not run deferred cache invalidation when the outer transaction rolls back', async () => {
    const invalidate = jest.fn()
    const rollbackError = new Error('deliberate upgrade rollback')
    const action: UpgradeActionDefinition = {
      id: POST_COMMIT_ACTION_ID,
      version: '99.0.0',
      messageKey: 'test.message',
      ctaKey: 'test.cta',
      successKey: 'test.success',
      async run({ deferAfterCommit }) {
        deferAfterCommit?.(invalidate)
        throw rollbackError
      },
    }
    upgradeActions.push(action)
    const transactionalEm = {
      findOne: jest.fn(async () => null),
    }
    const em = {
      transactional: jest.fn(async (callback: (transactionalEm: typeof transactionalEm) => Promise<unknown>) => (
        callback(transactionalEm)
      )),
    }
    const container = { resolve: jest.fn(() => em) } as never

    await expect(executeUpgradeAction(container, {
      actionId: POST_COMMIT_ACTION_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '99.0.0',
    })).rejects.toBe(rollbackError)

    expect(invalidate).not.toHaveBeenCalled()
  })
})
