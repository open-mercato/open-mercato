/**
 * Cost and duration on an external run's row (tracker task 3.2, design §7 R8).
 *
 * A voice call costs real money and takes real time, and before this the run row
 * could report neither: `modelPricing` prices LLM tokens and a phone call has
 * none, so every external run rendered `—` for cost and `—` for latency forever.
 *
 * What must hold, in order of how badly getting it wrong would hurt:
 *
 * 1. **Tokens stay null.** There is no honest token count for a conversation, and
 *    a synthesised one would land in the same columns `metricRollupService` and
 *    the agents cockpit average across an agent's runs. The type makes it
 *    unreachable; these tests prove it at the call site.
 * 2. **Absent is null, never 0.** A connector reporting no cost leaves the column
 *    untouched, so the cockpit renders `—` rather than "free". A connector
 *    reporting `0` — free minutes — keeps its zero, which is a different fact.
 * 3. **`latency_ms` is the PROVIDER'S WORK INTERVAL, not the wall clock.** See
 *    `EXTERNAL_RUN_LATENCY_SEMANTICS`. The wall clock stays derivable from the
 *    run row's own `created_at`/`completed_at`, which is why no second column
 *    exists.
 * 4. **A bad report can never break a settlement.** The stamp is applied inside
 *    the audited command that CLOSES the run; a value that command's zod would
 *    reject would throw AFTER the provider answered and after the correlation row
 *    was claimed, which 500s the callback and strands the parked step (T3.1's
 *    finding). So every reportable value is screened against the same rules
 *    first, and anything else degrades to no stamp.
 * 5. **Nothing sensitive is logged**, including on the arms that reject a report.
 * 6. **A simulated run is not stamped**, because a would-do costs nothing and
 *    lasted no time.
 */

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

const claimExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const settleExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()
const readExternalRunOutputMappingMock = jest.fn<Promise<Record<string, string> | null>, unknown[]>()
// A PARTIAL mock of this module silently turns any export it omits into
// `undefined`, which surfaces far away as `resume: 'failed'` — the recurring
// hazard in the tracker's notes log. Every export the completion path uses is
// listed on purpose.
jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    shapeResult: actual.shapeResult,
    claimExternalRunRow: (...args: unknown[]) => claimExternalRunRowMock(...args),
    settleExternalRunRow: (...args: unknown[]) => settleExternalRunRowMock(...args),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    readExternalRunOutputMapping: (...args: unknown[]) => readExternalRunOutputMappingMock(...args),
  }
})

const captureExternalRunTranscriptMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/runtime/externalRunArtifacts', () => ({
  captureExternalRunTranscript: (...args: unknown[]) => captureExternalRunTranscriptMock(...args),
}))

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
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
  type CompleteExternalRunArgs,
  type ExternalRunCorrelation,
} from '../lib/runtime/completeExternalRun'
import {
  EXTERNAL_RUN_USAGE_KEY,
  readExternalRunUsageReport,
  separateExternalRunUsage,
} from '../lib/runtime/externalRunUsage'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { captureLogs, type CapturedLogs } from './support/captureLogs'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'

/** The two things that must never reach a log line: what was said, and who was dialled. */
const SPOKEN_WORDS = 'yes, ship it — call me back on my mobile'
const DIALLED_NUMBER = '+48555111222'

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({
    reached: z.boolean(),
    transcript: z.string(),
    calledNumber: z.string(),
  }),
})

/**
 * The same contract declared `.strict()`.
 *
 * This is the case that decides whether the reserved key had to be STRIPPED
 * rather than merely tolerated: an author is entitled to write a strict envelope,
 * and a connector reporting its cost must not turn that author's runs into
 * schema-invalid failures.
 */
const strictOutcomeEnvelope = z
  .object({
    kind: z.literal('researcher'),
    data: z.object({
      reached: z.boolean(),
      transcript: z.string(),
      calledNumber: z.string(),
    }),
  })
  .strict()

function makeEntry(schema: z.ZodTypeAny = outcomeEnvelope): AgentRegistryEntry {
  return {
    id: 'voice.owner_call',
    moduleId: 'voice_agents',
    resultKind: 'researcher',
    schema,
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
}

const answer = { reached: true, transcript: SPOKEN_WORDS, calledNumber: DIALLED_NUMBER }

/** A 74-second call that cost 19 cents — what the ElevenLabs connector reports. */
const REPORTED_USAGE = { costMinor: 19, currency: 'USD', durationMs: 74_000 }

function payloadWith(usage?: unknown): unknown {
  return {
    kind: 'researcher',
    data: answer,
    ...(usage === undefined ? {} : { [EXTERNAL_RUN_USAGE_KEY]: usage }),
  }
}

function parkedRow(overrides: Partial<ExternalRunCorrelation> = {}): ExternalRunCorrelation {
  return {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    agentId: 'voice.owner_call',
    connectorId: 'test.voice',
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: EXTERNAL_RUN_RESUME_SIGNAL,
    outputMapping: null,
    ...overrides,
  }
}

const commandBusExecuteMock = jest.fn<Promise<{ result: unknown }>, unknown[]>()

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
    commandBus: { execute: commandBusExecuteMock } as unknown as CommandBus,
    entry: makeEntry(),
    row: parkedRow(),
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    settlement: { kind: 'result', payload: payloadWith(REPORTED_USAGE) },
    ...overrides,
  })
}

/** The single input `completeRun` was handed. */
function completeRunInput(): Record<string, unknown> {
  expect(completeRunMock).toHaveBeenCalledTimes(1)
  return completeRunMock.mock.calls[0][2] as Record<string, unknown>
}

/** The single input `failRun` was handed. */
function failRunInput(): Record<string, unknown> {
  expect(failRunMock).toHaveBeenCalledTimes(1)
  return failRunMock.mock.calls[0][2] as Record<string, unknown>
}

let logs: CapturedLogs

beforeEach(() => {
  claimExternalRunRowMock.mockReset().mockResolvedValue(true)
  settleExternalRunRowMock.mockReset().mockResolvedValue(true)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  persistVerdictMock.mockReset().mockResolvedValue([])
  checkOutputMock.mockReset().mockResolvedValue({ result: 'pass', checks: [] })
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  readExternalRunOutputMappingMock.mockReset().mockResolvedValue(null)
  captureExternalRunTranscriptMock.mockReset().mockResolvedValue(undefined)
  commandBusExecuteMock.mockReset().mockResolvedValue({ result: {} })
  logs = captureLogs()
})

afterEach(() => {
  logs.restore()
})

describe('what a connector reports reaches the run row', () => {
  it('stamps the reported cost, currency and duration on the completed run', async () => {
    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', runId: RUN_ID, resume: 'sent' })
    expect(completeRunInput()).toMatchObject({
      runId: RUN_ID,
      costMinor: 19,
      currency: 'USD',
      latencyMs: 74_000,
    })
  })

  it('normalises the currency code, because the column is three characters', async () => {
    await settleWith({
      settlement: { kind: 'result', payload: payloadWith({ ...REPORTED_USAGE, currency: 'usd' }) },
    })

    expect(completeRunInput()).toMatchObject({ currency: 'USD' })
  })

  it('keeps a reported zero cost — free minutes are a fact, not an absence', async () => {
    await settleWith({
      settlement: { kind: 'result', payload: payloadWith({ ...REPORTED_USAGE, costMinor: 0 }) },
    })

    expect(completeRunInput()).toMatchObject({ costMinor: 0, currency: 'USD' })
  })
})

describe('what a connector does NOT report stays null', () => {
  it('passes no cost keys at all when none was reported, so the column is left untouched', async () => {
    await settleWith({
      settlement: { kind: 'result', payload: payloadWith({ durationMs: 74_000 }) },
    })

    const input = completeRunInput()
    expect(input).toMatchObject({ latencyMs: 74_000 })
    // NOT `costMinor: 0` and NOT `costMinor: null`: an absent key is what makes
    // `applyUsageStamp` leave the column alone, which is what makes the cockpit
    // render `—` instead of a price of zero.
    expect(input).not.toHaveProperty('costMinor')
    expect(input).not.toHaveProperty('currency')
  })

  it('passes nothing at all for a connector that reports no usage (every connector before T3.2)', async () => {
    await settleWith({ settlement: { kind: 'result', payload: payloadWith() } })

    const input = completeRunInput()
    expect(input).not.toHaveProperty('costMinor')
    expect(input).not.toHaveProperty('currency')
    expect(input).not.toHaveProperty('latencyMs')
  })

  it('refuses a cost with no currency rather than assuming one', async () => {
    await settleWith({
      settlement: { kind: 'result', payload: payloadWith({ costMinor: 19, durationMs: 1_000 }) },
    })

    const input = completeRunInput()
    expect(input).not.toHaveProperty('costMinor')
    expect(input).toMatchObject({ latencyMs: 1_000 })
  })
})

describe('tokens', () => {
  it('are never stamped for an external run, whatever the connector says', async () => {
    await settleWith({
      settlement: {
        kind: 'result',
        payload: payloadWith({
          ...REPORTED_USAGE,
          // A connector trying to report tokens — the exact fiction this task
          // exists to prevent — is not merely ignored, it is unrepresentable.
          inputTokens: 4_000,
          outputTokens: 900,
        }),
      },
    })

    const input = completeRunInput()
    expect(input).not.toHaveProperty('inputTokens')
    expect(input).not.toHaveProperty('outputTokens')
    expect(input).toMatchObject({ costMinor: 19, latencyMs: 74_000 })
  })
})

describe('latency semantics', () => {
  it('stamps the provider-reported work interval, never a wall clock this process measured', async () => {
    // Settle a run whose row was opened long ago. If the latency were measured
    // here it would be minutes; it is exactly what the connector reported,
    // because nothing on this path reads a clock.
    await settleWith({
      settlement: { kind: 'result', payload: payloadWith({ ...REPORTED_USAGE, durationMs: 74_000 }) },
    })

    expect(completeRunInput()).toMatchObject({ latencyMs: 74_000 })
    expect(Date.now()).toBeGreaterThan(0) // the wall clock exists; this path just never asks for it
  })

  it('leaves the wall clock to the run row, which already records it', async () => {
    await settleWith()

    // `completed_at − created_at` on `agent_runs` IS the park duration, stamped
    // by `runs.create` (before the connector dialled) and `runs.complete`. The
    // settlement therefore supplies no second time field of its own.
    const input = completeRunInput()
    expect(Object.keys(input).sort()).toEqual(
      ['confidence', 'costMinor', 'currency', 'latencyMs', 'output', 'resultKind', 'runId'].sort(),
    )
  })
})

describe('the run still cost money when the answer was refused', () => {
  it('stamps the reported cost on a guardrail-blocked run', async () => {
    checkOutputMock.mockResolvedValue({
      result: 'block',
      checks: [],
      blockedReason: { phase: 'output', kind: 'pii' },
    })

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'failed', outcomeHandle: 'guardrailBlocked' })
    expect(failRunInput()).toMatchObject({ costMinor: 19, currency: 'USD', latencyMs: 74_000 })
  })

  it('stamps the reported cost on a schema-invalid answer, since the call was still placed', async () => {
    const settled = await settleWith({
      settlement: {
        kind: 'result',
        payload: { kind: 'researcher', data: { reached: 'yes' }, [EXTERNAL_RUN_USAGE_KEY]: REPORTED_USAGE },
      },
    })

    expect(settled).toMatchObject({ status: 'failed', cause: 'schema_invalid' })
    expect(failRunInput()).toMatchObject({ costMinor: 19, latencyMs: 74_000 })
  })

  it('stamps nothing when nobody ever answered', async () => {
    await settleWith({ settlement: { kind: 'expired', reason: 'deadline passed' } })

    const input = failRunInput()
    expect(input).not.toHaveProperty('costMinor')
    expect(input).not.toHaveProperty('latencyMs')
  })
})

describe('the agent OUTCOME contract is untouched', () => {
  it('strips the reserved key before the schema sees the payload, so a .strict() envelope still validates', async () => {
    const settled = await settleWith({ entry: makeEntry(strictOutcomeEnvelope) })

    expect(settled).toMatchObject({ status: 'completed' })
    expect(completeRunInput()).toMatchObject({ costMinor: 19 })
  })

  it('strips it before the output guardrail too, so a cost is never screened as content', async () => {
    await settleWith()

    expect(checkOutputMock).toHaveBeenCalledTimes(1)
    const screened = (checkOutputMock.mock.calls[0][0] as { output: Record<string, unknown> }).output
    expect(screened).toEqual({ kind: 'researcher', data: answer })
    expect(screened).not.toHaveProperty(EXTERNAL_RUN_USAGE_KEY)
  })

  it('resumes the workflow with the outcome only', async () => {
    await settleWith()

    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const payload = (sendSignalMock.mock.calls[0][2] as { payload: Record<string, unknown> }).payload
    expect(payload.call_owner_agent).toEqual(answer)
    expect(payload).not.toHaveProperty(EXTERNAL_RUN_USAGE_KEY)
  })

  it('still records what the provider actually said on the correlation row, cost included', async () => {
    await settleWith()

    const settle = settleExternalRunRowMock.mock.calls[0][2] as { resultPayload: Record<string, unknown> }
    // The row is the forensic record of the callback — which is exactly what
    // someone disputing a bill needs to read back verbatim.
    expect(settle.resultPayload).toMatchObject({ [EXTERNAL_RUN_USAGE_KEY]: REPORTED_USAGE })
  })
})

describe('a bad usage report degrades to no stamp and never breaks the settlement', () => {
  const hostile: Array<[string, unknown]> = [
    ['a negative cost', { costMinor: -19, currency: 'USD' }],
    ['a fractional cost', { costMinor: 19.5, currency: 'USD' }],
    ['a fractional duration', { durationMs: 74_000.5 }],
    ['a negative duration', { durationMs: -1 }],
    ['a five-letter currency', { costMinor: 19, currency: 'DOLLA' }],
    ['a string where a number belongs', { costMinor: '19', currency: 'USD' }],
    ['a string instead of a report', 'nineteen cents'],
    ['an array instead of a report', [19, 'USD']],
    ['a null report', null],
    ['a nested object', { costMinor: { amount: 19 }, currency: 'USD' }],
  ]

  it.each(hostile)('completes the run and stamps nothing for %s', async (_label, usage) => {
    const settled = await settleWith({ settlement: { kind: 'result', payload: payloadWith(usage) } })

    // The run the provider genuinely answered still completes and still resumes
    // the parked step. That is the whole guarantee: metering may never be the
    // reason a live workflow is stranded.
    expect(settled).toMatchObject({ status: 'completed', resume: 'sent' })
    const input = completeRunInput()
    expect(input).not.toHaveProperty('costMinor')
    expect(input).not.toHaveProperty('currency')
    expect(input).not.toHaveProperty('latencyMs')
  })

  it('never passes `completeRun` a value the runs.complete schema would reject', async () => {
    // The screening in `readExternalRunUsageReport` mirrors `runUsageStampSchema`
    // exactly, and this asserts the mirror rather than trusting it: a rejected
    // value must not reach the audited command, because a throw there happens
    // AFTER the row is claimed and would 500 the callback and strand the step.
    const stampSchema = z.object({
      costMinor: z.number().int().nonnegative().nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      latencyMs: z.number().int().nonnegative().nullable().optional(),
    })

    for (const [, usage] of hostile) {
      completeRunMock.mockClear()
      await settleWith({ settlement: { kind: 'result', payload: payloadWith(usage) } })
      expect(stampSchema.safeParse(completeRunMock.mock.calls[0][2]).success).toBe(true)
    }
  })

  it('survives a report that cannot even be read', () => {
    const poisoned = {}
    Object.defineProperty(poisoned, 'costMinor', {
      enumerable: true,
      get() {
        throw new Error('nope')
      },
    })

    expect(readExternalRunUsageReport(poisoned)).toEqual({})
  })
})

describe('nothing sensitive is logged', () => {
  it('names the rejected fields, never their values, when a report is malformed', async () => {
    await settleWith({
      settlement: {
        kind: 'result',
        // The realistic shape of the accident: a connector bug puts the dialled
        // number where an amount belongs.
        payload: payloadWith({ costMinor: DIALLED_NUMBER, currency: 'USD', durationMs: 74_000 }),
      },
    })

    const warnings = logs.at('warn')
    expect(warnings.length).toBeGreaterThan(0)
    expect(JSON.stringify(warnings)).toContain('costMinor')
    const everything = JSON.stringify(logs.records)
    expect(everything).not.toContain(DIALLED_NUMBER)
    expect(everything).not.toContain(SPOKEN_WORDS)
  })

  it('logs no transcript and no number on the ordinary success path', async () => {
    await settleWith()

    const everything = JSON.stringify(logs.records)
    expect(everything).not.toContain(DIALLED_NUMBER)
    expect(everything).not.toContain(SPOKEN_WORDS)
  })
})

describe('separateExternalRunUsage', () => {
  it('returns a payload with no reserved key unchanged, by identity', () => {
    const payload = { kind: 'researcher', data: answer }
    const separated = separateExternalRunUsage(payload)

    expect(separated.outcome).toBe(payload)
    expect(separated.usage).toEqual({})
  })

  it('leaves non-object payloads alone', () => {
    expect(separateExternalRunUsage(null)).toEqual({ outcome: null, usage: {} })
    expect(separateExternalRunUsage('text')).toEqual({ outcome: 'text', usage: {} })
    expect(separateExternalRunUsage([1, 2])).toEqual({ outcome: [1, 2], usage: {} })
  })

  it('removes only the reserved key', () => {
    const separated = separateExternalRunUsage(payloadWith(REPORTED_USAGE))

    expect(separated.outcome).toEqual({ kind: 'researcher', data: answer })
    expect(separated.usage).toEqual({ costMinor: 19, currency: 'USD', latencyMs: 74_000 })
  })
})

/**
 * A SIMULATED run (T3.3) settles in `ExternalAgentRunner.settleSimulatedRun` and
 * never reaches this module — it writes no correlation row, so no callback can
 * ever resolve one. These pin the two properties that keep it that way.
 */
describe('a simulated run', () => {
  it('cannot smuggle usage out of a connector mock, because a would-do is nested under `wouldDo`', () => {
    // What `buildSimulatedExternalRunResult` produces for a `mock` that returned
    // a full fake outcome AND a fake cost. The reserved key is one level down,
    // where the splitter does not look.
    const simulated = {
      kind: 'researcher',
      data: {
        simulated: true,
        started: false,
        kind: 'would_start_external_run',
        source: 'eval',
        agentId: 'voice.owner_call',
        connectorId: 'test.voice',
        wouldDo: { [EXTERNAL_RUN_USAGE_KEY]: { costMinor: 999, currency: 'USD', durationMs: 60_000 } },
      },
    }

    expect(separateExternalRunUsage(simulated).usage).toEqual({})
  })

  it('would be stamped with nothing even if such a payload reached the settlement path', async () => {
    const settled = await settleWith({
      entry: makeEntry(z.object({ kind: z.literal('researcher'), data: z.unknown() })),
      settlement: {
        kind: 'result',
        payload: {
          kind: 'researcher',
          data: { simulated: true, wouldDo: { [EXTERNAL_RUN_USAGE_KEY]: { costMinor: 999, currency: 'USD' } } },
        },
      },
    })

    expect(settled).toMatchObject({ status: 'completed' })
    const input = completeRunInput()
    expect(input).not.toHaveProperty('costMinor')
    expect(input).not.toHaveProperty('latencyMs')
  })
})
