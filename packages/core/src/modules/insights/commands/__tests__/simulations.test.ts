const createSimulationRun = jest.fn()
const attachProgressJob = jest.fn(async () => true)
const updateActiveSimulationRun = jest.fn()
const findSimulationRun = jest.fn()
const insertSimulationDecision = jest.fn()
const enqueueSimulationSlice = jest.fn(async () => undefined)
const ensureSimulationMaintenanceSchedule = jest.fn(async () => true)

jest.mock('../../lib/simulation/store', () => {
  const actual = jest.requireActual('../../lib/simulation/store')
  return {
    ...actual,
    createSimulationRun: (...args: unknown[]) => createSimulationRun(...args),
    attachProgressJob: (...args: unknown[]) => attachProgressJob(...(args as [])),
    updateActiveSimulationRun: (...args: unknown[]) => updateActiveSimulationRun(...args),
    findSimulationRun: (...args: unknown[]) => findSimulationRun(...args),
    insertSimulationDecision: (...args: unknown[]) => insertSimulationDecision(...args),
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
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `t:${key}`, translate: (key: string, fallback?: string) => fallback ?? key }),
}))

import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../../lib/simulation/registry'
import { SimulationBusyError, SimulationDecisionExistsError } from '../../lib/simulation/store'
import { cancelSimulationCommand, recordDecisionCommand, requestSimulationCommand } from '../simulations'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '44444444-4444-4444-8444-444444444444'
const ARTIFACT = '55555555-5555-4555-8555-555555555555'
const JOB_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_ORG = '77777777-7777-4777-8777-777777777777'
const OTHER_USER = '88888888-8888-4888-8888-888888888888'

const readArtifactVersion = jest.fn()
const validate = jest.fn(async () => ({ ok: true as const }))

function makeContext(granted: (features: string[]) => boolean = () => true) {
  const progress = {
    createJob: jest.fn(async () => ({ id: JOB_ID })),
    markCancelled: jest.fn(async () => ({})),
    failJob: jest.fn(async () => ({})),
    updateProgress: jest.fn(async () => ({})),
    completeJob: jest.fn(async () => ({})),
  }
  const em = { fork: () => em }
  const services: Record<string, unknown> = {
    em,
    progressService: progress,
    rbacService: { userHasAllFeatures: async (_user: string, features: string[]) => granted(features) },
  }
  const ctx = {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: USER, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  } as unknown as CommandRuntimeContext
  return { ctx, progress }
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    kind: 'test_module.backtest',
    artifactId: ARTIFACT,
    proposal: { name: 'proposal' },
    windowFrom: '2026-07-01T00:00:00.000Z',
    windowTo: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    kind: 'test_module.backtest',
    status: 'completed',
    progressJobId: JOB_ID,
    requestedByUserId: USER,
    inputJson: { name: 'proposal' },
    artifactKind: 'test_module.thing',
    artifactId: ARTIFACT,
    artifactVersionJson: { updatedAt: '2026-10-01T00:00:00.000Z', fingerprint: 'old' },
    proposalFingerprint: 'fp:proposal',
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  }
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string): Promise<CrudHttpError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CrudHttpError)
    const httpError = error as CrudHttpError
    expect(httpError.status).toBe(status)
    expect(httpError.body).toEqual(expect.objectContaining({ code, error: `t:insights.simulation.errors.${code}` }))
    return httpError
  }
  throw new Error('[internal] expected an HTTP error')
}

beforeEach(() => {
  jest.clearAllMocks()
  resetSimulationRegistryForTests()
  readArtifactVersion.mockResolvedValue({ artifactId: ARTIFACT, updatedAt: '2026-10-01T00:00:00.000Z', fingerprint: 'old' })
  registerSimulateConfigEntries([{
    moduleId: 'test_module',
    config: {
      version: 1,
      kinds: [{
        kind: 'test_module.backtest',
        artifactKind: 'test_module.thing',
        labelKey: 'test_module.label',
        requiredFeatures: ['test_module.view'],
        inputSchema: z.object({ name: z.string().min(1) }),
        version: 3,
        cellKeys: ['fires'],
        readArtifactVersion,
        fingerprintProposal: (input: { name: string }) => `fp:${input.name}`,
        inputFeatures: () => ['test_module.records.view'],
        validate,
        run: async () => ({ status: 'done' as const, recordsProcessed: 0, result: { groups: [], coverage: {}, caveats: [], fidelity: 'none' as const, truncated: false } }),
      }],
    },
  }])
})

describe('insights.simulation.request', () => {
  it('creates a run with server-captured version and fingerprint, a minimal ProgressJob and an ids-only job', async () => {
    const { ctx, progress } = makeContext()
    createSimulationRun.mockImplementation(async (_em: unknown, input: Record<string, unknown>) => ({ created: true, run: run({ status: 'queued', ...input, id: RUN_ID }), abandoned: [] }))
    const result = await requestSimulationCommand.execute(requestInput(), ctx)
    expect(result).toEqual({ runId: RUN_ID, progressJobId: JOB_ID, status: 'queued', created: true })
    const created = createSimulationRun.mock.calls[0][1] as Record<string, unknown>
    expect(created).toEqual(expect.objectContaining({
      kind: 'test_module.backtest',
      requesterUserId: USER,
      input: { name: 'proposal' },
      artifactKind: 'test_module.thing',
      artifactId: ARTIFACT,
      artifactVersion: { updatedAt: '2026-10-01T00:00:00.000Z', fingerprint: 'old' },
      proposalFingerprint: 'fp:proposal',
      contributionVersion: 3,
      engineVersion: 1,
    }))
    expect(typeof created.inputsHash).toBe('string')
    expect(progress.createJob).toHaveBeenCalledTimes(1)
    expect(progress.createJob).toHaveBeenCalledWith(
      { jobType: 'insights.simulation', name: 't:insights.simulation.progress.name', cancellable: false, meta: { runId: RUN_ID } },
      { tenantId: TENANT, organizationId: ORG, userId: USER },
    )
    expect(enqueueSimulationSlice).toHaveBeenCalledWith({ runId: RUN_ID, tenantId: TENANT, organizationId: ORG })
    expect(ensureSimulationMaintenanceSchedule).toHaveBeenCalled()
    const log = await requestSimulationCommand.buildLog!({ input: requestInput(), result, ctx, snapshots: {} } as never)
    expect(log).toEqual(expect.objectContaining({ resourceKind: 'insights.simulation_run', resourceId: RUN_ID, replayable: false }))
    expect(JSON.stringify(log)).not.toContain('proposal')
  })

  it('stores and hashes the artifact id the kind resolved, not the caller\'s spelling of it', async () => {
    const { ctx } = makeContext()
    createSimulationRun.mockImplementation(async (_em: unknown, input: Record<string, unknown>) => ({ created: true, run: run({ status: 'queued', ...input, id: RUN_ID }), abandoned: [] }))
    await requestSimulationCommand.execute(requestInput(), ctx)
    await requestSimulationCommand.execute(requestInput({ artifactId: ARTIFACT.toUpperCase() }), ctx)
    const [lower, upper] = createSimulationRun.mock.calls.map((call) => call[1] as Record<string, unknown>)
    expect(upper.artifactId).toBe(ARTIFACT)
    expect(upper.inputsHash).toBe(lower.inputsHash)
  })

  it('returns the caller\'s identical live run without a new job or an audit entry', async () => {
    const { ctx, progress } = makeContext()
    createSimulationRun.mockResolvedValue({ created: false, run: run({ status: 'running' }), abandoned: [] })
    const result = await requestSimulationCommand.execute(requestInput(), ctx)
    expect(result).toEqual({ runId: RUN_ID, progressJobId: JOB_ID, status: 'running', created: false })
    expect(progress.createJob).not.toHaveBeenCalled()
    expect(enqueueSimulationSlice).not.toHaveBeenCalled()
    expect(await requestSimulationCommand.buildLog!({ input: requestInput(), result, ctx, snapshots: {} } as never)).toBeNull()
  })

  it('refuses missing kind features, invalid proposals, kind validation failures and unknown artifacts', async () => {
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext((features) => !features.includes('test_module.view')).ctx), 403, 'forbidden')
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext((features) => !features.includes('insights.simulator.run')).ctx), 403, 'forbidden')
    const inputDenied = await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext((features) => !features.includes('test_module.records.view')).ctx), 403, 'forbidden')
    expect(inputDenied.body).toEqual(expect.objectContaining({ requiredFeatures: ['test_module.view', 'test_module.records.view'] }))
    const invalid = await expectHttpError(requestSimulationCommand.execute(requestInput({ proposal: { name: '' } }), makeContext().ctx), 422, 'invalid_proposal')
    expect((invalid.body as { issues: unknown[] }).issues).toEqual([expect.objectContaining({ path: 'name' })])
    validate.mockResolvedValueOnce({ ok: false, code: 'unsupported_event_payload' } as never)
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext().ctx), 422, 'unsupported_event_payload')
    expect(validate).toHaveBeenLastCalledWith({ name: 'proposal' }, expect.objectContaining({ scope: { tenantId: TENANT, organizationId: ORG }, artifactId: ARTIFACT }))
    validate.mockResolvedValueOnce({ ok: false, code: 'not_customized' } as never)
    await expectHttpError(requestSimulationCommand.execute(requestInput({ artifactId: 'code:test_flow' }), makeContext().ctx), 422, 'not_customized')
    expect(validate).toHaveBeenLastCalledWith({ name: 'proposal' }, expect.objectContaining({ artifactId: 'code:test_flow' }))
    readArtifactVersion.mockResolvedValueOnce(null)
    await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext().ctx), 422, 'artifact_not_found')
    await expectHttpError(requestSimulationCommand.execute(requestInput({ kind: 'gone_module.kind' }), makeContext().ctx), 422, 'unsupported_kind')
    expect(createSimulationRun).not.toHaveBeenCalled()
  })

  it('answers 429 simulation_busy when the active-run limits are reached', async () => {
    createSimulationRun.mockRejectedValue(new SimulationBusyError('tenant'))
    const busy = await expectHttpError(requestSimulationCommand.execute(requestInput(), makeContext().ctx), 429, 'simulation_busy')
    expect(busy.body).toEqual(expect.objectContaining({ reason: 'tenant' }))
  })

  it('fails the run and its ProgressJob when the job cannot be enqueued', async () => {
    const { ctx, progress } = makeContext()
    const staleScope = { tenantId: TENANT, organizationId: OTHER_ORG, requestedByUserId: OTHER_USER }
    createSimulationRun.mockResolvedValue({ created: true, run: run({ status: 'queued' }), abandoned: [{ id: 'stale', progressJobId: 'stale-job', ...staleScope }] })
    enqueueSimulationSlice.mockRejectedValueOnce(new Error('queue down'))
    updateActiveSimulationRun.mockResolvedValue(run({ status: 'failed' }))
    await expect(requestSimulationCommand.execute(requestInput(), ctx)).rejects.toThrow('queue down')
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, organizationId: ORG }, RUN_ID, null, expect.objectContaining({ status: 'failed', errorCode: 'internal' }))
    expect(progress.failJob).toHaveBeenCalledWith('stale-job', { errorMessage: 'abandoned' }, { tenantId: TENANT, organizationId: OTHER_ORG, userId: OTHER_USER })
    expect(progress.failJob).toHaveBeenCalledWith(JOB_ID, { errorMessage: 'internal' }, expect.anything())
  })
})

describe('insights.simulation.cancel', () => {
  const input = { tenantId: TENANT, organizationId: ORG, runId: RUN_ID, userId: USER, allowForeign: false }

  it('cancels the requester\'s active run and its ProgressJob', async () => {
    const { ctx, progress } = makeContext()
    findSimulationRun.mockResolvedValue(run({ status: 'running' }))
    updateActiveSimulationRun.mockResolvedValue(run({ status: 'cancelled' }))
    await expect(cancelSimulationCommand.execute(input, ctx)).resolves.toEqual({ runId: RUN_ID, status: 'cancelled' })
    expect(findSimulationRun).toHaveBeenCalledWith(expect.anything(), { scope: { tenantId: TENANT, organizationId: ORG }, runId: RUN_ID, requesterUserId: USER })
    expect(progress.markCancelled).toHaveBeenCalledWith(JOB_ID, { tenantId: TENANT, organizationId: ORG, userId: USER })
  })

  it('looks beyond the requester only for progress managers and answers 404/409 otherwise', async () => {
    findSimulationRun.mockResolvedValue(null)
    await expectHttpError(cancelSimulationCommand.execute(input, makeContext().ctx), 404, 'run_not_found')
    findSimulationRun.mockResolvedValue(run({ status: 'running', requestedByUserId: 'someone-else' }))
    updateActiveSimulationRun.mockResolvedValue(run({ status: 'cancelled' }))
    await cancelSimulationCommand.execute({ ...input, allowForeign: true }, makeContext().ctx)
    expect(findSimulationRun).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ requesterUserId: null }))
    findSimulationRun.mockResolvedValue(run({ status: 'completed' }))
    await expectHttpError(cancelSimulationCommand.execute(input, makeContext().ctx), 409, 'run_not_active')
  })
})

describe('insights.simulation.decision.record', () => {
  const input = { tenantId: TENANT, organizationId: ORG, runId: RUN_ID, userId: USER, decision: 'applied' as const }

  beforeEach(() => {
    insertSimulationDecision.mockImplementation(async (_em: unknown, decision: Record<string, unknown>) => ({
      id: 'decision-1',
      decision: decision.decision,
      verified: decision.verified,
      artifactId: decision.artifactId,
      artifactUpdatedAtAfter: decision.artifactUpdatedAtAfter,
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
    }))
  })

  it('verifies an applied decision against the live artifact on the server', async () => {
    findSimulationRun.mockResolvedValue(run())
    readArtifactVersion.mockResolvedValue({ artifactId: ARTIFACT, updatedAt: '2026-10-02T00:00:00.000Z', fingerprint: 'fp:proposal' })
    const result = await recordDecisionCommand.execute(input, makeContext().ctx)
    expect(result.decision).toEqual({ decision: 'applied', verified: true, artifactId: ARTIFACT, artifactUpdatedAtAfter: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-03T00:00:00.000Z' })
    readArtifactVersion.mockResolvedValue({ artifactId: ARTIFACT, updatedAt: '2026-10-02T00:00:00.000Z', fingerprint: 'fp:something-else' })
    expect((await recordDecisionCommand.execute(input, makeContext().ctx)).decision.verified).toBe(false)
  })

  it('records a discard without verification', async () => {
    findSimulationRun.mockResolvedValue(run())
    const result = await recordDecisionCommand.execute({ ...input, decision: 'discarded' }, makeContext().ctx)
    expect(result.decision).toEqual(expect.objectContaining({ decision: 'discarded', verified: null }))
    expect(readArtifactVersion).not.toHaveBeenCalled()
  })

  it('answers the same 404 when the caller lost a feature the run\'s proposal needs', async () => {
    findSimulationRun.mockResolvedValue(run())
    await expectHttpError(recordDecisionCommand.execute(input, makeContext((features) => !features.includes('test_module.records.view')).ctx), 404, 'run_not_found')
  })

  it('answers 404 for runs of others, 409 for unfinished runs and duplicate decisions', async () => {
    findSimulationRun.mockResolvedValue(null)
    await expectHttpError(recordDecisionCommand.execute(input, makeContext().ctx), 404, 'run_not_found')
    expect(findSimulationRun).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ requesterUserId: USER }))
    findSimulationRun.mockResolvedValue(run({ status: 'running' }))
    await expectHttpError(recordDecisionCommand.execute(input, makeContext().ctx), 409, 'run_not_completed')
    findSimulationRun.mockResolvedValue(run())
    insertSimulationDecision.mockRejectedValueOnce(new SimulationDecisionExistsError())
    await expectHttpError(recordDecisionCommand.execute(input, makeContext().ctx), 409, 'decision_exists')
  })
})
