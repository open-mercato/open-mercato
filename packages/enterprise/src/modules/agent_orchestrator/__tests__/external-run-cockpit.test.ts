/** @jest-environment node */
/**
 * Cockpit surfacing of an EXTERNAL run (tracker task 3.4).
 *
 * Five things are load-bearing and each is pinned here:
 *
 *  1. `GET /runs/:id/external` exposes the correlation row an operator needs and
 *     NOTHING ELSE — in particular not the brief, which carries the destination
 *     phone number, and not the transcript.
 *  2. The recording is FETCHED, never stored: the route pipes the connector's
 *     stream and writes no artifact row, which is asserted by watching the
 *     command bus and the artifact store rather than by trusting the code.
 *  3. The recording control is offered only when the connector can actually
 *     serve it.
 *  4. Re-running an external run cannot place a real call without an explicit
 *     acknowledgement, and a confirmed one reports 202 rather than 500.
 *  5. The Playground reports a suspension as an accepted run, not as a failure.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AgentRun, AgentExternalRun, AgentRunArtifact } from '../data/entities'
import { defineExternalAgent } from '../lib/sdk/defineExternalAgent'
import { mapAgent } from '../components/types'
import { RUNTIME_ICON } from '../components/agentChips'
import { AGENT_LIST_FILTER_IDS, filterAgentRows } from '../backend/agents/agentListFilters'
import en from '../i18n/en.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import pl from '../i18n/pl.json'
import ko from '../i18n/ko.json'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
} from '../lib/runtime/externalConnectorRegistry'
import { AgentRunSuspendedError } from '../lib/runtime/errors'
import {
  deriveExternalRunClock,
  formatParkedDuration,
  mapExternalRunState,
  EXTERNAL_RUN_STATUS_VARIANT,
} from '../components/externalRunView'
import { readSuspendedRun } from '../components/playgroundSuspension'

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => {}) }))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { GET as externalGet } from '../api/runs/[id]/external/route'
import { GET as recordingGet } from '../api/runs/[id]/recording/route'
import { POST as rerunPost } from '../api/runs/[id]/rerun/route'
import { POST as playgroundRunPost } from '../api/agents/[id]/run/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const NEW_RUN_ID = '77777777-7777-4777-8777-777777777777'
const USER = '44444444-4444-4444-8444-444444444444'
const CONVERSATION_ID = 'conv_abc123'
const CONNECTOR_ID = 'test.voice'

type Row = Record<string, unknown>

const LOCALE_DICTS: Array<Record<string, string>> = [
  en as Record<string, string>,
  de as Record<string, string>,
  es as Record<string, string>,
  pl as Record<string, string>,
  ko as Record<string, string>,
]

/**
 * A deliberately dumb store. It also records every entity it was ASKED about,
 * which is how the "no artifact row is written" assertion below stays honest:
 * a route that started persisting artifacts would have to touch
 * `AgentRunArtifact`, and this notices.
 */
function createFakeEm(rows: { runs?: Row[]; externalRuns?: Row[] } = {}) {
  const stores = new Map<unknown, Row[]>([
    [AgentRun, rows.runs ?? []],
    [AgentExternalRun, rows.externalRuns ?? []],
    [AgentRunArtifact, []],
  ])
  const persisted: Row[] = []

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      return (row[key] ?? null) === value
    })
  }

  const em = {
    fork() {
      return em
    },
    async findOne(entity: unknown, where: Row) {
      return (stores.get(entity) ?? []).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return (stores.get(entity) ?? []).filter((row) => matches(row, where))
    },
    create(entity: unknown, data: Row) {
      return { ...data, __entity: entity }
    },
    persist(row: Row) {
      persisted.push(row)
      return em
    },
    async flush() {
      for (const row of persisted.splice(0)) {
        const entity = (row as { __entity?: unknown }).__entity
        stores.get(entity as never)?.push(row)
      }
    },
  }
  return { em, artifacts: stores.get(AgentRunArtifact)! }
}

function mockContainer(em: unknown, extra: Record<string, unknown> = {}) {
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token in extra) return extra[token]
      return null
    },
  })
}

function seedRun(overrides: Row = {}): Row {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'voice.owner_call',
    runtime: 'external',
    deletedAt: null,
    ...overrides,
  }
}

function seedExternalRun(overrides: Row = {}): Row {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    tenantId: TENANT,
    organizationId: ORG,
    runId: RUN_ID,
    agentId: 'voice.owner_call',
    connectorId: CONNECTOR_ID,
    callbackTokenHash: 'a'.repeat(64),
    externalRunId: CONVERSATION_ID,
    status: 'completed',
    expiresAt: new Date('2026-08-13T10:30:00Z'),
    createdAt: new Date('2026-08-13T10:00:00Z'),
    updatedAt: new Date('2026-08-13T10:28:00Z'),
    processId: '33333333-3333-4333-8333-333333333333',
    stepId: 'call-owner',
    signalName: 'agent_orchestrator.proposal.ready',
    // The two columns that must never leave this module.
    requestPayload: { toNumber: '+48123456789', brief: 'Ask the owner about the offer' },
    resultPayload: { kind: 'researcher', data: { transcript: [{ role: 'user', message: 'Yes, go ahead' }] } },
    failureReason: null,
    ...overrides,
  }
}

function connectorStub(overrides: Partial<ExternalAgentConnector> = {}): ExternalAgentConnector {
  return {
    id: CONNECTOR_ID,
    async start() {
      throw new Error('[internal] not used in this test')
    },
    verifyCallback: () => true,
    normalize: (raw: unknown) => raw,
    ...overrides,
  }
}

/**
 * A stream that records whether anyone took a READER on it.
 *
 * `getReader` is the only way to consume a `ReadableStream`, so patching it is
 * how "the route piped the bytes rather than reading them" becomes a testable
 * fact rather than a promise in a comment. Chunk-level counting would not work:
 * a `Response` wrapping a stream pulls eagerly to fill its internal queue, which
 * is the platform doing its job, not the route reading.
 */
function countingStream(chunks: string[]) {
  const pending = [...chunks]
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pending.shift()
      if (next === undefined) controller.close()
      else controller.enqueue(new TextEncoder().encode(next))
    },
  })
  const state = { readerTaken: false }
  const originalGetReader = stream.getReader.bind(stream)
  stream.getReader = ((...args: Parameters<typeof originalGetReader>) => {
    state.readerTaken = true
    return originalGetReader(...args)
  }) as typeof stream.getReader
  return { stream, state }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearExternalAgentConnectorsForTests()
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ selectedId: ORG })
})

afterEach(() => clearExternalAgentConnectorsForTests())

describe('GET /api/agent_orchestrator/runs/:id/external', () => {
  const params = Promise.resolve({ id: RUN_ID })
  const request = () => new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/external`)

  it('returns the correlation row and reports a recording-capable connector', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)
    registerExternalAgentConnector(connectorStub({ fetchRecording: async () => null }))

    const res = await externalGet(request(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.externalRun).toMatchObject({
      connectorId: CONNECTOR_ID,
      status: 'completed',
      externalRunId: CONVERSATION_ID,
      stepId: 'call-owner',
      signalName: 'agent_orchestrator.proposal.ready',
    })
    expect(body.externalRun.createdAt).toBe('2026-08-13T10:00:00.000Z')
    expect(body.connector).toEqual({ id: CONNECTOR_ID, registered: true, supportsRecording: true })
  })

  it('never returns the brief (which carries the phone number) or the transcript', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)

    const res = await externalGet(request(), { params })
    const raw = JSON.stringify(await res.json())

    expect(raw).not.toContain('+48123456789')
    expect(raw).not.toContain('Yes, go ahead')
    expect(raw).not.toContain('requestPayload')
    expect(raw).not.toContain('resultPayload')
    // The one-way token digest is a settlement lookup key, not operator data.
    expect(raw).not.toContain('callbackTokenHash')
  })

  it('reports supportsRecording: false for a connector without the member', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)
    registerExternalAgentConnector(connectorStub())

    const body = await (await externalGet(request(), { params })).json()
    expect(body.connector).toEqual({ id: CONNECTOR_ID, registered: true, supportsRecording: false })
  })

  it('degrades to a null row for a native run instead of erroring', async () => {
    const { em } = createFakeEm({ runs: [seedRun({ runtime: 'native' })] })
    mockContainer(em)

    const res = await externalGet(request(), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ externalRun: null, connector: null })
  })

  it('reports an undeployed connector rather than 404ing the whole read', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)

    const body = await (await externalGet(request(), { params })).json()
    expect(body.externalRun).not.toBeNull()
    expect(body.connector).toEqual({ id: CONNECTOR_ID, registered: false, supportsRecording: false })
  })

  it('404s a run in another organization before touching its correlation row', async () => {
    const { em } = createFakeEm({
      runs: [seedRun({ organizationId: '99999999-9999-4999-8999-999999999999' })],
      externalRuns: [seedExternalRun()],
    })
    mockContainer(em)

    const res = await externalGet(request(), { params })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Run not found' })
  })
})

describe('GET /api/agent_orchestrator/runs/:id/recording', () => {
  const params = Promise.resolve({ id: RUN_ID })
  const request = () => new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/recording`)

  it('streams the provider bytes through and stores nothing', async () => {
    const { em, artifacts } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    const commandBus = { execute: jest.fn(async () => ({ result: {} })) }
    mockContainer(em, { commandBus })
    const { stream, state } = countingStream(['ID3-audio-bytes'])
    const streamWasReadByTheRoute = () => state.readerTaken
    const fetchRecording = jest.fn(async () => ({
      mimeType: 'audio/mpeg',
      stream,
      contentLength: 15,
      fileName: 'call.mp3',
    }))
    registerExternalAgentConnector(connectorStub({ fetchRecording }))

    const res = await recordingGet(request(), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="call.mp3"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')

    // The connector is asked with the ROW's tenancy and the provider's own id.
    expect(fetchRecording).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG }),
    )
    // THE PROOF THAT NOTHING IS COPIED: the route never took a reader on the
    // provider's stream, so it cannot have buffered, hashed or stored the audio
    // — it handed the stream to the response and returned. A route that started
    // materialising the bytes (to size them, to capture an artifact) would have
    // had to lock the stream first, and this fails.
    expect(streamWasReadByTheRoute()).toBe(false)

    // The bytes still reach the operator intact.
    expect(await res.text()).toBe('ID3-audio-bytes')

    // THE GUARANTEE: no artifact row, and no command that could have made one.
    expect(artifacts).toHaveLength(0)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('404s when the connector cannot fetch recordings', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)
    registerExternalAgentConnector(connectorStub())

    const res = await recordingGet(request(), { params })
    expect(res.status).toBe(404)
  })

  it('404s when the provider has no recording for the run', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)
    registerExternalAgentConnector(connectorStub({ fetchRecording: async () => null }))

    expect((await recordingGet(request(), { params })).status).toBe(404)
  })

  it('404s a run with no external correlation row', async () => {
    const { em } = createFakeEm({ runs: [seedRun({ runtime: 'native' })] })
    mockContainer(em)

    expect((await recordingGet(request(), { params })).status).toBe(404)
  })

  it('404s a cross-org run without asking the connector for anything', async () => {
    const { em } = createFakeEm({
      runs: [seedRun({ organizationId: '99999999-9999-4999-8999-999999999999' })],
      externalRuns: [seedExternalRun()],
    })
    mockContainer(em)
    const fetchRecording = jest.fn(async () => null)
    registerExternalAgentConnector(connectorStub({ fetchRecording }))

    expect((await recordingGet(request(), { params })).status).toBe(404)
    expect(fetchRecording).not.toHaveBeenCalled()
  })

  it('503s when the connector package is not deployed here', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)

    expect((await recordingGet(request(), { params })).status).toBe(503)
  })

  it('502s when the connector throws, without leaking the provider message', async () => {
    const { em } = createFakeEm({ runs: [seedRun()], externalRuns: [seedExternalRun()] })
    mockContainer(em)
    registerExternalAgentConnector(
      connectorStub({
        fetchRecording: async () => {
          throw new Error('[internal] xi-api-key sk-secret rejected')
        },
      }),
    )

    const res = await recordingGet(request(), { params })
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('sk-secret')
  })
})

describe('POST /api/agent_orchestrator/runs/:id/rerun — the external-call gate', () => {
  const params = Promise.resolve({ id: RUN_ID })

  function makeRequest(body?: unknown) {
    return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/rerun`, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  }

  function setup(sourceRun: Row, run: jest.Mock) {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(sourceRun)
    const findOne = jest.fn(async () => ({ id: NEW_RUN_ID }))
    const em = { fork: () => ({ findOne, fork: () => ({ findOne }) }) }
    mockContainer(em, { agentRuntime: { run } })
    return { run }
  }

  it('refuses an unconfirmed external re-run with 428 and never reaches the runtime', async () => {
    const run = jest.fn()
    setup(seedRun({ input: { toNumber: '+48123456789' } }), run)

    const res = await rerunPost(makeRequest(), { params })
    expect(res.status).toBe(428)
    expect(await res.json()).toMatchObject({
      code: 'external_call_confirmation_required',
      runtime: 'external',
      agentId: 'voice.owner_call',
    })
    // The whole point: nothing dialled.
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses when the body carries confirmExternalCall: false', async () => {
    const run = jest.fn()
    setup(seedRun(), run)

    expect((await rerunPost(makeRequest({ confirmExternalCall: false }), { params })).status).toBe(428)
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a confirmed external re-run as 202 accepted, not 500', async () => {
    const run = jest.fn(async () => {
      throw new AgentRunSuspendedError('voice.owner_call', NEW_RUN_ID, CONVERSATION_ID)
    })
    setup(seedRun(), run)

    const res = await rerunPost(makeRequest({ confirmExternalCall: true }), { params })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      runId: NEW_RUN_ID,
      status: 'suspended',
      externalRunId: CONVERSATION_ID,
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves a native re-run byte-identical — no confirmation, 200 with the new run id', async () => {
    const run = jest.fn(async () => ({ kind: 'researcher', data: { ok: true } }))
    setup(seedRun({ runtime: 'native', agentId: 'deals.health_check', input: { deal: { id: 'd1' } } }), run)

    const res = await rerunPost(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runId: NEW_RUN_ID })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/agent_orchestrator/agents/:id/run — the Playground suspension arm', () => {
  const params = Promise.resolve({ id: 'voice.owner_call' })

  function makeRequest() {
    return new Request('http://localhost/api/agent_orchestrator/agents/voice.owner_call/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { toNumber: '+48123456789' } }),
    })
  }

  it('answers 202 with the run id instead of throwing a 500 while a call is live', async () => {
    const run = jest.fn(async () => {
      throw new AgentRunSuspendedError('voice.owner_call', NEW_RUN_ID, CONVERSATION_ID)
    })
    const { em } = createFakeEm()
    mockContainer(em, { agentRuntime: { run } })

    const res = await playgroundRunPost(makeRequest(), { params })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      runId: NEW_RUN_ID,
      proposalId: null,
      status: 'suspended',
      externalRunId: CONVERSATION_ID,
    })
  })
})

describe('externalRunView — the client projection', () => {
  const payload = {
    externalRun: {
      id: 'ext-1',
      connectorId: CONNECTOR_ID,
      status: 'pending',
      externalRunId: CONVERSATION_ID,
      expiresAt: '2026-08-13T10:30:00.000Z',
      createdAt: '2026-08-13T10:00:00.000Z',
      updatedAt: null,
      processId: null,
      stepId: 'call-owner',
      signalName: null,
    },
    connector: { id: CONNECTOR_ID, registered: true, supportsRecording: true },
  }

  it('maps a well-formed payload', () => {
    const state = mapExternalRunState(payload)
    expect(state.externalRun).toMatchObject({ status: 'pending', externalRunId: CONVERSATION_ID })
    expect(state.connector).toEqual({ id: CONNECTOR_ID, registered: true, supportsRecording: true })
  })

  it('degrades to nothing for a native run, a failed read and an unknown status', () => {
    expect(mapExternalRunState({ externalRun: null, connector: null })).toEqual({
      externalRun: null,
      connector: null,
    })
    expect(mapExternalRunState(null)).toEqual({ externalRun: null, connector: null })
    expect(mapExternalRunState({})).toEqual({ externalRun: null, connector: null })
    expect(
      mapExternalRunState({ ...payload, externalRun: { ...payload.externalRun, status: 'weird' } }),
    ).toEqual({ externalRun: null, connector: null })
  })

  it('fails CLOSED on supportsRecording so no unusable control is ever offered', () => {
    const state = mapExternalRunState({
      ...payload,
      connector: { id: CONNECTOR_ID, registered: true, supportsRecording: 'yes' },
    })
    expect(state.connector?.supportsRecording).toBe(false)
  })

  it('gives every status a DS variant, and does not colour a normal wait as a problem', () => {
    expect(Object.keys(EXTERNAL_RUN_STATUS_VARIANT).sort()).toEqual([
      'cancelled',
      'completed',
      'expired',
      'failed',
      'pending',
    ])
    expect(EXTERNAL_RUN_STATUS_VARIANT.pending).toBe('info')
    expect(EXTERNAL_RUN_STATUS_VARIANT.expired).toBe('warning')
  })
})

describe('deriveExternalRunClock — parked vs talked', () => {
  it('reads the park duration off completed_at − created_at, beside the provider duration', () => {
    expect(
      deriveExternalRunClock({
        createdAt: '2026-08-13T10:00:00.000Z',
        completedAt: '2026-08-13T10:28:00.000Z',
        latencyMs: 74_000,
      }),
    ).toEqual({ parkedMs: 28 * 60 * 1000, talkedMs: 74_000 })
  })

  it('reports no park duration while the run is still in flight', () => {
    expect(
      deriveExternalRunClock({ createdAt: '2026-08-13T10:00:00.000Z', completedAt: null, latencyMs: null }),
    ).toEqual({ parkedMs: null, talkedMs: null })
  })

  it('refuses a negative or unparseable clock rather than rendering a nonsense duration', () => {
    expect(
      deriveExternalRunClock({
        createdAt: '2026-08-13T10:28:00.000Z',
        completedAt: '2026-08-13T10:00:00.000Z',
        latencyMs: -1,
      }),
    ).toEqual({ parkedMs: null, talkedMs: null })
    expect(deriveExternalRunClock({ createdAt: 'not a date', completedAt: null, latencyMs: null })).toEqual({
      parkedMs: null,
      talkedMs: null,
    })
  })
})

/**
 * The agents registry's `external` runtime tag predates this task, so this is a
 * VERIFICATION rather than a feature — but it was never asserted end to end, and
 * every link in it is a place a shipped connector's agent could silently fall
 * back to "In Process". Both shipped connectors (`elevenlabs.voice` and
 * `http.generic`) register their agents through `defineExternalAgent`, so
 * pinning that one function's output plus the projection and the presentation
 * maps covers both without this module importing either provider package (which
 * it must not — the dependency runs the other way).
 */
describe('agents registry — the external runtime tag, link by link', () => {
  it('stamps runtime: external at registration, projects it, and presents it', () => {
    const entry = defineExternalAgent({
      id: 'test.registry_probe',
      moduleId: 'agent_orchestrator',
      label: 'Registry probe',
      description: 'registration-only probe',
      connectorId: CONNECTOR_ID,
      timeout: '30m',
      result: {
        kind: 'researcher',
        schema: z.object({ kind: z.literal('researcher'), data: z.object({ ok: z.boolean() }) }),
      },
    })

    // 1. the registry entry
    expect(entry.runtime).toBe('external')
    // 2. both agents routes' own runtime enums — either one omitting `external`
    //    would fail response validation for the whole registry read, not just
    //    for the external agent
    for (const routePath of ['api/agents/route.ts', 'api/agents/[id]/route.ts']) {
      const source = readFileSync(join(__dirname, '..', routePath), 'utf8')
      const declared = /runtime: z\.enum\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? ''
      expect([routePath, declared.includes("'external'")]).toEqual([routePath, true])
    }
    // 3. the client projection — an unmapped runtime silently becomes in-process
    expect(mapAgent({ id: entry.id, runtime: entry.runtime })?.runtime).toBe('external')
    // 4. the presentation map the list column reads, and the filter facet
    expect(RUNTIME_ICON.external).toBeDefined()
    expect(AGENT_LIST_FILTER_IDS).toContain('runtime')
    // 5. the label, in every locale
    for (const locale of LOCALE_DICTS) {
      expect(locale['agent_orchestrator.agents.list.runtime.external']).toBeTruthy()
    }
  })

  it('keeps an external agent visible under a runtime filter that selects it', () => {
    const row = {
      id: 'voice.owner_call',
      resultKind: 'researcher' as const,
      agentType: null,
      runtime: 'external' as const,
      autonomy: 'review' as const,
      status: 'good' as const,
      tags: [],
      label: 'Call a person',
      description: '',
    }
    expect(filterAgentRows([row], '', { runtime: ['external'] })).toHaveLength(1)
    expect(filterAgentRows([row], '', { runtime: ['opencode'] })).toHaveLength(0)
  })
})

describe('formatParkedDuration', () => {
  it('reads a park in the units a human waits in, never as 1680.0s', () => {
    expect(formatParkedDuration(28 * 60 * 1000)).toBe('28m')
    expect(formatParkedDuration(45_000)).toBe('45s')
    expect(formatParkedDuration(65 * 60 * 1000)).toBe('1h 5m')
    expect(formatParkedDuration(2 * 60 * 60 * 1000)).toBe('2h')
  })

  it('refuses to format a missing or impossible duration', () => {
    expect(formatParkedDuration(null)).toBeNull()
    expect(formatParkedDuration(-1)).toBeNull()
    expect(formatParkedDuration(Number.NaN)).toBeNull()
  })
})

describe('readSuspendedRun', () => {
  it('recognises the 202 body', () => {
    expect(readSuspendedRun({ status: 'suspended', runId: NEW_RUN_ID, externalRunId: CONVERSATION_ID })).toEqual(
      { runId: NEW_RUN_ID, externalRunId: CONVERSATION_ID },
    )
  })

  it('never claims a suspension for an ordinary result, however malformed', () => {
    expect(readSuspendedRun({ kind: 'researcher', data: {} })).toBeNull()
    expect(readSuspendedRun({ runId: NEW_RUN_ID })).toBeNull()
    expect(readSuspendedRun(null)).toBeNull()
    expect(readSuspendedRun([{ status: 'suspended' }])).toBeNull()
  })
})
