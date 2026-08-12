/**
 * Artifact capture on the external runtime (tracker task 3.1).
 *
 * A settled external run must leave the operator something to open. What is
 * load-bearing:
 *
 * 1. **The answer becomes a real `AgentRunArtifact`** — through the same audited
 *    capture command and the same encrypted byte store the file plane uses, scoped
 *    to the correlation row's own tenant and organization.
 * 2. **Best-effort, one direction.** A run the provider genuinely answered must
 *    never be turned into a failed run because an object store was unreachable or
 *    the capture command threw. This is the single most important guarantee in the
 *    file: the run is already terminal by the time the capture runs, so a
 *    propagating error could not even fail it honestly — it would 500 the callback
 *    route, and the provider's redelivery would then find the row claimed and never
 *    resume the parked step at all.
 * 3. **The audio delivery changes nothing.** ElevenLabs sends `post_call_audio` as
 *    a SEPARATE webhook from `post_call_transcription`, so it lands on an
 *    already-settled run. It must not re-settle it, must not resume the workflow a
 *    second time, and must not capture a second artifact — on the first delivery or
 *    on any redelivery. (Why the recording itself is not stored: see the file
 *    comment on `captureExternalRunTranscript` and the task's analysis.)
 * 4. **Nothing sensitive is logged.** The stored answer is a real person speaking
 *    and the brief that produced it carried a phone number; every log record this
 *    path emits is ids, counts and byte sizes.
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
// `undefined`, which surfaces far away as `resume: 'failed'` — the recurring hazard
// recorded in the tracker's notes log. Every export the completion path uses is
// listed here on purpose.
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

/**
 * The byte store is mocked rather than the capture helper, so the assertions cover
 * the REAL serialization, hashing and size-cap logic and only the storage-s3 hop is
 * stubbed. `null` is what the real implementation returns when storage is absent.
 */
const putArtifactBytesMock = jest.fn<Promise<string | null>, unknown[]>()
jest.mock('../lib/runtime/artifactFileStore', () => {
  const actual = jest.requireActual('../lib/runtime/artifactFileStore')
  return {
    ...actual,
    putArtifactBytes: (...args: unknown[]) => putArtifactBytesMock(...args),
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
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
  type CompleteExternalRunArgs,
  type ExternalRunCorrelation,
} from '../lib/runtime/completeExternalRun'
import { EXTERNAL_RUN_TRANSCRIPT_FILE_NAME } from '../lib/runtime/externalRunArtifacts'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { captureLogs, type CapturedLogs } from './support/captureLogs'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'
const STORAGE_KEY = 'agent-run-artifacts/tenant/external-run-transcript.json.enc'
const ARTIFACT_ID = '77777777-7777-4777-8777-777777777777'

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

const answer = { reached: true, transcript: SPOKEN_WORDS, calledNumber: DIALLED_NUMBER }
const validPayload = { kind: 'researcher', data: answer }

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
    outputMapping: null,
    ...overrides,
  }
}

const commandBusExecuteMock = jest.fn<Promise<{ result: { artifactIds: string[] } }>, unknown[]>()

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
    entry,
    row: parkedRow(),
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    settlement: { kind: 'result', payload: validPayload },
    ...overrides,
  })
}

/** Every `artifact.capture` command invocation, with its input typed for assertion. */
function captureCalls(): Array<{
  tenantId: string
  organizationId: string
  runId: string
  artifacts: Array<{
    fileName: string
    mimeType: string
    fileSize: number
    sha256: string
    storageKey: string
    caption: string | null
  }>
}> {
  return commandBusExecuteMock.mock.calls
    .filter((call) => call[0] === 'agent_orchestrator.artifact.capture')
    .map((call) => (call[1] as { input: ReturnType<typeof captureCalls>[number] }).input)
}

/** The scope and payload `putArtifactBytes` was handed on its Nth call. */
function storedBytes(call = 0): {
  scope: { tenantId: string; organizationId: string }
  buffer: Buffer
  fileName: string
  mimeType: string
} {
  const invocation = putArtifactBytesMock.mock.calls[call]
  return {
    scope: invocation[1] as { tenantId: string; organizationId: string },
    ...(invocation[2] as { buffer: Buffer; fileName: string; mimeType: string }),
  }
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
  putArtifactBytesMock.mockReset().mockResolvedValue(STORAGE_KEY)
  commandBusExecuteMock.mockReset().mockResolvedValue({ result: { artifactIds: [ARTIFACT_ID] } })
  logs = captureLogs()
})

afterEach(() => {
  logs.restore()
  delete process.env.OM_AGENT_ARTIFACT_MAX_BYTES
})

describe('a settled external answer', () => {
  it('captures a transcript artifact carrying the run id, through the audited capture command', async () => {
    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', runId: RUN_ID, resume: 'sent' })

    const captures = captureCalls()
    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
    })
    expect(captures[0].artifacts).toHaveLength(1)
    expect(captures[0].artifacts[0]).toMatchObject({
      fileName: EXTERNAL_RUN_TRANSCRIPT_FILE_NAME,
      mimeType: 'application/json',
      storageKey: STORAGE_KEY,
      caption: null,
    })
    // The metadata describes the bytes that were actually stored — a row pointing
    // at a different digest or length would make the download unverifiable.
    const { buffer } = storedBytes()
    expect(captures[0].artifacts[0].fileSize).toBe(buffer.byteLength)
    expect(captures[0].artifacts[0].sha256).toHaveLength(64)
  })

  it('stores the connector-normalized ANSWER, readable, not the platform envelope', async () => {
    await settleWith()

    const { buffer, fileName, mimeType } = storedBytes()
    expect(fileName).toBe(EXTERNAL_RUN_TRANSCRIPT_FILE_NAME)
    expect(mimeType).toBe('application/json')
    // `kind` is a platform fact already on the run row; what an operator opens the
    // file for is what the agent reported.
    expect(JSON.parse(buffer.toString('utf8'))).toEqual(answer)
    expect(buffer.toString('utf8')).toContain('\n')
  })

  it('happens AFTER the run is closed, so nothing downstream waits on an object store', async () => {
    await settleWith()

    expect(completeRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      putArtifactBytesMock.mock.invocationCallOrder[0],
    )
    expect(settleExternalRunRowMock.mock.invocationCallOrder[0]).toBeLessThan(
      putArtifactBytesMock.mock.invocationCallOrder[0],
    )
  })
})

/**
 * The guarantee this task exists to hold. Each arm breaks the capture at a
 * different depth and asserts the same thing: the run still completed, and the
 * parked workflow step was still woken.
 */
describe('the best-effort guarantee', () => {
  it('completes and resumes when the artifact store is unavailable', async () => {
    putArtifactBytesMock.mockResolvedValue(null)

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', resume: 'sent' })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    // Nothing is recorded that points at bytes that were never stored.
    expect(captureCalls()).toHaveLength(0)
  })

  it('completes and resumes when the capture COMMAND throws', async () => {
    commandBusExecuteMock.mockRejectedValue(new Error('[internal] artifact command exploded'))

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', runId: RUN_ID, resume: 'sent' })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(
      logs.at('warn').some((record) => record.message.includes('artifact capture failed')),
    ).toBe(true)
  })

  it('completes and resumes when the byte store itself throws', async () => {
    putArtifactBytesMock.mockRejectedValue(new Error('[internal] s3 unreachable'))

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', resume: 'sent' })
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
  })

  it('skips an answer larger than the artifact size cap without disturbing the run', async () => {
    process.env.OM_AGENT_ARTIFACT_MAX_BYTES = '8'

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'completed', resume: 'sent' })
    expect(putArtifactBytesMock).not.toHaveBeenCalled()
    expect(captureCalls()).toHaveLength(0)
  })
})

/**
 * A failed settlement has no answer worth storing: a schema-invalid payload is a
 * connector defect, an expired row is a call nobody answered, and a
 * connector-reported failure carries only a reason string that already lives
 * (encrypted) on the correlation row.
 */
describe('the failure arms', () => {
  it('captures nothing for a schema-invalid payload', async () => {
    const settled = await settleWith({
      settlement: { kind: 'result', payload: { kind: 'researcher', data: { reached: 'maybe' } } },
    })

    expect(settled).toMatchObject({ status: 'failed', cause: 'schema_invalid' })
    expect(putArtifactBytesMock).not.toHaveBeenCalled()
    expect(captureCalls()).toHaveLength(0)
  })

  it('captures nothing for a connector-reported failure or an expired deadline', async () => {
    await settleWith({ settlement: { kind: 'failure', reason: 'the number rang out' } })
    await settleWith({ settlement: { kind: 'expired', reason: 'nobody answered' } })

    expect(putArtifactBytesMock).not.toHaveBeenCalled()
    expect(captureCalls()).toHaveLength(0)
  })

  it('captures nothing for a guardrail-blocked answer', async () => {
    checkOutputMock.mockResolvedValue({
      result: 'block',
      checks: [],
      blockedReason: { phase: 'output', kind: 'tool_scope' },
    })

    const settled = await settleWith()

    expect(settled).toMatchObject({ status: 'failed', cause: 'guardrail_blocked' })
    expect(captureCalls()).toHaveLength(0)
  })
})

/**
 * THE AUDIO PATH. ElevenLabs delivers `post_call_audio` as a separate webhook from
 * `post_call_transcription`, so by the time it arrives the run is settled and the
 * single-shot claim is spent. Its connector cannot map it onto an outcome, so the
 * callback route classifies it as a connector failure and hands it to exactly this
 * function — which must treat it as the no-op it is.
 */
describe('a second delivery for an already-settled run (the post_call_audio ordering)', () => {
  it('does not re-settle the run, does not resume the step again and captures no second artifact', async () => {
    const first = await settleWith()
    expect(first.status).toBe('completed')
    expect(captureCalls()).toHaveLength(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)

    // The row has left `pending`, so the conditional claim affects no rows — which
    // is the ONLY thing standing between a redelivery and a double resume.
    claimExternalRunRowMock.mockResolvedValue(false)
    const audioDelivery = await settleWith({
      settlement: { kind: 'failure', reason: 'connector could not normalize an audio-only payload' },
    })

    expect(audioDelivery).toEqual({ status: 'already_settled', runId: RUN_ID })
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(settleExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(captureCalls()).toHaveLength(1)
    expect(putArtifactBytesMock).toHaveBeenCalledTimes(1)
  })

  it('stays a no-op however many times the provider redelivers', async () => {
    await settleWith()
    claimExternalRunRowMock.mockResolvedValue(false)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const redelivered = await settleWith()
      expect(redelivered).toEqual({ status: 'already_settled', runId: RUN_ID })
    }

    expect(captureCalls()).toHaveLength(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
  })
})

describe('tenancy', () => {
  it('stores and records the artifact under the correlation row’s own scope', async () => {
    await settleWith()

    expect(storedBytes().scope).toEqual({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(captureCalls()[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('captures nothing at all when the caller’s scope does not own the row', async () => {
    const settled = await settleWith({
      scope: { tenantId: TENANT_ID, organizationId: OTHER_ORGANIZATION_ID },
    })

    expect(settled).toEqual({ status: 'scope_denied', runId: RUN_ID })
    expect(putArtifactBytesMock).not.toHaveBeenCalled()
    expect(captureCalls()).toHaveLength(0)
  })
})

describe('what reaches the logs', () => {
  it('never logs what was said or the number that was dialled, on any arm', async () => {
    await settleWith()
    putArtifactBytesMock.mockResolvedValue(null)
    await settleWith()
    commandBusExecuteMock.mockRejectedValue(new Error('[internal] artifact command exploded'))
    putArtifactBytesMock.mockResolvedValue(STORAGE_KEY)
    await settleWith()

    expect(logs.records.length).toBeGreaterThan(0)
    const emitted = JSON.stringify(logs.records)
    expect(emitted).not.toContain(SPOKEN_WORDS)
    expect(emitted).not.toContain(DIALLED_NUMBER)
    // The ids that make a record actionable ARE expected to be there.
    expect(emitted).toContain(RUN_ID)
  })
})
