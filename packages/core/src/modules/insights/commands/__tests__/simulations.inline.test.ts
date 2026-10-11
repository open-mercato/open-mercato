const createSimulationRun = jest.fn()
const insertCompletedSimulationRun = jest.fn()
const enqueueSimulationSlice = jest.fn(async () => undefined)
const ensureSimulationMaintenanceSchedule = jest.fn(async () => true)
const runInlineSimulation = jest.fn()
const callOrder: string[] = []

jest.mock('../../lib/simulation/store', () => {
  const actual = jest.requireActual('../../lib/simulation/store')
  return {
    ...actual,
    createSimulationRun: (...args: unknown[]) => createSimulationRun(...args),
    insertCompletedSimulationRun: (...args: unknown[]) => insertCompletedSimulationRun(...args),
  }
})
jest.mock('../../lib/simulation/queue', () => {
  const actual = jest.requireActual('../../lib/simulation/queue')
  return {
    ...actual,
    enqueueSimulationSlice: (...args: unknown[]) => enqueueSimulationSlice(...(args as [])),
    ensureSimulationMaintenanceSchedule: (...args: unknown[]) => ensureSimulationMaintenanceSchedule(...(args as [])),
  }
})
jest.mock('../../lib/simulation/inline', () => {
  const actual = jest.requireActual('../../lib/simulation/inline')
  return { ...actual, runInlineSimulation: (...args: unknown[]) => runInlineSimulation(...args) }
})
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `t:${key}`, translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: jest.fn() }) }))

import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../../lib/simulation/registry'
import { requestSimulationCommand, simulationProposalErrorStatus } from '../simulations'

const TENANT = '11111111-1111-4111-8111-111111111117'
const ORG = '22222222-2222-4222-8222-222222222227'
const OTHER_ORG = '22222222-2222-4222-8222-222222222228'
const CHILD_ORG = '22222222-2222-4222-8222-222222222229'
const USER = '33333333-3333-4333-8333-333333333337'
const ROLE = '55555555-5555-4555-8555-555555555557'

const validate = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }))
const kindRun = jest.fn()

type OrganizationRow = { id: string; tenant: string; ancestorIds: string[]; descendantIds: string[] }

const ORGANIZATIONS: OrganizationRow[] = [
  { id: ORG, tenant: TENANT, ancestorIds: [], descendantIds: [CHILD_ORG] },
  { id: CHILD_ORG, tenant: TENANT, ancestorIds: [ORG], descendantIds: [] },
  { id: OTHER_ORG, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

type OrganizationWhere = { id?: string | { $in: string[] }; tenant?: string }

function matchesOrganization(row: OrganizationRow, where: OrganizationWhere): boolean {
  if (where.tenant !== undefined && where.tenant !== row.tenant) return false
  if (typeof where.id === 'string') return where.id === row.id
  if (where.id && Array.isArray(where.id.$in)) return where.id.$in.includes(row.id)
  return true
}

function makeContext(options: { accessLog?: unknown; allowedIds?: string[] | null; noScope?: boolean; featureOrganizations?: string[] } = {}) {
  const featureOrganizations = new Set(options.featureOrganizations ?? [ORG, CHILD_ORG, OTHER_ORG])
  const featureAccessCalls: Array<{ userId: string; required: readonly string[] }> = []
  const em = {
    fork: () => em,
    find: async (_entity: unknown, where: OrganizationWhere) => ORGANIZATIONS.filter((row) => matchesOrganization(row, where)).map((row) => ({ ...row })),
    findOne: async (_entity: unknown, where: OrganizationWhere) => {
      const row = ORGANIZATIONS.find((candidate) => matchesOrganization(candidate, where))
      return row ? { ...row } : null
    },
  }
  const progress = { createJob: jest.fn() }
  const accessLog = options.accessLog === undefined
    ? { log: jest.fn(async () => { callOrder.push('access_log'); return { id: 'row' } }) }
    : options.accessLog
  const services: Record<string, unknown> = {
    em,
    progressService: progress,
    accessLogService: accessLog,
    rbacService: {
      userHasAllFeatures: async () => true,
      resolveFeatureOrganizationAccess: async (userId: string, required: readonly string[]) => {
        featureAccessCalls.push({ userId, required })
        return {
          unrestricted: false,
          filterOrganizationIds: (candidates: ReadonlyArray<{ id: string }>) => candidates.map((candidate) => candidate.id).filter((id) => featureOrganizations.has(id)),
        }
      },
    },
  }
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (!(name in services) || services[name] === null) throw new Error(`[internal] missing ${name}`)
        return services[name]
      },
    },
    auth: { sub: USER, tenantId: TENANT, orgId: ORG },
    organizationScope: options.noScope ? null : { selectedId: ORG, filterIds: [ORG], allowedIds: options.allowedIds === undefined ? [ORG, OTHER_ORG] : options.allowedIds, tenantId: TENANT },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  } as unknown as CommandRuntimeContext
  return { ctx, progress, accessLog: accessLog as { log: jest.Mock }, featureAccessCalls }
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    kind: 'test_module.preview',
    artifactId: ROLE,
    proposal: { name: 'proposal' },
    windowFrom: '2026-07-01T00:00:00.000Z',
    windowTo: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(CrudHttpError)
  await promise.catch((error: CrudHttpError) => {
    expect(error.status).toBe(status)
    expect(error.body).toEqual(expect.objectContaining({ code }))
  })
}

const OUTCOME = {
  stored: { k: 10, truncated: false, groups: [], summary: { warnings: [], counts: { pages_lost: 2 }, lists: {} } },
  coverage: {},
  caveats: ['test_module.caveat'],
  fidelity: 'observed',
  recordsProcessed: 7,
  startedAt: Date.parse('2026-10-10T12:00:00.000Z'),
  completedAt: Date.parse('2026-10-10T12:00:01.500Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  callOrder.length = 0
  resetSimulationRegistryForTests()
  runInlineSimulation.mockImplementation(async () => {
    callOrder.push('run')
    return OUTCOME
  })
  insertCompletedSimulationRun.mockImplementation(async (_em: unknown, input: Record<string, unknown>) => ({ id: 'run-1', ...input }))
  registerSimulateConfigEntries([{
    moduleId: 'test_module',
    config: {
      version: 1,
      kinds: [{
        kind: 'test_module.preview',
        artifactKind: 'test_module.acl',
        labelKey: 'test_module.label',
        requiredFeatures: ['test_module.manage'],
        inputSchema: z.object({ name: z.string().min(1) }),
        version: 2,
        cellKeys: ['gains'],
        ttlHours: 24,
        execution: 'inline',
        accessLogResourceKind: 'insights.simulation.permission_preview',
        readArtifactVersion: async () => ({ artifactId: ROLE, updatedAt: null, fingerprint: 'live' }),
        fingerprintProposal: () => 'fp:proposal',
        validate,
        run: kindRun,
      }],
    },
  }])
})

describe('insights.simulation.request — inline kinds', () => {
  it('writes the access-log row first, computes the run in this request and stores it completed for the kind\'s TTL', async () => {
    const { ctx, progress, accessLog } = makeContext()
    const result = await requestSimulationCommand.execute(requestInput(), ctx)
    expect(result).toEqual({ runId: 'run-1', progressJobId: null, status: 'completed', created: true })
    expect(callOrder).toEqual(['access_log', 'run'])
    expect(accessLog.log).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      organizationId: ORG,
      actorUserId: USER,
      resourceKind: 'insights.simulation.permission_preview',
      resourceId: ROLE,
      accessType: 'simulate',
    }))
    const runRequest = runInlineSimulation.mock.calls[0][2] as Record<string, unknown>
    expect(runRequest).toEqual(expect.objectContaining({
      input: { name: 'proposal' },
      scope: { tenantId: TENANT, organizationId: ORG },
      requesterUserId: USER,
      artifactId: ROLE,
      organizationIds: [ORG, CHILD_ORG],
    }))
    const stored = insertCompletedSimulationRun.mock.calls[0][1] as Record<string, unknown>
    expect(stored).toEqual(expect.objectContaining({
      kind: 'test_module.preview',
      requesterUserId: USER,
      artifactId: ROLE,
      artifactVersion: { updatedAt: null, fingerprint: 'live' },
      proposalFingerprint: 'fp:proposal',
      windowFrom: new Date(OUTCOME.startedAt),
      windowTo: new Date(OUTCOME.startedAt),
      startedAt: new Date(OUTCOME.startedAt),
      completedAt: new Date(OUTCOME.completedAt),
      expiresAt: new Date(OUTCOME.completedAt + 24 * 60 * 60 * 1000),
      resultJson: OUTCOME.stored,
      caveats: ['test_module.caveat'],
      fidelity: 'observed',
      contributionVersion: 2,
    }))
    expect(stored.budgets).toEqual(expect.objectContaining({ recordsUsed: 7, elapsedMs: 1500, slices: 1 }))
    expect(createSimulationRun).not.toHaveBeenCalled()
    expect(progress.createJob).not.toHaveBeenCalled()
    expect(enqueueSimulationSlice).not.toHaveBeenCalled()
    const log = await requestSimulationCommand.buildLog!({ input: requestInput(), result, ctx, snapshots: {} } as never)
    expect(log).toEqual(expect.objectContaining({ resourceKind: 'insights.simulation_run', resourceId: 'run-1', replayable: false }))
  })

  it('never deduplicates: two identical requests hash differently', async () => {
    const { ctx } = makeContext()
    await requestSimulationCommand.execute(requestInput(), ctx)
    await requestSimulationCommand.execute(requestInput(), ctx)
    const [first, second] = insertCompletedSimulationRun.mock.calls.map((call) => (call[1] as { inputsHash: string }).inputsHash)
    expect(first).not.toBe(second)
  })

  it('fails closed with 503 when the access log cannot record the preview: nothing is computed or stored', async () => {
    for (const accessLog of [null, { log: jest.fn(async () => null) }, { log: jest.fn(async () => { throw new Error('db down') }) }]) {
      jest.clearAllMocks()
      await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext({ accessLog }).ctx), 503, 'access_log_unavailable')
      expect(runInlineSimulation).not.toHaveBeenCalled()
      expect(insertCompletedSimulationRun).not.toHaveBeenCalled()
    }
  })

  it('passes the run organization\'s feature-scoped subtree (D10) and the requester to the kind\'s validation', async () => {
    await requestSimulationCommand.execute(requestInput(), makeContext({ allowedIds: null }).ctx)
    expect((runInlineSimulation.mock.calls[0][2] as { organizationIds: unknown }).organizationIds).toEqual([ORG, CHILD_ORG])
    await requestSimulationCommand.execute(requestInput(), makeContext({ featureOrganizations: [OTHER_ORG] }).ctx)
    expect((runInlineSimulation.mock.calls[1][2] as { organizationIds: unknown }).organizationIds).toEqual([])
    await expect(requestSimulationCommand.execute(requestInput(), makeContext({ allowedIds: [] }).ctx)).rejects.toBeInstanceOf(CrudHttpError)
    await requestSimulationCommand.execute(requestInput(), makeContext({ noScope: true }).ctx)
    expect((runInlineSimulation.mock.calls[2][2] as { organizationIds: unknown }).organizationIds).toEqual([ORG, CHILD_ORG])
    const validationContext = validate.mock.calls[0][1] as { requesterUserId: string; resolve: (name: string) => unknown }
    expect(validationContext.requesterUserId).toBe(USER)
    expect(validationContext.resolve('accessLogService')).toBeTruthy()
    expect(validationContext.resolve('nothing')).toBeUndefined()
  })

  it('reads only the run organization\'s subtree where the requester holds the kind\'s features, never other allowed organizations (D10)', async () => {
    const { ctx, featureAccessCalls } = makeContext({ allowedIds: [ORG, CHILD_ORG, OTHER_ORG], featureOrganizations: [ORG] })
    await requestSimulationCommand.execute(requestInput(), ctx)
    expect((runInlineSimulation.mock.calls[0][2] as { organizationIds: unknown }).organizationIds).toEqual([ORG])
    expect(featureAccessCalls).toEqual([{ userId: USER, required: ['test_module.manage'] }])
    await requestSimulationCommand.execute(requestInput(), makeContext({ allowedIds: null, featureOrganizations: [ORG, CHILD_ORG, OTHER_ORG] }).ctx)
    expect((runInlineSimulation.mock.calls[1][2] as { organizationIds: unknown }).organizationIds).toEqual([ORG, CHILD_ORG])
  })

  it('maps the kind\'s validation codes: unavailable artifact 404, forbidden proposal 403, others 422', async () => {
    expect(simulationProposalErrorStatus('artifact_unavailable')).toBe(404)
    expect(simulationProposalErrorStatus('forbidden')).toBe(403)
    expect(simulationProposalErrorStatus('invalid_proposal')).toBe(422)
    validate.mockResolvedValueOnce({ ok: false, code: 'artifact_unavailable' } as never)
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext().ctx), 404, 'artifact_unavailable')
    validate.mockResolvedValueOnce({ ok: false, code: 'forbidden' } as never)
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext().ctx), 403, 'forbidden')
    expect(runInlineSimulation).not.toHaveBeenCalled()
  })
})
