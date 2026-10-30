/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentEvalAssertion, AgentEvalCase } from '../data/entities'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (em: { flush?: () => Promise<void> }, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
    await em.flush?.()
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (entity: unknown, where: unknown) => unknown }, entity: unknown, where: unknown) =>
    em.find(entity, where),
}))
jest.mock('../lib/access/agentInvokeAccess', () => ({ loadInvokerAcl: jest.fn() }))
jest.mock('../lib/eval/manifest', () => {
  const actual = jest.requireActual('../lib/eval/manifest')
  return { ...actual, resolveSnapshotPin: jest.fn() }
})

import { POST, metadata as importMetadata, openApi as importOpenApi } from '../api/eval-sets/import/route'
import {
  EVAL_SET_DOWNGRADED_HEADER,
  EVAL_SET_SOURCE_VERSION_HEADER,
  EVAL_SET_VERSION_HEADER,
  GET,
  metadata as exportMetadata,
  openApi as exportOpenApi,
} from '../api/eval-sets/[version]/export/route'
import { importEvalSetCommand, type ImportEvalSetCommandInput } from '../commands/evalSets'
import { loadInvokerAcl } from '../lib/access/agentInvokeAccess'
import { parseEvalSetText } from '../lib/eval/evalSetYaml'
import { manifestFromFile } from '../lib/eval/evalSetFile'
import {
  EVAL_SET_FORMAT,
  EVAL_SET_FORMAT_VERSION,
  EvalSetUnresolvedError,
  hashManifest,
  resolveSnapshotPin,
  type EvalSetManifest,
} from '../lib/eval/manifest'

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as { getAuthFromRequest: jest.Mock }
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { runRouteMutationGuards } = jest.requireMock('@open-mercato/shared/lib/crud/route-mutation-guard') as {
  runRouteMutationGuards: jest.Mock
}
const loadAclMock = loadInvokerAcl as jest.MockedFunction<typeof loadInvokerAcl>
const resolveSnapshotPinMock = resolveSnapshotPin as jest.MockedFunction<typeof resolveSnapshotPin>

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const AGENT = 'content_review.validator'

type Row = Record<string, unknown>

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && '$in' in expected) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return (actual ?? null) === expected
}

function createFakeEm() {
  const stores = new Map<unknown, Row[]>()
  const pending: Row[] = []
  const storeFor = (entity: unknown): Row[] => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const em = {
    fork: () => em,
    create: (entity: unknown, data: Row) => ({ ...data, __entity: entity }),
    persist(row: Row) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => Object.entries(where).every(([key, value]) => matchesValue(row[key], value)))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const runAfterSuccess = jest.fn(async () => undefined)
let fake = createFakeEm()

function installContainer() {
  const commandBus = {
    execute: jest.fn(async (_id: string, options: { input: ImportEvalSetCommandInput; ctx: CommandRuntimeContext }) => ({
      result: await importEvalSetCommand.execute(options.input, options.ctx),
      logEntry: null,
    })),
  }
  const container = {
    resolve(name: string) {
      if (name === 'em') return fake.em
      if (name === 'commandBus') return commandBus
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
  createRequestContainer.mockResolvedValue(container)
  return commandBus
}

function sampleFile(overrides: Record<string, unknown> = {}) {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: AGENT,
    assertions: [{ key: 'present', scorerKey: 'output_present', severity: 'gate', title: 'Output present', config: {} }],
    cases: [{ key: 'clean-01', input: { content: 'Capital at risk.' }, assertions: [{ key: 'present' }] }],
    ...overrides,
  }
}

function importRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/agent_orchestrator/eval-sets/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function exportRequest(version: string, query = `?agentDefinitionId=${AGENT}`) {
  return GET(new Request(`http://localhost/api/agent_orchestrator/eval-sets/${version}/export${query}`), {
    params: Promise.resolve({ version }),
  })
}

function judgeGateManifest(): EvalSetManifest {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: AGENT,
    label: null,
    source: 'db',
    assertions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        key: 'rationale',
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: 'gate',
        title: 'Rationale',
        config: { rubric: 'Does the rationale cite evidence?' },
      },
    ],
    cases: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        key: '66666666-6666-4666-8666-666666666666',
        name: 'Case one',
        input: { content: 'hello' },
        expected: null,
        assertions: null,
      },
    ],
  }
}

const ENV_KEY = 'OM_AGENT_EVAL_SET_MAX_BYTES'
const originalMaxBytes = process.env[ENV_KEY]

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeEm()
  installContainer()
  getAuthFromRequest.mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  loadAclMock.mockResolvedValue({
    features: ['agent_orchestrator.eval.manage', 'agent_orchestrator.eval.export'],
    isSuperAdmin: false,
  })
  runRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
})

afterEach(() => {
  if (originalMaxBytes === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalMaxBytes
})

describe('POST /api/agent_orchestrator/eval-sets/import', () => {
  it('requires eval.manage and documents the route', () => {
    expect(importMetadata.POST).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] })
    expect(importOpenApi.methods.POST?.errors?.map((entry) => entry.status)).toEqual([400, 401, 403, 413, 422])
    expect(importOpenApi.methods.POST?.requestBody).toBeDefined()
  })

  it('returns 401 without auth and 403 without eval.manage', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    expect((await POST(importRequest({ file: sampleFile() }))).status).toBe(401)

    loadAclMock.mockResolvedValueOnce({ features: ['agent_orchestrator.eval.export'], isSuperAdmin: false })
    const forbidden = await POST(importRequest({ file: sampleFile() }))
    expect(forbidden.status).toBe(403)
    expect(fake.storeFor(AgentEvalCase)).toHaveLength(0)
  })

  it('checks the ACL in the caller scope and writes rows scoped to it', async () => {
    const response = await POST(importRequest({ file: sampleFile() }))
    expect(response.status).toBe(200)
    expect(loadAclMock).toHaveBeenCalledWith(expect.anything(), { kind: 'user', userId: USER }, { tenantId: TENANT, organizationId: ORG })
    expect(runRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { userId: USER, tenantId: TENANT, organizationId: ORG },
        input: { resourceKind: 'agent_orchestrator.eval_set', resourceId: ORG, operation: 'custom' },
      }),
    )
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    const rows = [...fake.storeFor(AgentEvalCase), ...fake.storeFor(AgentEvalAssertion)]
    expect(rows.every((row) => row.tenantId === TENANT && row.organizationId === ORG)).toBe(true)
  })

  it('creates, then no-ops, then updates by key; the response omits the undo payload', async () => {
    const created = await POST(importRequest({ file: sampleFile() }))
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      agentId: AGENT,
      created: { cases: 1, assertions: 1 },
      updated: { cases: 0, assertions: 0 },
      unchanged: { cases: 0, assertions: 0 },
    })
    expect(createdBody.version).toBe(manifestFromFile(parseEvalSetText(JSON.stringify(sampleFile()))).version)
    expect(createdBody).not.toHaveProperty('undo')
    expect(createdBody.cases[0]).toMatchObject({ key: 'clean-01', status: 'draft', change: 'created' })

    const again = await (await POST(importRequest({ file: sampleFile() }))).json()
    expect(again).toMatchObject({ created: { cases: 0, assertions: 0 }, unchanged: { cases: 1, assertions: 1 } })

    const edited = sampleFile({ cases: [{ key: 'clean-01', input: { content: 'Changed' }, assertions: [{ key: 'present' }] }] })
    const updated = await (await POST(importRequest({ file: edited, approve: true }))).json()
    expect(updated).toMatchObject({ updated: { cases: 1, assertions: 0 }, unchanged: { cases: 0, assertions: 1 } })
    expect(updated.cases[0]).toMatchObject({ status: 'approved', change: 'updated' })
    expect(fake.storeFor(AgentEvalCase)).toHaveLength(1)
    expect(fake.storeFor(AgentEvalCase)[0]).toMatchObject({ approvedByUserId: USER, input: { content: 'Changed' } })
  })

  it('accepts YAML text', async () => {
    const yamlText = [
      `format: ${EVAL_SET_FORMAT}`,
      'formatVersion: 1',
      `agentId: ${AGENT}`,
      'assertions: []',
      'cases:',
      '  - key: yaml-01',
      '    input:',
      '      content: hi',
      '',
    ].join('\n')
    const response = await POST(importRequest({ text: yamlText }))
    expect(response.status).toBe(200)
    expect((await response.json()).created).toEqual({ cases: 1, assertions: 0 })
  })

  it('returns 422 with field-level issues for an invalid file', async () => {
    const invalid = sampleFile({
      assertions: [
        { key: 'present', scorerKey: 'output_present', severity: 'gate', title: 'Output present', config: {} },
        { key: 'judge', scorerKey: 'llm_judge', severity: 'gate', title: 'Judge', config: { rubric: 'x' } },
        { key: 'nope', scorerKey: 'no_such_scorer', severity: 'warn', title: 'Unknown' },
      ],
    })
    const response = await POST(importRequest({ file: invalid }))
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.code).toBe('eval_set_file_invalid')
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'judge_gate_refused', path: 'assertions.1.severity' }),
        expect.objectContaining({ code: 'unknown_scorer', path: 'assertions.2.scorerKey' }),
      ]),
    )
    expect(fake.storeFor(AgentEvalAssertion)).toHaveLength(0)

    const badYaml = await POST(importRequest({ text: 'format: [unclosed' }))
    expect(badYaml.status).toBe(422)
    expect((await badYaml.json()).issues[0].code).toBe('invalid_format')
  })

  it('returns 400 for a malformed body', async () => {
    expect((await POST(importRequest('not json'))).status).toBe(400)
    expect((await POST(importRequest({ file: sampleFile(), text: 'x' }))).status).toBe(400)
    expect((await POST(importRequest({}))).status).toBe(400)
  })

  it('enforces the size cap: 413 over the transport cap, 422 over the file cap', async () => {
    process.env[ENV_KEY] = '400'
    const tooBig = await POST(importRequest({ file: sampleFile({ label: 'x'.repeat(100), cases: [{ key: 'k', input: { blob: 'y'.repeat(900) } }] }) }))
    expect(tooBig.status).toBe(413)
    expect((await tooBig.json()).code).toBe('eval_set_too_large')

    const declared = await POST(importRequest({ file: sampleFile() }, { 'content-length': '5000' }))
    expect(declared.status).toBe(413)

    const overFileCap = await POST(importRequest({ file: sampleFile({ cases: [{ key: 'k', input: { blob: 'y'.repeat(300) } }] }) }))
    expect(overFileCap.status).toBe(422)
    expect((await overFileCap.json()).issues[0].code).toBe('eval_set_too_large')
    expect(fake.storeFor(AgentEvalCase)).toHaveLength(0)
  })

  it('returns the guard rejection without writing', async () => {
    runRouteMutationGuards.mockResolvedValueOnce({
      ok: false,
      errorStatus: 423,
      errorBody: { error: 'locked' },
      response: new Response(JSON.stringify({ error: 'locked' }), { status: 423 }),
    })
    const response = await POST(importRequest({ file: sampleFile() }))
    expect(response.status).toBe(423)
    expect(fake.storeFor(AgentEvalCase)).toHaveLength(0)
  })
})

describe('GET /api/agent_orchestrator/eval-sets/:version/export', () => {
  it('requires eval.export and documents the route', () => {
    expect(exportMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.eval.export'] })
    expect(exportOpenApi.methods.GET?.errors?.map((entry) => entry.status)).toEqual([400, 401, 403, 404, 422])
  })

  it('returns 401 without auth and 403 without eval.export', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    expect((await exportRequest('current')).status).toBe(401)
    loadAclMock.mockResolvedValueOnce({ features: ['agent_orchestrator.eval.manage'], isSuperAdmin: false })
    expect((await exportRequest('current')).status).toBe(403)
    expect(resolveSnapshotPinMock).not.toHaveBeenCalled()
  })

  it('exports `current` as JSON scoped to the caller, downgrading judge gates with a warning header', async () => {
    const manifest = judgeGateManifest()
    resolveSnapshotPinMock.mockResolvedValue({ manifest, version: hashManifest(manifest) })
    const response = await exportRequest('current')
    expect(response.status).toBe(200)
    expect(resolveSnapshotPinMock).toHaveBeenCalledWith(fake.em, { tenantId: TENANT, organizationId: ORG }, AGENT, 'latest')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="eval-set-${AGENT}-current.json"`)
    expect(response.headers.get(EVAL_SET_DOWNGRADED_HEADER)).toBe('rationale')
    expect(response.headers.get(EVAL_SET_SOURCE_VERSION_HEADER)).toBe(hashManifest(manifest))

    const text = await response.text()
    const file = parseEvalSetText(text)
    expect(file.assertions[0]).toMatchObject({ key: 'rationale', severity: 'warn' })
    expect(file.cases[0]).toMatchObject({ key: manifest.cases[0].key, name: 'Case one' })
    expect(response.headers.get(EVAL_SET_VERSION_HEADER)).toBe(manifestFromFile(file).version)
  })

  it('exports a pinned hash as YAML that re-imports cleanly', async () => {
    const manifest = { ...judgeGateManifest(), assertions: [] }
    const version = hashManifest(manifest)
    resolveSnapshotPinMock.mockResolvedValue({ manifest, version })
    const response = await exportRequest(version, `?agentDefinitionId=${AGENT}&format=yaml`)
    expect(response.status).toBe(200)
    expect(resolveSnapshotPinMock).toHaveBeenCalledWith(fake.em, { tenantId: TENANT, organizationId: ORG }, AGENT, version)
    expect(response.headers.get('content-type')).toBe('application/yaml; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="eval-set-${AGENT}-${version.slice('sha256:'.length, 'sha256:'.length + 12)}.yaml"`,
    )
    expect(response.headers.get(EVAL_SET_DOWNGRADED_HEADER)).toBeNull()

    const text = await response.text()
    expect(text.startsWith('format: open-mercato.agent-eval-set')).toBe(true)
    const imported = await POST(importRequest({ text, format: 'yaml' }))
    expect(imported.status).toBe(200)
    expect((await imported.json()).created).toEqual({ cases: 1, assertions: 0 })
  })

  it('returns 404 for an unknown version and 400 for bad input', async () => {
    resolveSnapshotPinMock.mockRejectedValueOnce(new EvalSetUnresolvedError(`sha256:${'a'.repeat(64)}`))
    expect((await exportRequest(`sha256:${'a'.repeat(64)}`)).status).toBe(404)
    expect((await exportRequest('latest')).status).toBe(400)
    expect((await exportRequest('current', '')).status).toBe(400)
    expect((await exportRequest('current', `?agentDefinitionId=${AGENT}&format=xml`)).status).toBe(400)
  })

  it('returns 422 when the stored set cannot be written as a valid file', async () => {
    const manifest = judgeGateManifest()
    manifest.assertions[0] = { ...manifest.assertions[0], scorerKey: 'retired_scorer', type: 'deterministic', severity: 'warn' }
    resolveSnapshotPinMock.mockResolvedValue({ manifest, version: hashManifest(manifest) })
    const response = await exportRequest('current')
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.code).toBe('eval_set_not_exportable')
    expect(body.issues[0]).toMatchObject({ code: 'unknown_scorer' })
  })
})
