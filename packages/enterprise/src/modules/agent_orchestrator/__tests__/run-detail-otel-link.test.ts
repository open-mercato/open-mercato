/** @jest-environment node */
import { GET } from '../api/runs/[id]/route'
import { mapRunOtelLink } from '../components/types'
import { traceIdFor } from '../lib/trace/otel/ids'
import { buildOtelTraceUrl } from '../lib/trace/otel/traceLink'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_RUN_ID = '44444444-4444-4444-8444-444444444444'
const WORKFLOW_ID = '55555555-5555-4555-8555-555555555555'
const TEMPLATE = 'https://tracing.example.com/trace/{traceId}'

const ENV_KEYS = [
  'OM_AGENT_OTEL_EXPORT',
  'OM_AGENT_OTEL_EXPORT_ENDPOINT',
  'OM_AGENT_OTEL_EXPORT_PROTOCOL',
  'OM_AGENT_OTEL_TRACE_URL_TEMPLATE',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
] as const

const savedEnv: Record<string, string | undefined> = {}

function setDeployment(options: { switchOn: boolean; template: string | null }) {
  process.env.OM_AGENT_OTEL_EXPORT = options.switchOn ? 'true' : 'false'
  process.env.OM_AGENT_OTEL_EXPORT_ENDPOINT = 'http://collector.example.com:4318/v1/traces'
  if (options.template) process.env.OM_AGENT_OTEL_TRACE_URL_TEMPLATE = options.template
  else delete process.env.OM_AGENT_OTEL_TRACE_URL_TEMPLATE
}

const params = Promise.resolve({ id: RUN_ID })

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}`)
}

async function setup(options: {
  run?: Record<string, unknown>
  tenantSettings?: Record<string, unknown> | null
  parents?: Record<string, { id: string; parentRunId: string | null }>
}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
    id: RUN_ID,
    agentId: 'deals.health_check',
    tenantId: TENANT,
    organizationId: ORG,
    workflowInstanceId: null,
    parentRunId: null,
    ...options.run,
  })
  const find = jest.fn(async () => [])
  const findOne = jest.fn(async (_entity: unknown, where: { id: string; tenantId: string }) =>
    where.tenantId === TENANT ? options.parents?.[where.id] ?? null : null,
  )
  const getRecord = jest.fn(async () =>
    options.tenantSettings ? { value: options.tenantSettings, source: 'tenant', updatedAt: '2026-10-27T10:00:00.000Z' } : null,
  )
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return { fork: () => ({ find, findOne }) }
      if (token === 'moduleConfigService') return { getRecord }
      return null
    },
  })
  return { findOne, getRecord }
}

describe('GET /api/agent_orchestrator/runs/:id — otel trace link', () => {
  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  })

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('is null while the deployment does not export', async () => {
    setDeployment({ switchOn: false, template: TEMPLATE })
    const { getRecord } = await setup({ tenantSettings: { enabled: true } })
    const body = await (await GET(makeRequest(), { params })).json()
    expect(body.otel).toBeNull()
    expect(getRecord).not.toHaveBeenCalled()
  })

  it('is null without a trace URL template', async () => {
    setDeployment({ switchOn: true, template: null })
    await setup({ tenantSettings: { enabled: true } })
    const body = await (await GET(makeRequest(), { params })).json()
    expect(body.otel).toBeNull()
  })

  it('is null while the tenant does not export', async () => {
    setDeployment({ switchOn: true, template: TEMPLATE })
    await setup({ tenantSettings: { enabled: false } })
    const body = await (await GET(makeRequest(), { params })).json()
    expect(body.otel).toBeNull()
  })

  it('anchors the trace on the workflow instance when the run has one', async () => {
    setDeployment({ switchOn: true, template: TEMPLATE })
    const { findOne } = await setup({
      tenantSettings: { enabled: true },
      run: { workflowInstanceId: WORKFLOW_ID, parentRunId: PARENT_RUN_ID },
    })
    const body = await (await GET(makeRequest(), { params })).json()
    const traceId = traceIdFor({ tenantId: TENANT, workflowInstanceId: WORKFLOW_ID, rootRunId: RUN_ID })
    expect(body.otel).toEqual({ traceId, url: `https://tracing.example.com/trace/${traceId}` })
    expect(findOne).not.toHaveBeenCalled()
  })

  it('anchors the trace on the root run reached through parentRunId', async () => {
    setDeployment({ switchOn: true, template: TEMPLATE })
    await setup({
      tenantSettings: { enabled: true },
      run: { parentRunId: PARENT_RUN_ID },
      parents: { [PARENT_RUN_ID]: { id: PARENT_RUN_ID, parentRunId: null } },
    })
    const body = await (await GET(makeRequest(), { params })).json()
    const traceId = traceIdFor({ tenantId: TENANT, workflowInstanceId: null, rootRunId: PARENT_RUN_ID })
    expect(body.otel?.traceId).toBe(traceId)
    expect(mapRunOtelLink(body.otel)).toEqual(body.otel)
  })
})

describe('buildOtelTraceUrl', () => {
  it('url-encodes every trace id placeholder', () => {
    expect(buildOtelTraceUrl('https://tracing.example.com/t/{traceId}?q={traceId}', 'a b/c')).toBe(
      'https://tracing.example.com/t/a%20b%2Fc?q=a%20b%2Fc',
    )
  })

  it('refuses a template that does not produce an http(s) URL', () => {
    expect(buildOtelTraceUrl('javascript:alert({traceId})', 'abc')).toBeNull()
    expect(buildOtelTraceUrl('not a url {traceId}', 'abc')).toBeNull()
  })
})

describe('mapRunOtelLink', () => {
  it('drops malformed or non-http links', () => {
    expect(mapRunOtelLink(null)).toBeNull()
    expect(mapRunOtelLink({ traceId: 'abc' })).toBeNull()
    expect(mapRunOtelLink({ traceId: 'abc', url: 'javascript:alert(1)' })).toBeNull()
  })
})
