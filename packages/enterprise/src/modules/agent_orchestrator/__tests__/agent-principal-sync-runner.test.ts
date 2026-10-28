import type { AgentPrincipalScope } from '../lib/identity/agentPrincipalService'
import type { SyncAgentPrincipalsResult } from '../lib/identity/syncAgentPrincipals'

const mockSyncAgentPrincipals = jest.fn<Promise<SyncAgentPrincipalsResult>, unknown[]>()
const mockEnsureAgentsLoaded = jest.fn(async () => undefined)
const mockListAgentEntries = jest.fn(() => [{ id: 'customers.deal_checker' }])
const mockReportError = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('../lib/identity/syncAgentPrincipals', () => ({
  syncAgentPrincipals: (...args: unknown[]) => mockSyncAgentPrincipals(...args),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: () => mockEnsureAgentsLoaded(),
  listAgentEntries: () => mockListAgentEntries(),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => (key === 'em' ? { fork: () => ({ forked: true }) } : undefined),
  })),
}))

jest.mock('../lib/eval/defaultAssertions', () => ({ seedDefaultEvalAssertions: jest.fn(async () => undefined) }))
jest.mock('../lib/settings/agentSettings', () => ({ seedDefaultAgentIcons: jest.fn(async () => undefined) }))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({ syncGroundingSets: jest.fn(async () => undefined) }))
jest.mock('../lib/guardrails/integrity/integritySets', () => ({ syncIntegritySets: jest.fn(async () => undefined) }))
jest.mock('../lib/seeds', () => ({ seedAgentOrchestratorExamples: jest.fn(async () => undefined) }))

import {
  createPrincipalSyncDeps,
  formatPrincipalSyncSummary,
  listPrincipalSyncScopes,
  runPrincipalSync,
  type PrincipalSyncDeps,
} from '../lib/identity/principalSyncCommand'
import cliCommands from '../cli'
import setup from '../setup'

const SCOPE_A: AgentPrincipalScope = { tenantId: 'tenant-A', organizationId: 'org-A' }
const SCOPE_B: AgentPrincipalScope = { tenantId: 'tenant-B', organizationId: 'org-B' }

function syncResult(overrides: Partial<SyncAgentPrincipalsResult> = {}): SyncAgentPrincipalsResult {
  return { created: [], synced: [], reused: [], disabled: [], droppedFeatures: {}, ...overrides }
}

function fakeDeps(scopes: AgentPrincipalScope[], sync: PrincipalSyncDeps['sync']): PrincipalSyncDeps {
  return {
    listScopes: jest.fn(async () => scopes),
    loadAgents: jest.fn(async () => []),
    sync: jest.fn(sync),
  }
}

beforeEach(() => {
  mockSyncAgentPrincipals.mockReset()
  mockReportError.mockReset()
  mockFindWithDecryption.mockReset()
  process.exitCode = undefined
})

afterAll(() => {
  process.exitCode = undefined
})

describe('runPrincipalSync', () => {
  it('syncs every selected organization and totals the outcomes', async () => {
    const deps = fakeDeps([SCOPE_A, SCOPE_B], async (scope) =>
      scope.organizationId === 'org-A'
        ? syncResult({ created: ['agent.one'], reused: ['agent.two'] })
        : syncResult({ synced: ['agent.one'], disabled: ['agent.old'] }),
    )

    const summary = await runPrincipalSync({ tenantId: 'tenant-A' }, deps)

    expect(deps.listScopes).toHaveBeenCalledWith({ tenantId: 'tenant-A' })
    expect(summary.totals).toEqual({ created: 1, synced: 1, reused: 1, disabled: 1, failed: 0 })
    expect(summary.outcomes.map((outcome) => outcome.scope)).toEqual([SCOPE_A, SCOPE_B])
  })

  it('records a failing organization and keeps syncing the rest', async () => {
    const deps = fakeDeps([SCOPE_A, SCOPE_B], async (scope) => {
      if (scope.organizationId === 'org-A') throw new Error('boom')
      return syncResult({ created: ['agent.one'] })
    })

    const summary = await runPrincipalSync({}, deps)

    expect(summary.totals.failed).toBe(1)
    expect(summary.totals.created).toBe(1)
    expect(summary.outcomes[0]).toMatchObject({ result: null, error: 'boom' })
  })

  it('formats a per-organization line plus a totals line', () => {
    const lines = formatPrincipalSyncSummary({
      outcomes: [
        {
          scope: SCOPE_A,
          result: syncResult({ created: ['agent.one'], droppedFeatures: { 'agent.one': ['nope.feature'] } }),
          error: null,
        },
        { scope: SCOPE_B, result: null, error: 'boom' },
      ],
      totals: { created: 1, synced: 0, reused: 0, disabled: 0, failed: 1 },
    })

    expect(lines).toEqual([
      'tenant=tenant-A org=org-A: created agent.one; updated -; reused -; disabled -',
      '  agent.one: dropped undeclared features nope.feature',
      'tenant=tenant-B org=org-B: failed (boom)',
      'Done. 2 organization(s): 1 created, 0 updated, 0 reused, 0 disabled, 1 failed.',
    ])
  })
})

describe('listPrincipalSyncScopes', () => {
  it('narrows by tenant and organization and maps each organization to its scope', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'org-A', tenant: { id: 'tenant-A' } },
      { id: 'org-orphan', tenant: null },
    ])
    const em = {} as Parameters<typeof listPrincipalSyncScopes>[0]

    const scopes = await listPrincipalSyncScopes(em, { tenantId: 'tenant-A', organizationId: 'org-A' })

    expect(scopes).toEqual([SCOPE_A])
    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ deletedAt: null, tenant: 'tenant-A', id: 'org-A' })
  })

  it('lists every live organization without a filter', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    await listPrincipalSyncScopes({} as Parameters<typeof listPrincipalSyncScopes>[0], {})
    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ deletedAt: null })
  })
})

describe('createPrincipalSyncDeps', () => {
  it('loads the agent registry and delegates to syncAgentPrincipals', async () => {
    mockSyncAgentPrincipals.mockResolvedValueOnce(syncResult())
    const container = { resolve: jest.fn() } as unknown as Parameters<typeof createPrincipalSyncDeps>[0]
    const deps = createPrincipalSyncDeps(container)

    const agents = await deps.loadAgents()
    await deps.sync(SCOPE_A, { agents })

    expect(mockEnsureAgentsLoaded).toHaveBeenCalled()
    expect(mockSyncAgentPrincipals).toHaveBeenCalledWith(container, SCOPE_A, { agents })
  })
})

describe('principals:sync CLI', () => {
  function principalsSyncCommand() {
    const command = cliCommands.find((entry) => entry.command === 'principals:sync')
    if (!command) throw new Error('[test] principals:sync command missing')
    return command
  }

  it('syncs the organization named by --tenant/--org and prints the summary', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'org-A', tenant: { id: 'tenant-A' } }])
    mockSyncAgentPrincipals.mockResolvedValueOnce(syncResult({ created: ['customers.deal_checker'] }))
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await principalsSyncCommand().run(['--tenant', 'tenant-A', '--org', 'org-A'])

    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ deletedAt: null, tenant: 'tenant-A', id: 'org-A' })
    expect(mockSyncAgentPrincipals).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.map((call) => call[0])).toContain(
      'Done. 1 organization(s): 1 created, 0 updated, 0 reused, 0 disabled, 0 failed.',
    )
    expect(process.exitCode).toBeUndefined()
    log.mockRestore()
  })

  it('exits non-zero when an organization fails or none matches', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'org-A', tenant: { id: 'tenant-A' } }])
    mockSyncAgentPrincipals.mockRejectedValueOnce(new Error('boom'))
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await principalsSyncCommand().run([])
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    mockFindWithDecryption.mockResolvedValueOnce([])
    await principalsSyncCommand().run(['--tenant', 'missing'])
    expect(process.exitCode).toBe(1)

    log.mockRestore()
    error.mockRestore()
  })
})

describe('setup seedDefaults principal sync', () => {
  function seedContext() {
    return {
      em: {},
      container: { resolve: jest.fn(), hasRegistration: () => false },
      tenantId: 'tenant-A',
      organizationId: 'org-A',
    } as unknown as Parameters<NonNullable<typeof setup.seedDefaults>>[0]
  }

  it('syncs the declared principals of the seeded organization', async () => {
    mockSyncAgentPrincipals.mockResolvedValueOnce(syncResult())
    const ctx = seedContext()

    await setup.seedDefaults!(ctx)

    expect(mockSyncAgentPrincipals).toHaveBeenCalledWith(ctx.container, SCOPE_A, {
      agents: [{ id: 'customers.deal_checker' }],
    })
  })

  it('is best-effort: a sync failure is reported and never fails setup', async () => {
    const failure = new Error('sync failed')
    mockSyncAgentPrincipals.mockRejectedValueOnce(failure)

    await expect(setup.seedDefaults!(seedContext())).resolves.toBeUndefined()

    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.principal_sync_failed',
    })
  })
})

describe('setup seedDefaults schedules', () => {
  it('registers the daily per-org trace content retention schedule', async () => {
    mockSyncAgentPrincipals.mockResolvedValueOnce(syncResult())
    const register = jest.fn(async () => undefined)
    const ctx = {
      em: {},
      container: {
        resolve: (name: string) => (name === 'schedulerService' ? { register } : undefined),
        hasRegistration: (name: string) => name === 'schedulerService',
      },
      tenantId: 'tenant-A',
      organizationId: 'org-A',
    } as unknown as Parameters<NonNullable<typeof setup.seedDefaults>>[0]

    await setup.seedDefaults!(ctx)

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'organization',
        organizationId: 'org-A',
        tenantId: 'tenant-A',
        scheduleType: 'interval',
        scheduleValue: '86400s',
        targetType: 'queue',
        targetQueue: 'agent-orchestrator-trace-content-retention',
        targetPayload: { scope: SCOPE_A },
      }),
    )
    const retentionCall = register.mock.calls.find(
      (call) => (call as unknown as [{ targetQueue: string }])[0].targetQueue === 'agent-orchestrator-trace-content-retention',
    ) as unknown as [{ id: string }]
    expect(retentionCall[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
