const loadXraySettings = jest.fn(async (..._args: unknown[]) => ({ kAnonymity: 10 }))

jest.mock('../../projection/settings', () => ({ loadXraySettings: (...args: unknown[]) => loadXraySettings(...args) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: jest.fn() }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import { z } from 'zod'
import type { SimulationKindDefinition, SimulationKindResult, SimulationRunContext } from '@open-mercato/shared/modules/insights/simulate'
import { SIMULATION_COVERAGE_HIDDEN_CAVEAT, sanitizeSimulationSummary } from '../jobs'
import {
  SimulationAccessLogUnavailableError,
  SimulationInlineRunError,
  createServiceResolver,
  runInlineSimulation,
  simulationScopeOrganizationIds,
  writeSimulationAccessLog,
} from '../inline'

const SCOPE = { tenantId: '11111111-0000-4000-8000-0000000000e1', organizationId: '22222222-0000-4000-8000-0000000000e1' }
const USER = '33333333-0000-4000-8000-0000000000e1'

function kindReturning(result: SimulationKindResult, captured: { ctx?: SimulationRunContext<unknown> } = {}): SimulationKindDefinition {
  return {
    kind: 'test_module.preview',
    artifactKind: 'test_module.thing',
    labelKey: 'test_module.label',
    requiredFeatures: ['test_module.view'],
    inputSchema: z.object({}),
    version: 1,
    cellKeys: ['gains', 'loses'],
    execution: 'inline',
    readArtifactVersion: async () => null,
    fingerprintProposal: () => 'fp',
    run: async (_input, ctx) => {
      captured.ctx = ctx as SimulationRunContext<unknown>
      return { status: 'done', recordsProcessed: 12, result }
    },
  }
}

const TRX = { trx: true }

function request(definition: SimulationKindDefinition) {
  return {
    definition,
    input: {},
    scope: SCOPE,
    requesterUserId: USER,
    artifactId: 'artifact-1',
    organizationIds: ['org-a'],
    hasFeatures: async () => true,
    resolve: createServiceResolver({ resolve: (name: string) => { if (name === 'known') return 'service'; throw new Error('missing') } }),
    now: () => 1_000,
  }
}

const runReadOnly = async <T,>(_em: unknown, run: (trx: never) => Promise<T>): Promise<T> => run(TRX as never)
const rootEm = { fork: () => rootEm }
const container = { resolve: () => undefined }

describe('inline simulation', () => {
  it('resolves services softly and reads the organization scope (D10)', () => {
    const resolve = createServiceResolver({ resolve: (name: string) => { if (name === 'known') return 'service'; throw new Error('missing') } })
    expect(resolve('known')).toBe('service')
    expect(resolve('unknown')).toBeUndefined()
    expect(simulationScopeOrganizationIds(null, 'org-run')).toEqual(['org-run'])
    expect(simulationScopeOrganizationIds({ allowedIds: null }, 'org-run')).toBeNull()
    expect(simulationScopeOrganizationIds({ allowedIds: ['ORG-A'] }, 'org-run')).toEqual(['org-a'])
    expect(simulationScopeOrganizationIds({ allowedIds: [] }, 'org-run')).toEqual([])
  })

  it('writes the access-log row or fails closed', async () => {
    const entry = { scope: SCOPE, actorUserId: USER, resourceKind: 'insights.simulation.permission_preview', resourceId: 'role-1', accessType: 'simulate', context: { kind: 'k' } }
    const log = jest.fn(async () => ({ id: 'row' }))
    await writeSimulationAccessLog(createServiceResolver({ resolve: () => ({ log }) }), entry)
    expect(log).toHaveBeenCalledWith({ tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, actorUserId: USER, resourceKind: entry.resourceKind, resourceId: 'role-1', accessType: 'simulate', context: { kind: 'k' } })
    await expect(writeSimulationAccessLog(createServiceResolver({ resolve: () => { throw new Error('none') } }), entry)).rejects.toBeInstanceOf(SimulationAccessLogUnavailableError)
    await expect(writeSimulationAccessLog(createServiceResolver({ resolve: () => ({ log: async () => null }) }), entry)).rejects.toBeInstanceOf(SimulationAccessLogUnavailableError)
    await expect(writeSimulationAccessLog(createServiceResolver({ resolve: () => ({ log: async () => { throw new Error('db') } }) }), entry)).rejects.toBeInstanceOf(SimulationAccessLogUnavailableError)
  })

  it('runs the kind\'s single slice in the read-only transaction with the inline context, then k-suppresses and sanitizes the result', async () => {
    const captured: { ctx?: SimulationRunContext<unknown> } = {}
    const definition = kindReturning({
      groups: [
        { key: 'big', cells: [{ key: 'gains', count: 25 }, { key: 'loses', count: 3 }] },
        { key: 'small', cells: [{ key: 'gains', count: 2 }] },
      ],
      coverage: {},
      caveats: ['test_module.caveat', 'not a key!'],
      fidelity: 'observed',
      truncated: false,
      summary: { warnings: ['test_module.warning'], counts: { pages_lost: 2, bad: -1 }, lists: { features_lost: ['sales.orders.view', '<script>'] } },
    }, captured)
    const outcome = await runInlineSimulation(container, rootEm as never, request(definition), { runReadOnly })
    expect(captured.ctx?.em).toBe(TRX)
    expect(captured.ctx?.inline?.organizationIds).toEqual(['org-a'])
    expect(captured.ctx?.inline?.resolve('known')).toBe('service')
    expect(captured.ctx?.requesterUserId).toBe(USER)
    expect(captured.ctx?.window).toEqual({ from: new Date(1_000), to: new Date(1_000) })
    expect(outcome.stored.k).toBe(10)
    expect(outcome.stored.groups[0]).toEqual(expect.objectContaining({ key: 'big', total: 28, suppressed: false }))
    expect(outcome.stored.groups[0].cells.map((cell) => [cell.key, cell.count, cell.suppressed])).toEqual([['gains', null, 'complementary'], ['loses', null, 'below_k']])
    expect(outcome.stored.groups[1]).toEqual(expect.objectContaining({ key: 'small', total: null, suppressed: true }))
    expect(outcome.stored.summary).toEqual({ warnings: ['test_module.warning'], counts: { pages_lost: 2 }, lists: { features_lost: ['sales.orders.view'] } })
    expect(outcome.caveats).toEqual(['test_module.caveat'])
    expect(outcome.coverage).toEqual({})
    expect(outcome.recordsProcessed).toBe(12)
  })

  it('hides non-empty coverage when a group is suppressed, like a queued completion', async () => {
    const outcome = await runInlineSimulation(container, rootEm as never, request(kindReturning({
      groups: [{ key: 'small', cells: [{ key: 'gains', count: 2 }] }],
      coverage: { principals: 2 },
      caveats: [],
      fidelity: 'observed',
      truncated: true,
    })), { runReadOnly })
    expect(outcome.coverage).toEqual({})
    expect(outcome.caveats).toEqual([SIMULATION_COVERAGE_HIDDEN_CAVEAT])
    expect(outcome.stored.truncated).toBe(true)
    expect(outcome.stored).not.toHaveProperty('summary')
  })

  it('refuses a kind that does not finish in one slice', async () => {
    const definition = { ...kindReturning({ groups: [], coverage: {}, caveats: [], fidelity: 'none', truncated: false }), run: async () => ({ status: 'continue' as const, state: {}, recordsProcessed: 0 }) }
    await expect(runInlineSimulation(container, rootEm as never, request(definition as SimulationKindDefinition), { runReadOnly })).rejects.toBeInstanceOf(SimulationInlineRunError)
  })

  it('stores only well-formed summary facts', () => {
    expect(sanitizeSimulationSummary(null)).toBeNull()
    expect(sanitizeSimulationSummary({ warnings: [], counts: {}, lists: {} })).toBeNull()
    expect(sanitizeSimulationSummary({ warnings: ['ok.key', 'Bad Key'], counts: { a_b: 1.7, 'Bad-Key': 2 }, lists: { x: ['a.b', 'a b'], 'Y Z': ['c'] } }))
      .toEqual({ warnings: ['ok.key'], counts: { a_b: 1 }, lists: { x: ['a.b'] } })
  })
})
