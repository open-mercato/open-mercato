jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  withAdvisoryXactLock: jest.fn(
    async (em: { transactional: (fn: (tem: unknown) => Promise<unknown>) => Promise<unknown> }, _key: string, fn: (tem: unknown) => Promise<unknown>) =>
      em.transactional(fn),
  ),
}))

process.env.UPGRADE_ACTIONS_ENABLED = 'true'

import { UniqueConstraintViolationException } from '@mikro-orm/core'

import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import {
  executeUpgradeAction,
  listPendingUpgradeActions,
  listUpgradeActionStates,
  revertUpgradeAction,
  UpgradeActionPostCommitError,
} from '../upgradeActionsService'
import { upgradeActions, type UpgradeActionDefinition } from '../../lib/upgrade-actions'
import { registerShippedUpgradeActionModules } from '../../lib/__tests__/helpers/shippedUpgradeActions'

const getEnabledModuleIdsMock = getEnabledModuleIds as jest.Mock

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001'
const POST_COMMIT_ACTION_ID = 'test.post-commit-encryption-map-invalidation'

function createEm(runs: unknown[] = []) {
  return {
    find: jest.fn().mockResolvedValue(runs),
  } as any
}

beforeAll(() => registerShippedUpgradeActionModules())

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

describe('optional customers / attachments upgrade actions', () => {
  afterEach(() => {
    getEnabledModuleIdsMock.mockReset()
  })

  it.each([
    ['customers.seed-interaction-statuses', ['configs', 'attachments']],
    ['attachments.reconcile-organization', ['configs', 'customers']],
  ])('omits %s when its owning module is disabled', async (actionId, enabledModules) => {
    getEnabledModuleIdsMock.mockReturnValue(enabledModules)
    const actions = await listPendingUpgradeActions(createEm(), {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })

    expect(actions.some((action) => action.id === actionId)).toBe(false)
  })

  it('offers the attachments action first when customers is disabled', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs', 'attachments'])
    const actions = await listPendingUpgradeActions(createEm(), {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })

    expect(actions[0]?.id).toBe('attachments.reconcile-organization')
  })

  it('offers both actions when customers and attachments are enabled', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs', 'customers', 'attachments'])
    const actions = await listPendingUpgradeActions(createEm(), {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      version: '0.6.6',
    })
    const ids = actions.map((action) => action.id)

    expect(ids).toContain('customers.seed-interaction-statuses')
    expect(ids).toContain('attachments.reconcile-organization')
  })

  it.each([
    ['customers.seed-interaction-statuses', ['configs', 'attachments']],
    ['attachments.reconcile-organization', ['configs', 'customers']],
  ])('rejects executing %s before any owning-module code runs', async (actionId, enabledModules) => {
    getEnabledModuleIdsMock.mockReturnValue(enabledModules)
    const container = { resolve: jest.fn() }

    await expect(
      executeUpgradeAction(container as never, {
        actionId,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        version: '0.6.6',
      }),
    ).rejects.toThrow('UPGRADE_ACTION_NOT_AVAILABLE')
    expect(container.resolve).not.toHaveBeenCalled()
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

function testAction(overrides: Partial<UpgradeActionDefinition> = {}): UpgradeActionDefinition {
  return {
    id: POST_COMMIT_ACTION_ID,
    version: '99.0.0',
    messageKey: 'test.message',
    ctaKey: 'test.cta',
    successKey: 'test.success',
    run: async () => {},
    ...overrides,
  }
}

function createTransactionalEm(existingRun: unknown = null) {
  const order: string[] = []
  const tem = {
    findOne: jest.fn(async () => existingRun),
    create: jest.fn((_Entity: unknown, input: unknown) => input),
    persist: jest.fn(),
    remove: jest.fn(() => order.push('ledger-delete')),
    flush: jest.fn(async () => {
      order.push('flush')
    }),
  }
  const em = {
    transactional: jest.fn(async (callback: (transactionalEm: typeof tem) => Promise<unknown>) => {
      const result = await callback(tem)
      order.push('commit')
      return result
    }),
  }
  return { em, tem, order, container: { resolve: jest.fn(() => em) } as never }
}

describe('executeUpgradeAction locking and targeting', () => {
  const lockMock = withAdvisoryXactLock as jest.Mock

  afterEach(() => {
    lockMock.mockClear()
    const actionIndex = upgradeActions.findIndex((action) => action.id === POST_COMMIT_ACTION_ID)
    if (actionIndex >= 0) upgradeActions.splice(actionIndex, 1)
  })

  it('serializes an organization-scoped action per organization', async () => {
    upgradeActions.push(testAction())
    const { container } = createTransactionalEm()
    await executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' })
    expect(lockMock.mock.calls[0][1]).toBe(`configs_upgrade_actions:${TENANT_ID}:${ORGANIZATION_ID}:99.0.0:${POST_COMMIT_ACTION_ID}`)
  })

  it('serializes a tenant-wide action across organizations of the tenant', async () => {
    upgradeActions.push(testAction({ scope: 'tenant' }))
    const { container } = createTransactionalEm()
    await executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' })
    expect(lockMock.mock.calls[0][1]).toBe(`configs_upgrade_actions:${TENANT_ID}:tenant:99.0.0:${POST_COMMIT_ACTION_ID}`)
  })

  it('rereads the ledger under the lock and skips an already-applied handler', async () => {
    const run = jest.fn()
    upgradeActions.push(testAction({ run }))
    const { container, tem } = createTransactionalEm({ id: 'existing-run' })
    await expect(
      executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' }),
    ).resolves.toMatchObject({ status: 'already_completed' })
    expect(run).not.toHaveBeenCalled()
    expect(tem.persist).not.toHaveBeenCalled()
  })

  it('rejects an exact version that is not registered', async () => {
    upgradeActions.push(testAction())
    const { container } = createTransactionalEm()
    await expect(
      executeUpgradeAction(container, {
        actionId: POST_COMMIT_ACTION_ID,
        actionVersion: '98.0.0',
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        version: '99.0.0',
      }),
    ).rejects.toThrow('UPGRADE_ACTION_NOT_AVAILABLE')
  })

  it('reports a failed post-commit step after the ledger committed and still runs the others', async () => {
    const second = jest.fn()
    upgradeActions.push(testAction({
      async run({ deferAfterCommit }) {
        deferAfterCommit?.(() => {
          throw new Error('queue sync failed')
        })
        deferAfterCommit?.(second)
      },
    }))
    const { container, order } = createTransactionalEm()
    const outcome = executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' })
    await expect(outcome).rejects.toBeInstanceOf(UpgradeActionPostCommitError)
    expect(order).toEqual(['flush', 'commit'])
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('revertUpgradeAction', () => {
  afterEach(() => {
    const actionIndex = upgradeActions.findIndex((action) => action.id === POST_COMMIT_ACTION_ID)
    if (actionIndex >= 0) upgradeActions.splice(actionIndex, 1)
  })

  const target = { actionId: POST_COMMIT_ACTION_ID, actionVersion: '99.0.0', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' }

  it('runs the compensation and deletes the completion row in one transaction', async () => {
    const down = jest.fn(async ({ em }: { em: unknown }) => {
      expect(em).toBeDefined()
    })
    upgradeActions.push(testAction({ down }))
    const record = { id: 'run-1' }
    const { container, tem, order } = createTransactionalEm(record)
    await expect(revertUpgradeAction(container, target)).resolves.toMatchObject({ status: 'reverted' })
    expect(down).toHaveBeenCalledTimes(1)
    expect(tem.remove).toHaveBeenCalledWith(record)
    expect(order).toEqual(['ledger-delete', 'flush', 'commit'])
  })

  it('refuses a forward-only action before opening a transaction', async () => {
    upgradeActions.push(testAction())
    const { container, em } = createTransactionalEm({ id: 'run-1' })
    await expect(revertUpgradeAction(container, target)).rejects.toThrow('UPGRADE_ACTION_NOT_REVERSIBLE')
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('refuses a tenant-wide action even when it declares down', async () => {
    upgradeActions.push(testAction({ scope: 'tenant', down: jest.fn() }))
    const { container } = createTransactionalEm({ id: 'run-1' })
    await expect(revertUpgradeAction(container, target)).rejects.toThrow('UPGRADE_ACTION_NOT_REVERSIBLE')
  })

  it('refuses an action that was never applied without running the compensation', async () => {
    const down = jest.fn()
    upgradeActions.push(testAction({ down }))
    const { container, tem } = createTransactionalEm(null)
    await expect(revertUpgradeAction(container, target)).rejects.toThrow('UPGRADE_ACTION_NOT_APPLIED')
    expect(down).not.toHaveBeenCalled()
    expect(tem.remove).not.toHaveBeenCalled()
  })

  it('keeps the completion row when the compensation rejects the current state', async () => {
    const rejection = new Error('data changed since apply')
    upgradeActions.push(testAction({ down: jest.fn().mockRejectedValue(rejection) }))
    const { container, tem } = createTransactionalEm({ id: 'run-1' })
    await expect(revertUpgradeAction(container, target)).rejects.toBe(rejection)
    expect(tem.remove).not.toHaveBeenCalled()
  })

  it('refuses an unavailable target before resolving any service', async () => {
    const container = { resolve: jest.fn() }
    await expect(revertUpgradeAction(container as never, { ...target, actionId: 'missing.action' })).rejects.toThrow(
      'UPGRADE_ACTION_NOT_AVAILABLE',
    )
    expect(container.resolve).not.toHaveBeenCalled()
  })
})

describe('listUpgradeActionStates', () => {
  afterEach(() => {
    getEnabledModuleIdsMock.mockReset()
    const actionIndex = upgradeActions.findIndex((action) => action.id === POST_COMMIT_ACTION_ID)
    if (actionIndex >= 0) upgradeActions.splice(actionIndex, 1)
  })

  it('reports owner, scope, applied state and reversibility, and keeps orphaned completion rows', async () => {
    getEnabledModuleIdsMock.mockReturnValue(['configs', 'customers'])
    upgradeActions.push(testAction({ version: '0.10.0', down: async () => {} }))
    const em = createEm([
      { actionId: 'customers.seed-interaction-statuses', version: '0.6.5' },
      { actionId: 'retired.action', version: '0.5.0' },
    ])

    const states = await listUpgradeActionStates(em, { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '0.10.0' })
    const byId = new Map(states.map((entry) => [`${entry.id}@${entry.version}`, entry]))

    expect(em.find).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(byId.get('customers.seed-interaction-statuses@0.6.5')).toMatchObject({
      ownerModuleId: 'customers',
      scope: 'organization',
      applied: true,
      available: true,
      reversible: false,
    })
    expect(byId.get('attachments.reconcile-organization@0.6.6')).toMatchObject({ scope: 'tenant', applied: false, available: false })
    expect(byId.get(`${POST_COMMIT_ACTION_ID}@0.10.0`)).toMatchObject({ ownerModuleId: null, reversible: true, available: true })
    expect(states[states.length - 1]).toEqual({
      id: 'retired.action',
      version: '0.5.0',
      ownerModuleId: null,
      scope: null,
      applied: true,
      available: false,
      reversible: false,
    })
  })
})

describe('executeUpgradeAction unique violations', () => {
  afterEach(() => {
    const actionIndex = upgradeActions.findIndex((action) => action.id === POST_COMMIT_ACTION_ID)
    if (actionIndex >= 0) upgradeActions.splice(actionIndex, 1)
  })

  function violation(): UniqueConstraintViolationException {
    return new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
  }

  function containerWithLedger(recorded: unknown) {
    const { em, container } = createTransactionalEm()
    const fresh = { findOne: jest.fn(async () => recorded) }
    Object.assign(em, { fork: jest.fn(() => fresh) })
    return { container, fresh }
  }

  it('fails when the handler itself violates a unique constraint and no completion was recorded', async () => {
    const handlerViolation = violation()
    upgradeActions.push(testAction({ run: async () => { throw handlerViolation } }))
    const { container } = containerWithLedger(null)
    await expect(
      executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' }),
    ).rejects.toBe(handlerViolation)
  })

  it('reports already_completed when a concurrent writer recorded the completion first', async () => {
    upgradeActions.push(testAction({ run: async () => { throw violation() } }))
    const { container, fresh } = containerWithLedger({ id: 'run-from-older-binary' })
    await expect(
      executeUpgradeAction(container, { actionId: POST_COMMIT_ACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, version: '99.0.0' }),
    ).resolves.toMatchObject({ status: 'already_completed' })
    expect(fresh.findOne).toHaveBeenCalledWith(expect.anything(), {
      actionId: POST_COMMIT_ACTION_ID,
      version: '99.0.0',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })
})
