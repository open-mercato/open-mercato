/**
 * The platform wiring behind the `external` runtime (external-agent-invocation
 * design §3 rule 2 + risk R6; tracker task 2.8): the default-off ACL feature that
 * gates outbound contact, and the lifecycle events that make an external run
 * observable.
 *
 * What is load-bearing here:
 *
 * 1. **The gate is real.** A feature that is declared and never checked is worse
 *    than none — it reads like protection in an audit and provides none. So the
 *    tests exercise the enforcement point (`ExternalAgentRunner`) and prove the
 *    connector is never reached, rather than asserting the feature exists.
 * 2. **Default-off is a property of `setup.ts`, not a comment.** The feature must
 *    reach NO stock persona: only the `agent_orchestrator.*` wildcard covers it.
 * 3. **Events carry ids, and nothing else.** These payloads are persisted. An
 *    external run's data is a brief naming a phone number, a transcript of what a
 *    human said, and a bearer token; none of it may travel on an event.
 * 4. **Announcements never break the thing they announce.** A failing event bus
 *    must not fail a run whose call is already live, nor unwind a settlement that
 *    cannot be replayed.
 */

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

/**
 * The event bus itself is mocked, NOT `lib/runtime/externalRunEvents`. The payload
 * discipline is the subject of half this file, so the real emitter must run and be
 * observed at the boundary it actually crosses.
 */
const emitEventMock = jest.fn<Promise<void>, [string, Record<string, unknown>, unknown]>()
jest.mock('../events', () => {
  // The real declarations are the subject of half this file, so only the emit
  // FUNCTION is replaced — `eventsConfig` and the id union stay genuine.
  const actual = jest.requireActual('../events')
  return {
    ...actual,
    emitAgentOrchestratorEvent: (...args: [string, Record<string, unknown>, unknown]) =>
      emitEventMock(...args),
  }
})

const resolveCallerAclMock = jest.fn<Promise<{ features: string[]; isSuperAdmin: boolean }>, unknown[]>()
const createRunMock = jest.fn<Promise<string>, unknown[]>()
const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()
const createExternalRunRowMock = jest.fn<Promise<string>, unknown[]>()
const claimExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const settleExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    buildCommandContext: () => ({}),
    shapeResult: actual.shapeResult,
    resolveCallerAcl: (...args: unknown[]) => resolveCallerAclMock(...args),
    createRun: (...args: unknown[]) => createRunMock(...args),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    createExternalRunRow: (...args: unknown[]) => createExternalRunRowMock(...args),
    claimExternalRunRow: (...args: unknown[]) => claimExternalRunRowMock(...args),
    settleExternalRunRow: (...args: unknown[]) => settleExternalRunRowMock(...args),
    // These runs declare no outputMapping (T2.11), so the resume writes the
    // legacy fixed keys — which is what every payload assertion here expects.
    readExternalRunOutputMapping: async () => null,
    createProposal: jest.fn(async () => undefined),
  }
})

const enqueueDeadlineSweepMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/externalRunSweep', () => ({
  enqueueExternalRunDeadlineSweep: (...args: unknown[]) => enqueueDeadlineSweepMock(...args),
}))

const checkOutputMock = jest.fn(async () => ({ result: 'pass' as const, checks: [] as unknown[] }))
jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => []),
  GuardrailService: class {
    async checkInput() {
      return { result: 'pass', checks: [] }
    }
    checkOutput() {
      return checkOutputMock()
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
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { features as aclFeatures } from '../acl'
import { setup } from '../setup'
import { eventsConfig, type AgentOrchestratorEventId } from '../events'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { ExternalAgentNotPermittedError } from '../lib/runtime/errors'
import { EXTERNAL_AGENT_INVOKE_FEATURE } from '../lib/runtime/externalAgentRunner'
import { EXTERNAL_RUN_EVENT_PAYLOAD_KEYS } from '../lib/runtime/externalRunEvents'
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
  type ExternalRunCorrelation,
} from '../lib/runtime/completeExternalRun'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorStartArgs,
} from '../lib/runtime/externalConnectorRegistry'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'

const CONNECTOR_ID = 'test.voice'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'

/**
 * The three things that must never appear in an event payload, spelled out as the
 * literal values the fixtures carry so the assertion is a substring search over the
 * serialized payload rather than a key check that a nested object could evade.
 */
const PHONE_NUMBER = '+48123456789'
const TRANSCRIPT = 'the owner said yes, ship it on Friday'
const CALLBACK_TOKEN_PATTERN = /^xrun_[0-9a-f]{64}$/

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({ reached: z.boolean(), transcript: z.string() }),
})

const externalEventIds = [
  'agent_orchestrator.external_run.started',
  'agent_orchestrator.external_run.completed',
  'agent_orchestrator.external_run.failed',
  'agent_orchestrator.external_run.expired',
] as const

function registerAgent(id: string, overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'voice_agents',
    resultKind: 'researcher',
    schema: outcomeEnvelope,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'External test agent',
    description: 'External researcher agent for wiring tests.',
    instructions: '',
    runtime: 'external',
    connectorId: CONNECTOR_ID,
    callbackTimeoutMs: 30 * 60 * 1000,
    ...overrides,
  }
  registerFileAgent(entry)
  return entry
}

let startArgs: ExternalAgentConnectorStartArgs[] = []

function stubConnector(overrides: Partial<ExternalAgentConnector> = {}): ExternalAgentConnector {
  return {
    id: CONNECTOR_ID,
    start: async (args) => {
      startArgs.push(args)
      return { externalRunId: 'conv-1', expectsCallback: true }
    },
    verifyCallback: () => true,
    normalize: (raw) => raw,
    ...overrides,
  }
}

function makeContainer(): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'openCodeClient') return {}
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
}

function makeService(): AgentRuntimeService {
  return new AgentRuntimeService({ container: makeContainer(), commandBus: {} as never })
}

function parkedRow(overrides: Partial<ExternalRunCorrelation> = {}): ExternalRunCorrelation {
  return {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    agentId: 'voice.settled',
    connectorId: CONNECTOR_ID,
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: EXTERNAL_RUN_RESUME_SIGNAL,
    ...overrides,
  }
}

/** The (eventId, payload) pair of the Nth emission, typed for assertion. */
function emitted(call = 0): { id: string; payload: Record<string, unknown> } {
  const [id, payload] = emitEventMock.mock.calls[call]
  return { id, payload }
}

const runCtx = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, userId: 'user-1' }
const workflowRunCtx = { ...runCtx, processId: PROCESS_ID, stepId: 'call_owner' }
const brief = { phone: PHONE_NUMBER, brief: 'the deal is at risk' }

async function captureRejection<T>(promise: Promise<unknown>): Promise<T> {
  let rejection: unknown
  let rejected = false
  await promise.then(
    () => undefined,
    (err: unknown) => {
      rejection = err
      rejected = true
    },
  )
  if (!rejected) throw new Error('[internal] expected the call to reject, but it resolved')
  return rejection as T
}

beforeEach(() => {
  startArgs = []
  clearExternalAgentConnectorsForTests()
  emitEventMock.mockReset().mockResolvedValue(undefined)
  resolveCallerAclMock
    .mockReset()
    .mockResolvedValue({ features: [EXTERNAL_AGENT_INVOKE_FEATURE], isSuperAdmin: false })
  createRunMock.mockReset().mockResolvedValue(RUN_ID)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  createExternalRunRowMock.mockReset().mockResolvedValue(ROW_ID)
  claimExternalRunRowMock.mockReset().mockResolvedValue(true)
  settleExternalRunRowMock.mockReset().mockResolvedValue(true)
  enqueueDeadlineSweepMock.mockReset().mockResolvedValue(undefined)
  checkOutputMock.mockReset().mockResolvedValue({ result: 'pass', checks: [] })
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  process.env.APP_URL = 'https://app.example.com'
})

afterEach(() => {
  resetAgentAdmissionForTests()
  delete process.env.APP_URL
})

describe('the outbound-contact ACL feature', () => {
  it('is declared in acl.ts under the id the runner enforces', () => {
    const declared = aclFeatures.find((feature) => feature.id === EXTERNAL_AGENT_INVOKE_FEATURE)
    expect(declared).toBeDefined()
    expect(declared?.module).toBe('agent_orchestrator')
    // The constant and the declaration are in different files on purpose (acl.ts
    // stays dependency-free for the generators); nothing but this test keeps them
    // in step, and a drift would silently disable the gate.
    expect(EXTERNAL_AGENT_INVOKE_FEATURE).toBe('agent_orchestrator.external_agents.invoke')
  })

  it('declares a dependsOn that resolves to another declared feature', () => {
    const declared = aclFeatures.find((feature) => feature.id === EXTERNAL_AGENT_INVOKE_FEATURE)
    const known = new Set(aclFeatures.map((feature) => feature.id))
    for (const dependency of declared?.dependsOn ?? []) {
      expect(known.has(dependency)).toBe(true)
    }
  })

  it('is DEFAULT-OFF: covered only by the admin wildcard, never by a stock persona', () => {
    const roleGrants = setup.defaultRoleFeatures ?? {}

    // The `web_search` precedent, asserted rather than trusted: no narrow persona
    // list may name it, and no narrow persona's wildcard may cover it either.
    for (const [role, grants] of Object.entries(roleGrants)) {
      if (role === 'superadmin' || role === 'admin') continue
      const covered = (grants ?? []).some((granted) =>
        matchFeature(EXTERNAL_AGENT_INVOKE_FEATURE, granted),
      )
      expect({ role, covered }).toEqual({ role, covered: false })
    }

    // …and the module-wide invariant still holds: every declared feature reaches at
    // least one role, which for this one is the admin wildcard alone.
    const allGranted = Object.values(roleGrants).flatMap((grants) => grants ?? [])
    expect(
      allGranted.some((granted) => matchFeature(EXTERNAL_AGENT_INVOKE_FEATURE, granted)),
    ).toBe(true)
  })
})

describe('enforcing outbound contact at the runner', () => {
  it('REFUSES a principal without the feature — before any row exists and without dialling', async () => {
    registerAgent('voice.denied')
    registerExternalAgentConnector(stubConnector())
    resolveCallerAclMock.mockResolvedValue({
      features: ['agent_orchestrator.agents.run', 'agent_orchestrator.agents.view'],
      isSuperAdmin: false,
    })

    const error = await captureRejection<ExternalAgentNotPermittedError>(
      makeService().runOrSuspend('voice.denied', brief, workflowRunCtx),
    )

    expect(error).toBeInstanceOf(ExternalAgentNotPermittedError)
    expect(error.requiredFeature).toBe(EXTERNAL_AGENT_INVOKE_FEATURE)
    // Deterministic: a retry cannot make a missing grant present, and a retried
    // external run is a second real phone call.
    expect(error.retryable).toBe(false)

    // Nothing was attempted, so nothing exists: no audit row, no correlation row,
    // no deadline job — and above all the connector never dialled.
    expect(startArgs).toHaveLength(0)
    expect(createRunMock).not.toHaveBeenCalled()
    expect(createExternalRunRowMock).not.toHaveBeenCalled()
    expect(enqueueDeadlineSweepMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('scopes the ACL lookup to the run tenancy', async () => {
    registerAgent('voice.acl_scope')
    registerExternalAgentConnector(stubConnector())

    await makeService().runOrSuspend('voice.acl_scope', brief, workflowRunCtx)

    expect(resolveCallerAclMock).toHaveBeenCalledTimes(1)
    expect(resolveCallerAclMock.mock.calls[0][1]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      userId: 'user-1',
    })
  })

  it('accepts the exact grant, a module wildcard, and a superadmin', async () => {
    registerExternalAgentConnector(stubConnector())

    const grants = [
      { features: [EXTERNAL_AGENT_INVOKE_FEATURE], isSuperAdmin: false },
      { features: ['agent_orchestrator.*'], isSuperAdmin: false },
      { features: ['*'], isSuperAdmin: false },
      { features: [], isSuperAdmin: true },
    ]
    for (let index = 0; index < grants.length; index += 1) {
      resolveCallerAclMock.mockResolvedValue(grants[index])
      const agentId = `voice.allowed_${index}`
      registerAgent(agentId)
      const outcome = await makeService().runOrSuspend(agentId, brief, runCtx)
      expect(outcome.kind).toBe('suspended')
    }
  })

  it('FAILS CLOSED when the ACL cannot be resolved at all', async () => {
    registerAgent('voice.acl_unavailable')
    registerExternalAgentConnector(stubConnector())
    // `resolveCallerAcl` swallows an unavailable RBAC service and answers with no
    // features. The failure mode of a fail-OPEN gate here is an unauthorized call
    // to a real person, so the empty answer must deny.
    resolveCallerAclMock.mockResolvedValue({ features: [], isSuperAdmin: false })

    await expect(
      makeService().runOrSuspend('voice.acl_unavailable', brief, runCtx),
    ).rejects.toBeInstanceOf(ExternalAgentNotPermittedError)
    expect(startArgs).toHaveLength(0)
  })
})

describe('the external_run lifecycle events', () => {
  it('declares the four ids, module.entity.action, on the external_run entity', () => {
    for (const id of externalEventIds) {
      const declared = eventsConfig.events.find((event) => event.id === id)
      expect(declared).toBeDefined()
      expect(declared?.module).toBe('agent_orchestrator')
      expect(declared?.entity).toBe('external_run')
      expect(declared?.category).toBe('lifecycle')
      // `module.entity.action`: a singular entity and a past-tense action.
      expect(id).toMatch(/^agent_orchestrator\.external_run\.(started|completed|failed|expired)$/)
    }
  })

  it('keeps the ids OFF the ACL-blind client broadcast', () => {
    // The DOM Event Bridge forwards a broadcast frame to every backoffice
    // connection in the organization without evaluating features. A live feed of
    // who is being contacted would undo the default-off gate these tests assert
    // above, so none of the four may carry it.
    for (const id of externalEventIds) {
      const declared = eventsConfig.events.find((event) => event.id === id)
      expect(declared?.clientBroadcast).toBeFalsy()
    }
  })

  it('types the emitter with LITERAL ids, which is what `as const` buys', () => {
    const declared: AgentOrchestratorEventId = 'agent_orchestrator.external_run.started'
    expect(declared).toBe(externalEventIds[0])
    // Without `as const` on the events array, `id` widens to `string` and this
    // directive becomes unused — which typechecks as an error. The compile-time
    // half of this file is what actually asserts it.
    // @ts-expect-error — an undeclared id is not a member of the union
    const undeclaredId: AgentOrchestratorEventId = 'agent_orchestrator.external_run.answered'
    expect(undeclaredId).toBe('agent_orchestrator.external_run.answered')
  })
})

describe('what an external_run event carries', () => {
  it('announces a started run with ids only — no brief, no phone number, no token', async () => {
    registerAgent('voice.started_event')
    registerExternalAgentConnector(stubConnector())

    await makeService().runOrSuspend('voice.started_event', brief, workflowRunCtx)

    expect(emitEventMock).toHaveBeenCalledTimes(1)
    const { id, payload } = emitted()
    expect(id).toBe('agent_orchestrator.external_run.started')
    expect(payload).toEqual({
      externalRunRowId: ROW_ID,
      runId: RUN_ID,
      agentId: 'voice.started_event',
      connectorId: CONNECTOR_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      externalRunId: 'conv-1',
      processId: PROCESS_ID,
      stepId: 'call_owner',
    })
    // Persisted, so it is stored — and a stored payload is a stored disclosure.
    expect(emitEventMock.mock.calls[0][2]).toEqual({ persistent: true })

    // The brief we handed the provider carries the number that was dialled; the
    // token is the only credential on a public route. Neither may travel.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(PHONE_NUMBER)
    expect(serialized).not.toContain('the deal is at risk')
    expect(startArgs[0].callbackToken).toMatch(CALLBACK_TOKEN_PATTERN)
    expect(serialized).not.toContain(startArgs[0].callbackToken)
  })

  it('announces a completed run without the transcript it just settled', async () => {
    const entry = registerAgent('voice.settled')
    const payload = { kind: 'researcher', data: { reached: true, transcript: TRANSCRIPT } }

    await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: parkedRow(),
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      settlement: { kind: 'result', payload },
    })

    expect(emitEventMock).toHaveBeenCalledTimes(1)
    const announced = emitted()
    expect(announced.id).toBe('agent_orchestrator.external_run.completed')
    expect(announced.payload).toMatchObject({
      runId: RUN_ID,
      agentId: 'voice.settled',
      outcomeHandle: 'researcher',
      // Whether the parked step actually woke is the fact risk R2 is about.
      resume: 'sent',
    })
    expect(JSON.stringify(announced.payload)).not.toContain('ship it on Friday')
  })

  it('announces a failure with a CLASSIFIED cause, never the provider message', async () => {
    const entry = registerAgent('voice.settled')

    await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: parkedRow(),
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      // A real connector failure reason quotes what it was doing — here, the number.
      settlement: { kind: 'failure', reason: `the call to ${PHONE_NUMBER} was not answered` },
    })

    const announced = emitted()
    expect(announced.id).toBe('agent_orchestrator.external_run.failed')
    expect(announced.payload).toMatchObject({ cause: 'connector_failure', outcomeHandle: 'error' })
    expect(JSON.stringify(announced.payload)).not.toContain(PHONE_NUMBER)
  })

  it('announces an EXPIRED run under its own id, not as a generic failure', async () => {
    const entry = registerAgent('voice.settled')

    await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: parkedRow(),
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      settlement: { kind: 'expired', reason: 'no callback arrived before the deadline' },
    })

    const announced = emitted()
    // "Nobody answered" and "somebody answered badly" are different operational
    // facts; the row keeps them apart and so must the event.
    expect(announced.id).toBe('agent_orchestrator.external_run.expired')
    expect(announced.payload).toMatchObject({ cause: 'deadline_expired', outcomeHandle: 'error' })
  })

  it('never emits more keys than the declared payload contract, on any arm', async () => {
    const entry = registerAgent('voice.settled')
    const settlements = [
      { kind: 'result' as const, payload: { kind: 'researcher', data: { reached: true, transcript: TRANSCRIPT } } },
      { kind: 'failure' as const, reason: `the call to ${PHONE_NUMBER} failed` },
      { kind: 'expired' as const, reason: 'no callback arrived before the deadline' },
    ]

    for (const settlement of settlements) {
      await completeExternalRun({
        container: makeContainer(),
        commandBus: {} as CommandBus,
        entry,
        row: parkedRow(),
        scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
        settlement,
      })
    }

    expect(emitEventMock).toHaveBeenCalledTimes(settlements.length)
    const allowed = new Set<string>(EXTERNAL_RUN_EVENT_PAYLOAD_KEYS)
    for (let call = 0; call < settlements.length; call += 1) {
      for (const key of Object.keys(emitted(call).payload)) {
        expect({ call, key, allowed: allowed.has(key) }).toEqual({ call, key, allowed: true })
      }
    }
  })

  it('says nothing when a duplicate delivery claims nothing', async () => {
    const entry = registerAgent('voice.settled')
    claimExternalRunRowMock.mockResolvedValue(false)

    const settled = await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: parkedRow(),
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      settlement: { kind: 'result', payload: { kind: 'researcher', data: { reached: true, transcript: 'x' } } },
    })

    // Exactly-once settlement means exactly-once announcement: a redelivered
    // webhook that changed nothing must not tell subscribers anything happened.
    expect(settled.status).toBe('already_settled')
    expect(emitEventMock).not.toHaveBeenCalled()
  })
})

describe('an event bus that is broken', () => {
  it('does not fail a run whose call is already live', async () => {
    registerAgent('voice.emit_fails_on_start')
    registerExternalAgentConnector(stubConnector())
    emitEventMock.mockRejectedValue(new Error('event bus unavailable'))

    const outcome = await makeService().runOrSuspend('voice.emit_fails_on_start', brief, workflowRunCtx)

    // The provider has already dialled. Throwing here would fail a run whose side
    // effect is live in the world and would report a lie.
    expect(outcome).toEqual({ kind: 'suspended', runId: RUN_ID, externalRunId: 'conv-1' })
    expect(enqueueDeadlineSweepMock).toHaveBeenCalledTimes(1)
  })

  it('does not unwind a settlement that cannot be replayed', async () => {
    const entry = registerAgent('voice.settled')
    emitEventMock.mockRejectedValue(new Error('event bus unavailable'))

    const settled = await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: parkedRow(),
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      settlement: { kind: 'result', payload: { kind: 'researcher', data: { reached: true, transcript: 'x' } } },
    })

    // The row is claimed, so a retried delivery would report `already_settled`;
    // there is no second chance to settle, and the run genuinely completed.
    expect(settled).toMatchObject({ status: 'completed', runId: RUN_ID, resume: 'sent' })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
  })
})
