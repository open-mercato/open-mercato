/**
 * The COMPLETION half of the external runtime (external-agent-invocation design
 * §5.2/§5.5; tracker task 2.4) — what happens when the provider finally answers.
 *
 * What is load-bearing here:
 *
 * 1. **Exactly once.** A provider that redelivers its webhook must not resume the
 *    parked workflow step a second time. The conditional `pending → terminal`
 *    claim is what decides that, and the duplicate-delivery test below is the most
 *    important assertion in the task: a second resume advances a run past a step
 *    it already left, which is silent, unrecoverable corruption of a live process.
 * 2. **Prove it, then screen it.** A third party's answer is validated against the
 *    agent's declared OUTCOME envelope and screened by the same output guardrail
 *    the native runner applies to model output — with the guardrail audit rows
 *    persisted BEFORE the run is allowed to fail.
 * 3. **The right handle.** A settled researcher answer resumes down `researcher`;
 *    a guardrail block down `guardrailBlocked`; everything else down `error`.
 * 4. **A resume failure never rewrites history.** The run completed; if the signal
 *    cannot be delivered the run stays terminal and the step is left parked for an
 *    operator, never re-failed.
 * 5. **Tenancy.** A callback can never settle another tenant's run.
 */

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

const claimExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const settleExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()
/**
 * The stand-in for the `agent_external_runs` row's OWN copy of the mapping. It is
 * a separate mock from anything the caller passes, so the tests can prove the
 * resume reads the PERSISTED column rather than something handed to it in memory —
 * which is the only version a real callback, arriving in another process minutes
 * later, ever has.
 */
const readExternalRunOutputMappingMock = jest.fn<
  Promise<Record<string, string> | null>,
  unknown[]
>()
jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    shapeResult: actual.shapeResult,
    claimExternalRunRow: (...args: unknown[]) => claimExternalRunRowMock(...args),
    settleExternalRunRow: (...args: unknown[]) => settleExternalRunRowMock(...args),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    readExternalRunOutputMapping: (...args: unknown[]) =>
      readExternalRunOutputMappingMock(...args),
  }
})

type StubVerdict = {
  result: 'pass' | 'warn' | 'block'
  checks: unknown[]
  blockedReason?: { phase: string; kind: string }
}
const checkOutputMock = jest.fn<Promise<StubVerdict>, unknown[]>()
const persistVerdictMock = jest.fn<Promise<unknown[]>, unknown[]>()
jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: (...args: unknown[]) => persistVerdictMock(...args),
  GuardrailService: class {
    checkOutput(...args: unknown[]) {
      return checkOutputMock(...args)
    }
  },
}))

const sendSignalMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('@open-mercato/core/modules/workflows/lib/signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(...args),
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { WORKFLOW_ERROR_CONTEXT_KEY } from '@open-mercato/core/modules/workflows/lib/error-routing'
import { WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY } from '@open-mercato/core/modules/workflows/lib/outcome-routing'
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
  type CompleteExternalRunArgs,
  type ExternalRunCorrelation,
} from '../lib/runtime/completeExternalRun'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({ reached: z.boolean(), transcript: z.string() }),
})

const entry: AgentRegistryEntry = {
  id: 'voice.owner_call',
  moduleId: 'voice_agents',
  resultKind: 'researcher',
  schema: outcomeEnvelope,
  tools: [],
  skills: [],
  subAgents: [],
  label: 'Call the business owner',
  description: 'Places an outbound voice call and reports what was said.',
  instructions: '',
  runtime: 'external',
  connectorId: 'test.voice',
  callbackTimeoutMs: 30 * 60 * 1000,
}

const validPayload = { kind: 'researcher', data: { reached: true, transcript: 'yes, ship it' } }

function parkedRow(overrides: Partial<ExternalRunCorrelation> = {}): ExternalRunCorrelation {
  return {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    agentId: entry.id,
    connectorId: 'test.voice',
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: EXTERNAL_RUN_RESUME_SIGNAL,
    ...overrides,
  }
}

function makeContainer(): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
}

function settleWith(
  overrides: Partial<CompleteExternalRunArgs> = {},
): Promise<Awaited<ReturnType<typeof completeExternalRun>>> {
  return completeExternalRun({
    container: makeContainer(),
    commandBus: {} as CommandBus,
    entry,
    row: parkedRow(),
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    settlement: { kind: 'result', payload: validPayload },
    ...overrides,
  })
}

/** The `sendSignal` options of the Nth delivery, typed for assertion. */
function signalOptions(call = 0): {
  instanceId: string
  signalName: string
  agentOutcome: string
  payload: Record<string, unknown>
  tenantId: string
  organizationId: string
} {
  return sendSignalMock.mock.calls[call][2] as ReturnType<typeof signalOptions>
}

beforeEach(() => {
  claimExternalRunRowMock.mockReset().mockResolvedValue(true)
  settleExternalRunRowMock.mockReset().mockResolvedValue(true)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  persistVerdictMock.mockReset().mockResolvedValue([])
  checkOutputMock.mockReset().mockResolvedValue({ result: 'pass', checks: [] })
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  // The default is a row with no mapping — every pre-T2.11 expectation in this
  // file therefore asserts the unchanged legacy behaviour.
  readExternalRunOutputMappingMock.mockReset().mockResolvedValue(null)
})

describe('a provider answering with a valid result', () => {
  it('claims the row, screens the payload, completes the run and resumes down the researcher handle', async () => {
    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', runId: RUN_ID, outcomeHandle: 'researcher', resume: 'sent' })

    // The claim is scoped and moves the row out of `pending` before anything else
    // happens — that transition is what makes the whole settlement single-shot.
    expect(claimExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect(claimExternalRunRowMock.mock.calls[0][2]).toEqual({
      externalRunRowId: ROW_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      status: 'completed',
    })

    // The payload is screened against the agent's declared envelope, not trusted.
    const checkArgs = checkOutputMock.mock.calls[0][0] as { capability: string; output: unknown }
    expect(checkArgs.capability).toBe(entry.id)
    expect(checkArgs.output).toEqual(validPayload)
    expect(persistVerdictMock).toHaveBeenCalledTimes(1)

    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(completeRunMock.mock.calls[0][2]).toMatchObject({
      runId: RUN_ID,
      resultKind: 'researcher',
      output: { kind: 'researcher', data: validPayload.data },
    })
    expect(failRunMock).not.toHaveBeenCalled()

    // The row records what came back.
    expect(settleExternalRunRowMock.mock.calls[0][2]).toEqual({
      externalRunRowId: ROW_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      status: 'completed',
      resultPayload: validPayload,
    })

    // The parked step is woken exactly once, down the researcher handle, with the
    // legacy fixed-key payload core's own activity worker writes.
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const options = signalOptions()
    expect(options.instanceId).toBe(PROCESS_ID)
    expect(options.signalName).toBe(EXTERNAL_RUN_RESUME_SIGNAL)
    expect(options.agentOutcome).toBe('researcher')
    expect(options.tenantId).toBe(TENANT_ID)
    expect(options.organizationId).toBe(ORGANIZATION_ID)
    expect(options.payload).toEqual({
      disposition: 'researcher',
      agentId: entry.id,
      call_owner_agent: validPayload.data,
    })
  })
})

/**
 * T2.11 — the driving use case. The voice node declares
 * `outputMapping: { call: 'data.collected.owner_decision' }` so the NEXT agent in
 * the graph reads `{{context.call}}`. Without this the author is stuck with
 * `{{context.<stepId>_agent}}`, which the Studio ledger can only type `unknown`.
 */
describe('an external answer with a declared outputMapping', () => {
  it('lands the mapped context keys, resolving data.* against the researcher envelope', async () => {
    readExternalRunOutputMappingMock.mockResolvedValue({
      call: 'data.transcript',
      reached: 'data.reached',
      who: 'agentId',
      how: 'disposition',
    })

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', outcomeHandle: 'researcher', resume: 'sent' })
    // `data.*` resolves exactly as it does for a NATIVE researcher agent — the
    // envelope is `{ kind: 'researcher', data: <outcome> }` either way — and
    // `disposition` is synthesised from `kind` by core's own mapper.
    expect(signalOptions().payload).toEqual({
      call: 'yes, ship it',
      reached: true,
      who: entry.id,
      how: 'researcher',
    })
    // The legacy keys are GONE: an author who declared a mapping asked for those
    // keys and only those, exactly as on core's in-process path.
    expect(signalOptions().payload).not.toHaveProperty('call_owner_agent')
    // Routing is unaffected — the handle is decided by the outcome, never by what
    // the mapping happens to write into context.
    expect(signalOptions().agentOutcome).toBe('researcher')
  })

  it('reads the mapping from the PERSISTED row, scoped, not from anything the caller held', async () => {
    readExternalRunOutputMappingMock.mockResolvedValue({ call: 'data.transcript' })

    await settleWith()

    expect(readExternalRunOutputMappingMock).toHaveBeenCalledTimes(1)
    expect(readExternalRunOutputMappingMock.mock.calls[0][1]).toEqual({
      externalRunRowId: ROW_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
    expect(signalOptions().payload).toEqual({ call: 'yes, ship it' })
  })

  it('drops a target whose source path does not resolve instead of writing undefined', async () => {
    readExternalRunOutputMappingMock.mockResolvedValue({
      call: 'data.transcript',
      // Researcher answers carry no proposal, so this cannot resolve — the same
      // answer core gives for a native researcher agent.
      decision: 'proposalPayload.decision',
      missing: 'data.nope',
    })

    await settleWith()

    expect(signalOptions().payload).toEqual({ call: 'yes, ship it' })
    expect(Object.keys(signalOptions().payload)).toEqual(['call'])
  })

  it('writes only the mapped keys when a declared mapping resolves nothing at all', async () => {
    // Core's `mappedPayload ?? legacy` keeps an EMPTY mapped object rather than
    // falling back, so both paths answer the same definition the same way.
    readExternalRunOutputMappingMock.mockResolvedValue({ decision: 'proposalPayload.decision' })

    await settleWith()

    expect(signalOptions().payload).toEqual({})
  })

  it('BC: a row with no mapping resumes with the byte-identical legacy fixed keys', async () => {
    readExternalRunOutputMappingMock.mockResolvedValue(null)

    await settleWith()

    expect(signalOptions().payload).toEqual({
      disposition: 'researcher',
      agentId: entry.id,
      call_owner_agent: validPayload.data,
    })
  })

  it('BC: a caller that already knows there is no mapping skips the read entirely', async () => {
    await settleWith({ row: parkedRow({ outputMapping: null }) })

    expect(readExternalRunOutputMappingMock).not.toHaveBeenCalled()
    expect(signalOptions().payload).toEqual({
      disposition: 'researcher',
      agentId: entry.id,
      call_owner_agent: validPayload.data,
    })
  })

})

/**
 * A mapping must not be able to swallow the information the failure handles route
 * on. Core keeps the same separation: `resumeInvokeAgentWithError` and
 * `…WithGuardrailBlock` never consult `outputMapping`.
 */
describe('the failure arms with a mapping declared', () => {
  beforeEach(() => {
    readExternalRunOutputMappingMock.mockResolvedValue({ call: 'data.transcript' })
  })

  it('keeps the __error entry for a schema-invalid payload', async () => {
    const settled = await settleWith({
      settlement: { kind: 'result', payload: { kind: 'researcher', data: { reached: 'maybe' } } },
    })

    expect(settled).toMatchObject({ status: 'failed', cause: 'schema_invalid', outcomeHandle: 'error' })
    expect(signalOptions().payload).toHaveProperty(WORKFLOW_ERROR_CONTEXT_KEY)
    expect(signalOptions().payload.agentId).toBe(entry.id)
    expect(signalOptions().payload).not.toHaveProperty('call')
    // The mapping is never even looked up on a failure arm.
    expect(readExternalRunOutputMappingMock).not.toHaveBeenCalled()
  })

  it('keeps the guardrail classification for a blocked answer', async () => {
    checkOutputMock.mockResolvedValue({
      result: 'block',
      checks: [],
      blockedReason: { phase: 'output', kind: 'tool_scope' },
    })

    await settleWith()

    expect(signalOptions().agentOutcome).toBe('guardrailBlocked')
    expect(signalOptions().payload).toHaveProperty(WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY)
    expect(signalOptions().payload).not.toHaveProperty('call')
  })

  it('keeps the __error entry for a connector-reported failure', async () => {
    await settleWith({ settlement: { kind: 'failure', reason: 'the number rang out' } })

    expect(signalOptions().payload).toHaveProperty(WORKFLOW_ERROR_CONTEXT_KEY)
    expect(signalOptions().payload).not.toHaveProperty('call')
  })

  it('keeps the __error entry when the deadline sweep expires the run', async () => {
    await settleWith({ settlement: { kind: 'expired', reason: 'nobody answered' } })

    expect(signalOptions().agentOutcome).toBe('error')
    expect(signalOptions().payload).toHaveProperty(WORKFLOW_ERROR_CONTEXT_KEY)
    expect(signalOptions().payload).not.toHaveProperty('call')
  })
})

describe('a redelivered callback', () => {
  it('claims nothing, settles nothing and — critically — does NOT resume the step twice', async () => {
    const first = await settleWith()
    expect(first.status).toBe('completed')
    expect(sendSignalMock).toHaveBeenCalledTimes(1)

    // The row is no longer `pending`, so the conditional update affects no rows.
    claimExternalRunRowMock.mockResolvedValue(false)
    const second = await settleWith()

    expect(second).toEqual({ status: 'already_settled', runId: RUN_ID })
    // Everything after the claim is skipped: the run is not completed a second
    // time, nothing is written to the row, and above all the parked step is not
    // advanced again.
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(settleExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
  })
})

describe('an answer the agent never promised', () => {
  it('fails the run and resumes down the ERROR handle for a schema-invalid payload', async () => {
    const settled = await settleWith({
      settlement: { kind: 'result', payload: { kind: 'researcher', data: { reached: 'maybe' } } },
    })

    expect(settled).toMatchObject({ status: 'failed', cause: 'schema_invalid', outcomeHandle: 'error', resume: 'sent' })
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as { runId: string }).runId).toBe(RUN_ID)

    // The row is corrected from the provisionally-claimed `completed` to `failed`.
    const settleInput = settleExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    expect(settleInput.status).toBe('failed')
    expect(String(settleInput.failureReason)).toContain('schema_invalid')

    expect(signalOptions().agentOutcome).toBe('error')
    expect(signalOptions().payload).toHaveProperty(WORKFLOW_ERROR_CONTEXT_KEY)
  })

  it('persists the guardrail verdict BEFORE failing, and resumes down the guardrailBlocked handle', async () => {
    checkOutputMock.mockResolvedValue({
      result: 'block',
      checks: [{ kind: 'tool_scope', result: 'block' }],
      blockedReason: { phase: 'output', kind: 'tool_scope' },
    })

    const settled = await settleWith()

    expect(settled).toMatchObject({
      status: 'failed',
      cause: 'guardrail_blocked',
      outcomeHandle: 'guardrailBlocked',
    })
    // The evidence that explains the failure is on record before the run fails.
    expect(persistVerdictMock).toHaveBeenCalledTimes(1)
    expect(persistVerdictMock.mock.invocationCallOrder[0]).toBeLessThan(
      failRunMock.mock.invocationCallOrder[0],
    )
    expect(completeRunMock).not.toHaveBeenCalled()

    expect(signalOptions().agentOutcome).toBe('guardrailBlocked')
    // Only the CLASSIFICATION travels into the run context — never the evidence
    // blob, which can quote the transcript verbatim.
    expect(signalOptions().payload[WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY]).toEqual({
      stepId: 'call_owner',
      phase: 'output',
      kind: 'tool_scope',
      guardrailSetVersion: 'test-version',
    })
  })

  it('fails down the error handle when the connector reports a failure', async () => {
    const settled = await settleWith({
      settlement: { kind: 'failure', reason: 'the number rang out' },
    })

    expect(settled).toMatchObject({ status: 'failed', cause: 'connector_failure', outcomeHandle: 'error' })
    // A reported failure has no payload to screen, so no guardrail runs at all.
    expect(checkOutputMock).not.toHaveBeenCalled()
    // The claim went straight to `failed` — there was never anything to complete.
    expect((claimExternalRunRowMock.mock.calls[0][2] as { status: string }).status).toBe('failed')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().agentOutcome).toBe('error')
  })
})

describe('a run with nothing parked behind it', () => {
  it('completes the run and resumes nothing', async () => {
    const settled = await settleWith({
      row: parkedRow({ processId: null, stepId: null, signalName: null }),
    })

    expect(settled).toMatchObject({ status: 'completed', resume: 'skipped' })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).not.toHaveBeenCalled()
  })
})

describe('a resume that cannot be delivered', () => {
  it('leaves the run COMPLETED and reports the failure rather than re-failing the run', async () => {
    sendSignalMock.mockRejectedValue(new Error('[internal] workflow instance is not paused'))

    const settled = await settleWith()

    // The provider answered and the answer was screened and recorded: the run
    // genuinely finished, and the audit row must keep saying so.
    expect(settled).toMatchObject({ status: 'completed', resume: 'failed' })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect((settleExternalRunRowMock.mock.calls[0][2] as { status: string }).status).toBe('completed')
  })
})

describe('tenancy', () => {
  it('refuses to settle a row scoped to another organization, touching nothing', async () => {
    const settled = await settleWith({
      scope: { tenantId: TENANT_ID, organizationId: OTHER_ORGANIZATION_ID },
    })

    expect(settled).toEqual({ status: 'scope_denied', runId: RUN_ID })
    // Refused BEFORE the claim, so a foreign caller cannot even observe whether
    // the row was still pending.
    expect(claimExternalRunRowMock).not.toHaveBeenCalled()
    expect(checkOutputMock).not.toHaveBeenCalled()
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(failRunMock).not.toHaveBeenCalled()
    expect(settleExternalRunRowMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('refuses a row belonging to another tenant', async () => {
    const settled = await settleWith({
      scope: { tenantId: OTHER_ORGANIZATION_ID, organizationId: ORGANIZATION_ID },
    })

    expect(settled).toEqual({ status: 'scope_denied', runId: RUN_ID })
    expect(claimExternalRunRowMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })
})
