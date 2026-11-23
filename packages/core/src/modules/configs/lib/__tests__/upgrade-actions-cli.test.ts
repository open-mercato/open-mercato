jest.mock('../../services/upgradeActionsService', () => {
  const actual = jest.requireActual('../../services/upgradeActionsService')
  return {
    ...actual,
    isUpgradeActionsEnabled: jest.fn(() => true),
    getCurrentVersion: jest.fn(() => '1.0.0'),
    validateUpgradeActionScope: jest.fn(async () => undefined),
    listUpgradeActionStates: jest.fn(async () => []),
    executeUpgradeAction: jest.fn(),
    revertUpgradeAction: jest.fn(),
  }
})

import {
  executeUpgradeAction,
  isUpgradeActionsEnabled,
  listUpgradeActionStates,
  revertUpgradeAction,
  UpgradeActionError,
  UpgradeActionPostCommitError,
  validateUpgradeActionScope,
  type UpgradeActionState,
} from '../../services/upgradeActionsService'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import {
  describeUpgradeActionFailure,
  parseUpgradeActionsCliArgs,
  runUpgradeActionsCli,
  type UpgradeActionsCliDeps,
} from '../upgrade-actions-cli'

const TENANT = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION = '20000000-0000-4000-8000-000000000001'
const SCOPE = ['--tenant', TENANT, '--organization', ORGANIZATION]

const executeMock = executeUpgradeAction as jest.Mock
const revertMock = revertUpgradeAction as jest.Mock
const statesMock = listUpgradeActionStates as jest.Mock
const scopeMock = validateUpgradeActionScope as jest.Mock
const enabledMock = isUpgradeActionsEnabled as jest.Mock

function state(overrides: Partial<UpgradeActionState> & Pick<UpgradeActionState, 'id' | 'version'>): UpgradeActionState {
  return {
    ownerModuleId: overrides.id.split('.')[0],
    scope: 'organization',
    applied: false,
    available: true,
    reversible: false,
    ...overrides,
  }
}

function harness(options: { interactive?: boolean } = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const progress: string[] = []
  const close = jest.fn(async () => undefined)
  const openScope = jest.fn(async () => ({ scope: { container: {} as never, em: {} as never }, close }))
  const deps: UpgradeActionsCliDeps = {
    io: {
      line: (text) => lines.push(text),
      error: (text) => errors.push(text),
      progress: options.interactive ? (text) => progress.push(text) : null,
    },
    openScope,
  }
  return { deps, lines, errors, progress, openScope, close }
}

beforeEach(() => {
  jest.clearAllMocks()
  enabledMock.mockReturnValue(true)
  scopeMock.mockResolvedValue(undefined)
  statesMock.mockResolvedValue([])
  executeMock.mockImplementation(async ({ actionId }: { actionId: string }) => ({ action: { id: actionId }, status: 'completed' }))
})

describe('parseUpgradeActionsCliArgs', () => {
  it('accepts a targeted, tenant-wide up', () => {
    expect(parseUpgradeActionsCliArgs(['up', ...SCOPE, '--action', 'cart.sweep', '--version', '0.9.1', '--allow-tenant-wide'])).toEqual({
      args: {
        subcommand: 'up',
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        actionId: 'cart.sweep',
        actionVersion: '0.9.1',
        allowTenantWide: true,
      },
    })
  })

  it.each([
    [['list', '--tenant', 'nope', '--organization', ORGANIZATION], 'Invalid --tenant'],
    [['list', '--tenant', TENANT], 'Invalid --organization'],
    [['apply', ...SCOPE], 'Invalid subcommand'],
    [['up', ...SCOPE, '--action', 'a.b'], '--action and --version must be passed together'],
    [['down', ...SCOPE], 'down requires --action and --version'],
    [['list', ...SCOPE, '--action', 'a.b', '--version', '1.0.0'], 'list does not accept --action or --version'],
    [['up', ...SCOPE, '--allow-tenant-wide'], '--allow-tenant-wide only applies to a targeted up'],
    [['up', ...SCOPE, '--action', 'a.b', '--version', 'latest'], 'invalid version'],
  ])('rejects %j', (tokens, message) => {
    const result = parseUpgradeActionsCliArgs(tokens)
    expect('error' in result && result.error).toContain(message)
  })
})

describe('describeUpgradeActionFailure', () => {
  it('tells a busy lock and an unknown commit outcome apart from a handler failure', () => {
    expect(describeUpgradeActionFailure(new AdvisoryLockUnavailableError('deadline', 'k:1'))).toContain('another run of this action is in progress')
    expect(describeUpgradeActionFailure(new AdvisoryLockUnavailableError('commit_unknown', 'k:1'))).toContain('run list to see whether it was applied')
    expect(describeUpgradeActionFailure(new AdvisoryLockUnavailableError('transient_db', 'k:1'))).toBe('database unavailable; retry later')
  })

  it('parses --allow-tenant-wide values with the shared boolean parser', () => {
    const tokens = ['up', ...SCOPE, '--action', 'cart.sweep', '--version', '0.9.1', '--allow-tenant-wide', 'yes']
    const parsed = parseUpgradeActionsCliArgs(tokens)
    expect('args' in parsed && parsed.args.allowTenantWide).toBe(true)
  })
})

describe('runUpgradeActionsCli', () => {
  it('prints help without a scope or a database', async () => {
    const { deps, lines, openScope } = harness()
    await expect(runUpgradeActionsCli(['--help'], deps)).resolves.toBe(0)
    await expect(runUpgradeActionsCli([], deps)).resolves.toBe(0)
    expect(lines[0]).toContain('Usage: yarn mercato configs upgrade-actions')
    expect(openScope).not.toHaveBeenCalled()
  })

  it('rejects invalid flags before opening a scope', async () => {
    const { deps, errors, openScope } = harness()
    await expect(runUpgradeActionsCli(['up', '--tenant', TENANT], deps)).resolves.toBe(1)
    expect(errors[0]).toContain('Invalid --organization')
    expect(openScope).not.toHaveBeenCalled()
  })

  it('honors UPGRADE_ACTIONS_ENABLED', async () => {
    enabledMock.mockReturnValue(false)
    const { deps, errors, openScope } = harness()
    await expect(runUpgradeActionsCli(['list', ...SCOPE], deps)).resolves.toBe(1)
    expect(errors[0]).toContain('UPGRADE_ACTIONS_ENABLED')
    expect(openScope).not.toHaveBeenCalled()
  })

  it('refuses a scope mismatch before reading the catalog and closes the scope', async () => {
    scopeMock.mockRejectedValue(new UpgradeActionError('UPGRADE_ACTION_SCOPE_INVALID'))
    const { deps, errors, close } = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE], deps)).resolves.toBe(1)
    expect(errors[0]).toBe('The organization is not an active organization of an active tenant.')
    expect(statesMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('lists owner, state, scope and reversal availability, including orphaned completion rows', async () => {
    statesMock.mockResolvedValue([
      state({ id: 'customers.seed-interaction-statuses', version: '0.6.5', applied: true }),
      state({ id: 'cart.register-sweeper-schedules', version: '0.9.1', scope: 'tenant' }),
      state({ id: 'shop.seed', version: '0.9.2', reversible: true }),
      state({ id: 'legacy.retired', version: '0.5.0', ownerModuleId: null, scope: null, applied: true, available: false }),
    ])
    const { deps, lines } = harness()
    await expect(runUpgradeActionsCli(['list', ...SCOPE], deps)).resolves.toBe(0)
    expect(lines).toEqual([
      ' customers: customers.seed-interaction-statuses@0.6.5 applied (organization, forward-only)',
      ' cart: cart.register-sweeper-schedules@0.9.1 pending (tenant, forward-only)',
      ' shop: shop.seed@0.9.2 pending (organization, reversible)',
      ' legacy: legacy.retired@0.5.0 applied (scope unknown, definition unavailable)',
    ])
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('applies pending organization actions in order, skips tenant-wide ones and prints migration-style summaries', async () => {
    statesMock.mockResolvedValue([
      state({ id: 'customers.seed-interaction-statuses', version: '0.6.5' }),
      state({ id: 'attachments.reconcile-organization', version: '0.6.6', scope: 'tenant' }),
      state({ id: 'payment_gateways.register-session-initialization-prune', version: '0.6.6', applied: true }),
      state({ id: 'customers.seed-deal-loss-reasons', version: '0.10.0' }),
      state({ id: 'phone_calls.seed-call-encryption-maps', version: '0.7.1', available: false }),
    ])
    const { deps, lines, errors } = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE], deps)).resolves.toBe(0)
    expect(executeMock.mock.calls.map(([, input]) => [input.actionId, input.actionVersion])).toEqual([
      ['customers.seed-interaction-statuses', '0.6.5'],
      ['customers.seed-deal-loss-reasons', '0.10.0'],
    ])
    expect(lines).toEqual([
      ' customers: 2 upgrade actions applied',
      ' attachments: no pending upgrade actions',
      ' payment_gateways: no pending upgrade actions',
      ' attachments: skipped tenant-wide attachments.reconcile-organization@0.6.6 (run it with --action attachments.reconcile-organization --version 0.6.6 --allow-tenant-wide)',
    ])
    expect(errors).toEqual([])
  })

  it('draws a progress bar per module only on an interactive terminal', async () => {
    statesMock.mockResolvedValue([
      state({ id: 'customers.seed-interaction-statuses', version: '0.6.5' }),
      state({ id: 'customers.seed-deal-loss-reasons', version: '0.10.0' }),
    ])
    const interactive = harness({ interactive: true })
    await runUpgradeActionsCli(['up', ...SCOPE], interactive.deps)
    expect(interactive.progress).toEqual([
      '   customers: [....................] 0/2',
      '\r   customers: [==========..........] 1/2',
      '\r   customers: [====================] 2/2',
      '\n',
    ])
    const quiet = harness()
    await runUpgradeActionsCli(['up', ...SCOPE], quiet.deps)
    expect(quiet.progress).toEqual([])
  })

  it('stops at the first failure, keeps the committed summary and exits nonzero without leaking the error message', async () => {
    statesMock.mockResolvedValue([
      state({ id: 'customers.seed-interaction-statuses', version: '0.6.5' }),
      state({ id: 'devices.seed-push-token-encryption-map', version: '0.6.6' }),
      state({ id: 'customers.seed-deal-loss-reasons', version: '0.10.0' }),
    ])
    executeMock
      .mockResolvedValueOnce({ status: 'completed' })
      .mockRejectedValueOnce(Object.assign(new TypeError('secret-token=abc in payload'), {}))
    const { deps, lines, errors } = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE], deps)).resolves.toBe(1)
    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(lines).toEqual([' customers: 1 upgrade action applied', ' devices: no pending upgrade actions'])
    expect(errors).toEqual([
      ' devices: devices.seed-push-token-encryption-map@0.6.6 failed: handler failed (TypeError). Later actions were not run.',
    ])
    expect(errors.join('\n')).not.toContain('secret-token')
  })

  it('reports a post-commit failure as applied and exits nonzero', async () => {
    statesMock.mockResolvedValue([state({ id: 'devices.seed-push-token-encryption-map', version: '0.6.6' })])
    executeMock.mockRejectedValueOnce(new UpgradeActionPostCommitError({ id: 'devices.x', version: '0.6.6' } as never, [new Error('x')]))
    const { deps, lines, errors } = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE], deps)).resolves.toBe(1)
    expect(lines).toEqual([' devices: 1 upgrade action applied'])
    expect(errors[0]).toContain('was applied, but post-commit step failed. Rerunning will not repeat it.')
  })

  it('prints an overall empty result when no module has eligible actions', async () => {
    const { deps, lines } = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE], deps)).resolves.toBe(0)
    expect(lines).toEqual(['No pending upgrade actions.'])
  })

  it('refuses a targeted tenant-wide action without --allow-tenant-wide and runs it with the opt-in', async () => {
    statesMock.mockResolvedValue([state({ id: 'cart.register-sweeper-schedules', version: '0.9.1', scope: 'tenant' })])
    const target = ['--action', 'cart.register-sweeper-schedules', '--version', '0.9.1']
    const refused = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE, ...target], refused.deps)).resolves.toBe(1)
    expect(refused.errors[0]).toContain('pass --allow-tenant-wide')
    expect(executeMock).not.toHaveBeenCalled()

    const allowed = harness()
    await expect(runUpgradeActionsCli(['up', ...SCOPE, ...target, '--allow-tenant-wide'], allowed.deps)).resolves.toBe(0)
    expect(executeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionId: 'cart.register-sweeper-schedules', actionVersion: '0.9.1' }))
    expect(allowed.lines).toEqual([' cart: 1 upgrade action applied'])
  })

  it('treats an already-applied target as a successful no-op', async () => {
    statesMock.mockResolvedValue([state({ id: 'customers.seed-deal-loss-reasons', version: '0.10.0', applied: true })])
    executeMock.mockResolvedValueOnce({ status: 'already_completed' })
    const { deps, lines } = harness()
    await expect(
      runUpgradeActionsCli(['up', ...SCOPE, '--action', 'customers.seed-deal-loss-reasons', '--version', '0.10.0'], deps),
    ).resolves.toBe(0)
    expect(lines).toEqual([' customers: no pending upgrade actions'])
  })

  it('rejects a version that is not registered for the action', async () => {
    statesMock.mockResolvedValue([state({ id: 'customers.seed-deal-loss-reasons', version: '0.10.0' })])
    const { deps, errors } = harness()
    await expect(
      runUpgradeActionsCli(['up', ...SCOPE, '--action', 'customers.seed-deal-loss-reasons', '--version', '0.9.0'], deps),
    ).resolves.toBe(1)
    expect(errors).toEqual([' customers: customers.seed-deal-loss-reasons@0.9.0 failed: UPGRADE_ACTION_NOT_AVAILABLE'])
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('runUpgradeActionsCli down', () => {
  const target = ['--action', 'shop.seed', '--version', '0.9.2']

  it('reverts one reversible action', async () => {
    statesMock.mockResolvedValue([state({ id: 'shop.seed', version: '0.9.2', applied: true, reversible: true })])
    revertMock.mockResolvedValueOnce({ status: 'reverted' })
    const { deps, lines } = harness()
    await expect(runUpgradeActionsCli(['down', ...SCOPE, ...target], deps)).resolves.toBe(0)
    expect(revertMock).toHaveBeenCalledWith(expect.anything(), {
      actionId: 'shop.seed',
      actionVersion: '0.9.2',
      tenantId: TENANT,
      organizationId: ORGANIZATION,
    })
    expect(lines).toEqual([' shop: 1 upgrade action reverted'])
  })

  it.each([
    ['UPGRADE_ACTION_NOT_REVERSIBLE'],
    ['UPGRADE_ACTION_NOT_APPLIED'],
    ['UPGRADE_ACTION_NOT_AVAILABLE'],
  ] as const)('exits nonzero when the service refuses with %s', async (code) => {
    statesMock.mockResolvedValue([state({ id: 'shop.seed', version: '0.9.2', applied: true })])
    revertMock.mockRejectedValueOnce(new UpgradeActionError(code))
    const { deps, errors } = harness()
    await expect(runUpgradeActionsCli(['down', ...SCOPE, ...target], deps)).resolves.toBe(1)
    expect(errors).toEqual([` shop: shop.seed@0.9.2 was not reverted: ${code}`])
  })

  it('reports a rejected compensation without leaking its message', async () => {
    statesMock.mockResolvedValue([state({ id: 'shop.seed', version: '0.9.2', applied: true, reversible: true })])
    revertMock.mockRejectedValueOnce(new RangeError('customer email jane@example.com changed'))
    const { deps, errors } = harness()
    await expect(runUpgradeActionsCli(['down', ...SCOPE, ...target], deps)).resolves.toBe(1)
    expect(errors).toEqual([' shop: shop.seed@0.9.2 was not reverted: handler failed (RangeError)'])
  })
})
