/**
 * @jest-environment node
 *
 * Differential parity of the trigger backtest with the production trigger runtime: the same event
 * sequences go through `processEventTriggers` (code-registry trigger, mocked `startWorkflow`, a
 * controlled clock and running-instance count) and through `evaluateTriggerEvent`. Whenever the
 * backtest claims an outcome (`would_start`, `debounced`, `would_not_start`) production must agree;
 * `cannot_tell` is allowed only where the backtest was missing an input (an unknown payload path, a
 * `maxConcurrentInstances` limit) or production's state depends on one.
 */
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})
jest.mock('../../workflow-executor', () => ({
  executeWorkflow: jest.fn().mockResolvedValue(undefined),
  startWorkflow: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/core'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { clearCodeWorkflowRegistry, registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { startWorkflow } from '../../workflow-executor'
import { invalidateTriggerCache, processEventTriggers, resetTriggerDebounceState } from '../../event-trigger-service'
import { workflowTriggerBacktestProposalSchema } from '../../../data/validators'
import { evaluateTriggerEvent, type TriggerBacktestCell, type TriggerDebounceState } from '../trigger-backtest'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const EVENT_NAME = 'customers.deal.updated'
const DEBOUNCE_MS = 5000
const SEQUENCES = 150
const EVENTS_PER_SEQUENCE = 40

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockStartWorkflow = startWorkflow as jest.MockedFunction<typeof startWorkflow>

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

type Scenario = {
  debounceMs: number
  maxConcurrentInstances: number | null
  filter: boolean
}

const SCENARIOS: Scenario[] = [
  { debounceMs: DEBOUNCE_MS, maxConcurrentInstances: null, filter: false },
  { debounceMs: DEBOUNCE_MS, maxConcurrentInstances: null, filter: true },
  { debounceMs: DEBOUNCE_MS, maxConcurrentInstances: 1, filter: true },
  { debounceMs: 0, maxConcurrentInstances: null, filter: true },
  { debounceMs: 0, maxConcurrentInstances: 1, filter: true },
]

function triggerOf(scenario: Scenario) {
  const config: Record<string, unknown> = {}
  if (scenario.debounceMs > 0) config.debounceMs = scenario.debounceMs
  if (scenario.maxConcurrentInstances) config.maxConcurrentInstances = scenario.maxConcurrentInstances
  if (scenario.filter) config.filterConditions = [{ field: 'amount', operator: 'gt', value: 100 }]
  return { triggerId: 'parity', name: 'Parity', eventPattern: 'customers.deal.*', enabled: true, priority: 0, config }
}

function codeWorkflow(scenario: Scenario): CodeWorkflowDefinition {
  return {
    workflowId: 'customers.parity',
    workflowName: 'Parity',
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'customers',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      triggers: [triggerOf(scenario)],
    } as CodeWorkflowDefinition['definition'],
  }
}

function fakeEntityManager(runningInstances: number): EntityManager {
  const em = { count: jest.fn().mockResolvedValue(runningInstances), fork: jest.fn(() => em) }
  return em as unknown as EntityManager
}

const ID_CHOICES: unknown[] = ['deal-1', 'deal-2', 'deal-3', 7, '7', undefined, null]

const STEP_CHOICES: number[] = [0, 1, 999, DEBOUNCE_MS - 1, DEBOUNCE_MS, DEBOUNCE_MS + 1, Math.floor(DEBOUNCE_MS / 2), Math.floor(DEBOUNCE_MS / 3)]

function productionCell(result: { triggered: number; skipped: number; errors: unknown[] }): TriggerBacktestCell {
  if (result.triggered > 0) return 'would_start'
  if (result.skipped > 0) return 'debounced'
  return 'would_not_start'
}

describe('trigger backtest vs processEventTriggers (differential)', () => {
  let currentTime = 0
  let nowSpy: jest.SpyInstance<number, []>

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime)
    mockFindWithDecryption.mockResolvedValue([] as never)
    mockStartWorkflow.mockImplementation(async () => ({ id: `instance-${currentTime}` }) as never)
  })

  afterEach(() => {
    nowSpy.mockRestore()
    clearCodeWorkflowRegistry()
    invalidateTriggerCache(TENANT, ORG)
    resetTriggerDebounceState()
    mockFindWithDecryption.mockReset()
    mockStartWorkflow.mockReset()
  })

  for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
    it(`never contradicts production (debounce ${scenario.debounceMs}, limit ${scenario.maxConcurrentInstances ?? 'none'}, filter ${scenario.filter})`, async () => {
      const proposalTrigger = workflowTriggerBacktestProposalSchema.parse({ workflowId: 'customers.parity', version: 1, triggers: [triggerOf(scenario)] }).triggers[0]
      const random = createRandom(1000 + scenarioIndex)
      let claims = 0
      let unknowns = 0
      for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
        clearCodeWorkflowRegistry()
        invalidateTriggerCache(TENANT, ORG)
        resetTriggerDebounceState()
        registerCodeWorkflowEntries([codeWorkflow(scenario)])
        const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
        currentTime = 1_700_000_000_000
        for (let step = 0; step < EVENTS_PER_SEQUENCE; step += 1) {
          currentTime += STEP_CHOICES[Math.floor(random() * STEP_CHOICES.length)]
          const id = ID_CHOICES[Math.floor(random() * ID_CHOICES.length)]
          const amount = random() < 0.5 ? 50 : 500
          const amountUnknown = random() < 0.2
          const idUnknown = random() < 0.1
          const runningInstances = random() < 0.5 ? 0 : 1
          const payload: Record<string, unknown> = { amount }
          if (id !== undefined) payload.id = id
          const production = await processEventTriggers(fakeEntityManager(runningInstances), { resolve: jest.fn() } as unknown as AwilixContainer, {
            eventName: EVENT_NAME,
            payload,
            tenantId: TENANT,
            organizationId: ORG,
          })
          const unknownPaths = [...(amountUnknown ? ['amount'] : []), ...(idUnknown ? ['id'] : [])]
          const simulatedPayload: Record<string, unknown> = { ...payload }
          for (const path of unknownPaths) delete simulatedPayload[path]
          const simulated = evaluateTriggerEvent({
            trigger: proposalTrigger,
            active: true,
            startCertain: !scenario.maxConcurrentInstances,
            windowsComplete: true,
            payload: simulatedPayload,
            unknownPaths,
            at: currentTime,
          }, debounce)
          if (simulated.cell === 'cannot_tell') {
            unknowns += 1
            continue
          }
          claims += 1
          expect({ sequence, step, cell: simulated.cell }).toEqual({ sequence, step, cell: productionCell(production) })
        }
      }
      expect(claims).toBeGreaterThan(0)
      if (scenario.maxConcurrentInstances || scenario.filter) expect(unknowns).toBeGreaterThan(0)
    })
  }
})
