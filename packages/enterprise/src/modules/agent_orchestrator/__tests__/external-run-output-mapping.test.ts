/**
 * T2.11 — the outputMapping's FULL JOURNEY, start half to callback half.
 *
 * The other two suites each prove one end of it: `external-agent-runner.test.ts`
 * proves the mapping is written onto the correlation row, and
 * `external-run-completion.test.ts` proves the resume applies whatever mapping it
 * is given. Neither proves the two are the SAME mapping — and that is exactly the
 * property this task exists to establish, because on the external path there is no
 * queue job, no call stack and no process shared between the two halves. The only
 * thing that survives from the step that dialled to the callback that answers is
 * the row.
 *
 * So here the write and the read are wired to ONE store: `createExternalRunRow` is
 * stubbed to keep the row, `readExternalRunOutputMapping` is the REAL function
 * reading through a fake EntityManager backed by that same store, and the
 * correlation projection handed to `completeExternalRun` is built exactly the way
 * the callback route builds it — from identity columns only, carrying no mapping.
 * If the mapping stops travelling on the row, this test is the one that fails.
 */

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

type StoredExternalRunRow = {
  id: string
  tenantId: string
  organizationId: string
  runId: string
  agentId: string
  connectorId: string
  processId: string | null
  stepId: string | null
  signalName: string | null
  outputMapping: Record<string, string> | null
}

/** The stand-in for `agent_external_runs`. Written by one half, read by the other. */
const externalRunRows = new Map<string, StoredExternalRunRow>()
const ROW_ID = '66666666-6666-4666-8666-666666666666'

jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    ...actual,
    buildCommandContext: () => ({}),
    resolveCallerAcl: async () => ({
      features: ['agent_orchestrator.external_agents.invoke'],
      isSuperAdmin: false,
    }),
    createRun: async () => 'run-1',
    completeRun: async () => undefined,
    failRun: async () => undefined,
    createExternalRunRow: async (
      _bus: unknown,
      _ctx: unknown,
      input: Omit<StoredExternalRunRow, 'id'>,
    ) => {
      externalRunRows.set(ROW_ID, { id: ROW_ID, ...input })
      return ROW_ID
    },
    claimExternalRunRow: async () => true,
    settleExternalRunRow: async () => true,
    // NOT stubbed: the real reader is what this suite is about.
    readExternalRunOutputMapping: actual.readExternalRunOutputMapping,
  }
})

jest.mock('../lib/runtime/externalRunSweep', () => ({
  enqueueExternalRunDeadlineSweep: async () => undefined,
}))

jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => ({})),
  GuardrailService: class {
    async checkInput() {
      return { result: 'pass', checks: [] }
    }
    async checkOutput() {
      return { result: 'pass', checks: [] }
    }
  },
}))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: jest.fn(async () => null),
}))

const sendSignalMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('@open-mercato/core/modules/workflows/lib/signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(...args),
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
} from '../lib/runtime/externalConnectorRegistry'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { completeExternalRun } from '../lib/runtime/completeExternalRun'

const CONNECTOR_ID = 'test.voice'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const AGENT_ID = 'voice.journey_call'

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({
    reached: z.boolean(),
    collected: z.object({ owner_decision: z.string() }),
  }),
})

/**
 * A fake EntityManager over the row store. `findOne` ignores its projection — the
 * point here is that the value comes from the STORE the runner wrote to, not that
 * MikroORM builds the right SELECT.
 */
function makeContainer(): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') {
        return {
          fork: () => ({
            findOne: async (_entity: unknown, where: { id?: string }) =>
              externalRunRows.get(where?.id ?? '') ?? null,
          }),
        }
      }
      if (name === 'openCodeClient') return {}
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
}

function registerAgent(): AgentRegistryEntry {
  const existing = getAgentEntry(AGENT_ID)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id: AGENT_ID,
    moduleId: 'voice_agents',
    resultKind: 'researcher',
    schema: outcomeEnvelope,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Call the business owner',
    description: 'Places an outbound voice call and reports the decision.',
    instructions: '',
    runtime: 'external',
    connectorId: CONNECTOR_ID,
    callbackTimeoutMs: 30 * 60 * 1000,
  }
  registerFileAgent(entry)
  return entry
}

const answer = {
  kind: 'researcher' as const,
  data: { reached: true, collected: { owner_decision: 'approve the discount' } },
}

/**
 * Everything the provider's callback does after it has verified the signature and
 * found the row: build the correlation projection from the row's identity columns
 * — the shape the route builds, which carries no mapping — and settle.
 */
async function settleAsCallbackWould(container: AwilixContainer) {
  const row = externalRunRows.get(ROW_ID)!
  return completeExternalRun({
    container,
    commandBus: {} as CommandBus,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      runId: row.runId,
      agentId: row.agentId,
      connectorId: row.connectorId,
      processId: row.processId,
      stepId: row.stepId,
      signalName: row.signalName,
    },
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    settlement: { kind: 'result', payload: answer },
  })
}

async function dial(outputMapping?: Record<string, string>) {
  const container = makeContainer()
  const service = new AgentRuntimeService({ container, commandBus: {} as CommandBus })
  const outcome = await service.runOrSuspend(
    AGENT_ID,
    { brief: 'ask the owner about the discount' },
    {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      userId: 'user-1',
      processId: PROCESS_ID,
      stepId: 'call_owner',
      ...(outputMapping ? { outputMapping } : {}),
    },
  )
  expect(outcome.kind).toBe('suspended')
  return container
}

function resumePayload(): Record<string, unknown> {
  const options = sendSignalMock.mock.calls[0][2] as { payload: Record<string, unknown> }
  return options.payload
}

beforeEach(() => {
  externalRunRows.clear()
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  clearExternalAgentConnectorsForTests()
  registerExternalAgentConnector({
    id: CONNECTOR_ID,
    start: async () => ({ externalRunId: 'conv-1', expectsCallback: true }),
    verifyCallback: () => true,
    normalize: (raw) => raw,
  })
  registerAgent()
  process.env.APP_URL = 'https://app.example.com'
})

afterEach(() => {
  resetAgentAdmissionForTests()
  delete process.env.APP_URL
})

describe('the declared outputMapping travelling from the dialling step to the callback resume', () => {
  it('lands the author\'s context keys, read back from the persisted row', async () => {
    const container = await dial({ call: 'data.collected.owner_decision', reached: 'data.reached' })

    // It really is on the row, and the caller below never sees this object.
    expect(externalRunRows.get(ROW_ID)?.outputMapping).toEqual({
      call: 'data.collected.owner_decision',
      reached: 'data.reached',
    })

    const settled = await settleAsCallbackWould(container)

    expect(settled).toMatchObject({ status: 'completed', resume: 'sent' })
    // §1's driving graph: the next agent reads `{{context.call}}`.
    expect(resumePayload()).toEqual({ call: 'approve the discount', reached: true })
  })

  it('BC: a step declaring none resumes on the legacy fixed keys, unchanged', async () => {
    const container = await dial()

    expect(externalRunRows.get(ROW_ID)?.outputMapping).toBeNull()

    await settleAsCallbackWould(container)

    expect(resumePayload()).toEqual({
      disposition: 'researcher',
      agentId: AGENT_ID,
      call_owner_agent: answer.data,
    })
  })
})
