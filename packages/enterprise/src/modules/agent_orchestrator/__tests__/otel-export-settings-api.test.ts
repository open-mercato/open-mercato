/** @jest-environment node */
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { GET, PUT, metadata, openApi } from '../api/otel-export/settings/route'
import {
  POST as postTestSpan,
  metadata as testMetadata,
  openApi as testOpenApi,
} from '../api/otel-export/test/route'
import {
  UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID,
  updateOtelExportSettingsCommand,
} from '../commands/otelExport'
import { OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME } from '../lib/trace/otel/exportSettings'
import { OTEL_EXPORT_HEALTH_CONFIG_NAME } from '../lib/trace/otel/exportHealth'
import { otelExportSettingsSchema } from '../data/validators'
import type { PostOtlpTracesInput } from '../lib/trace/otel/otlpHttpClient'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../lib/trace/otel/otlpHttpClient', () => {
  const actual = jest.requireActual('../lib/trace/otel/otlpHttpClient')
  return { ...actual, postOtlpTraces: jest.fn() }
})

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { postOtlpTraces } = jest.requireMock('../lib/trace/otel/otlpHttpClient') as {
  postOtlpTraces: jest.Mock
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const MANAGE = 'agent_orchestrator.agents.manage'
const VIEW_CONTENT = 'agent_orchestrator.trace.view_content'
const ENDPOINT = 'https://collector.example.test/v1/traces'
const HEADER_SECRET = 'otlp-header-secret-value'
const TRACE_TEMPLATE = 'https://tracing.example.test/trace/{traceId}'

const OTEL_ENV_KEYS = [
  'OM_AGENT_OTEL_EXPORT',
  'OM_AGENT_OTEL_EXPORT_ENDPOINT',
  'OM_AGENT_OTEL_EXPORT_HEADERS',
  'OM_AGENT_OTEL_EXPORT_PROTOCOL',
  'OM_AGENT_OTEL_EXPORT_CONTENT',
  'OM_AGENT_OTEL_TRACE_URL_TEMPLATE',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
]

type StoredRow = { value: unknown; updatedAt: string }

function rowKey(name: string, tenantId: string | null | undefined) {
  return `${name}:${tenantId ?? ''}`
}

function makeConfigStore(initial?: unknown) {
  const rows = new Map<string, StoredRow>()
  let tick = 0
  const nextStamp = () => new Date(Date.UTC(2026, 9, 27, 10, 0, tick++)).toISOString()
  if (initial !== undefined) {
    rows.set(rowKey(OTEL_EXPORT_CONFIG_NAME, TENANT), { value: initial, updatedAt: nextStamp() })
  }
  const getRecord = jest.fn(async (_module: string, name: string, scope?: { tenantId?: string | null }) => {
    const row = rows.get(rowKey(name, scope?.tenantId))
    return row ? { value: row.value, source: 'tenant', updatedAt: row.updatedAt } : null
  })
  const setValue = jest.fn(
    async (_module: string, name: string, value: unknown, scope?: { tenantId?: string | null }) => {
      const row = { value: value ?? null, updatedAt: nextStamp() }
      rows.set(rowKey(name, scope?.tenantId), row)
      return { value: row.value, source: 'tenant', updatedAt: row.updatedAt }
    },
  )
  const settingsRow = () => rows.get(rowKey(OTEL_EXPORT_CONFIG_NAME, TENANT))
  const healthRow = () => rows.get(rowKey(OTEL_EXPORT_HEALTH_CONFIG_NAME, TENANT))
  return { rows, getRecord, setValue, settingsRow, healthRow }
}

function makeContainer(options: {
  store?: ReturnType<typeof makeConfigStore>
  features?: string[]
  isSuperAdmin?: boolean
  execute?: jest.Mock
  consume?: jest.Mock
}) {
  const store = options.store ?? makeConfigStore()
  const loadAcl = jest.fn(async () => ({
    isSuperAdmin: options.isSuperAdmin ?? false,
    features: options.features ?? [],
    organizations: null,
  }))
  const execute = options.execute ?? jest.fn()
  const consume =
    options.consume ?? jest.fn(async () => ({ allowed: true, remainingPoints: 0, msBeforeNext: 10_000 }))
  const container = {
    hasRegistration: (token: string) => token === 'rateLimiterService',
    resolve: (token: string) => {
      if (token === 'moduleConfigService') return { getRecord: store.getRecord, setValue: store.setValue }
      if (token === 'rbacService') return { loadAcl }
      if (token === 'commandBus') return { execute }
      if (token === 'rateLimiterService') return { consume, trustProxyDepth: 0 }
      throw new Error(`Unexpected DI token in test: ${token}`)
    },
  }
  return { container, store, loadAcl, execute, consume }
}

function authOf(overrides: Record<string, unknown> = {}) {
  return { sub: USER, tenantId: TENANT, orgId: ORG, ...overrides }
}

function commandCtx(
  container: ReturnType<typeof makeContainer>['container'],
  overrides: Partial<CommandRuntimeContext> = {},
): CommandRuntimeContext {
  return {
    container: container as never,
    auth: authOf() as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    ...overrides,
  }
}

function putRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/agent_orchestrator/otel-export/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function testRequest() {
  return new Request('http://localhost/api/agent_orchestrator/otel-export/test', { method: 'POST' })
}

function enableDeployment(extra: Record<string, string> = {}) {
  process.env.OM_AGENT_OTEL_EXPORT = 'on'
  process.env.OM_AGENT_OTEL_EXPORT_ENDPOINT = ENDPOINT
  process.env.OM_AGENT_OTEL_EXPORT_HEADERS = `authorization=Bearer%20${HEADER_SECRET}`
  process.env.OM_AGENT_OTEL_TRACE_URL_TEMPLATE = TRACE_TEMPLATE
  Object.assign(process.env, extra)
}

async function runUpdate(
  container: ReturnType<typeof makeContainer>['container'],
  settingsInput: Record<string, unknown>,
  ctxOverrides: Partial<CommandRuntimeContext> = {},
) {
  const input = { tenantId: TENANT, settings: otelExportSettingsSchema.parse(settingsInput) }
  const ctx = commandCtx(container, ctxOverrides)
  const prepared = await updateOtelExportSettingsCommand.prepare!(input, ctx)
  const result = await updateOtelExportSettingsCommand.execute(input, ctx)
  const log = await updateOtelExportSettingsCommand.buildLog!({
    input,
    result,
    ctx,
    snapshots: { before: prepared?.before },
  })
  const logEntry: CommandUndoLogEntry = {
    commandId: UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID,
    commandPayload: log?.payload ?? null,
    snapshotBefore: log?.snapshotBefore ?? null,
    snapshotAfter: log?.snapshotAfter ?? null,
    tenantId: TENANT,
  }
  return { input, ctx, result, log, logEntry }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of OTEL_ENV_KEYS) delete process.env[key]
})

afterAll(() => {
  for (const key of OTEL_ENV_KEYS) delete process.env[key]
})

describe('GET /otel-export/settings', () => {
  test('returns the default settings with a redacted deployment view', async () => {
    const { container } = makeContainer({})
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await GET(new Request('http://localhost/x'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      settings: otelExportSettingsSchema.parse({}),
      source: 'default',
      updatedAt: null,
      deployment: {
        enabled: false,
        switchOn: false,
        endpointConfigured: false,
        protocol: 'http/json',
        protocolSupported: true,
        contentAllowed: false,
        traceLinkConfigured: false,
      },
      health: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
    })
  })

  test('never returns the endpoint, headers or trace link template', async () => {
    enableDeployment({ OM_AGENT_OTEL_EXPORT_CONTENT: 'allow' })
    const store = makeConfigStore({ enabled: true, agentAllowlist: ['agent.one'] })
    store.rows.set(rowKey(OTEL_EXPORT_HEALTH_CONFIG_NAME, TENANT), {
      value: { lastSuccessAt: '2026-10-27T09:00:00.000Z', lastErrorAt: null, lastErrorCode: null },
      updatedAt: '2026-10-27T09:00:00.000Z',
    })
    const { container } = makeContainer({ store })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await GET(new Request('http://localhost/x'))
    const text = await response.text()
    const body = JSON.parse(text)

    expect(body.source).toBe('tenant')
    expect(body.settings).toMatchObject({ enabled: true, agentAllowlist: ['agent.one'] })
    expect(body.updatedAt).toBe(store.settingsRow()?.updatedAt)
    expect(body.deployment).toEqual({
      enabled: true,
      switchOn: true,
      endpointConfigured: true,
      protocol: 'http/json',
      protocolSupported: true,
      contentAllowed: true,
      traceLinkConfigured: true,
    })
    expect(body.health.lastSuccessAt).toBe('2026-10-27T09:00:00.000Z')
    expect(text).not.toContain('collector.example.test')
    expect(text).not.toContain(HEADER_SECRET)
    expect(text).not.toContain('tracing.example.test')
    expect(text).not.toContain('{traceId}')
  })

  test('rejects an anonymous caller', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/x'))).status).toBe(401)
  })
})

describe('PUT /otel-export/settings', () => {
  test('declares its features in metadata and documents the routes', () => {
    expect(metadata.GET.requireFeatures).toEqual(['agent_orchestrator.trace.view'])
    expect(metadata.PUT.requireFeatures).toEqual([MANAGE])
    expect(testMetadata.POST.requireFeatures).toEqual([MANAGE])
    expect(openApi.methods?.GET).toBeDefined()
    expect(openApi.methods?.PUT).toBeDefined()
    expect(testOpenApi.methods?.POST).toBeDefined()
  })

  test('403 without agents.manage', async () => {
    const { container, execute } = makeContainer({ features: ['agent_orchestrator.trace.view'] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    expect((await PUT(putRequest({ enabled: true }))).status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  test('403 for content export without trace.view_content', async () => {
    enableDeployment({ OM_AGENT_OTEL_EXPORT_CONTENT: 'allow' })
    const { container, execute } = makeContainer({ features: [MANAGE] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    expect((await PUT(putRequest({ enabled: true, content: 'full' }))).status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  test('400 on an invalid body or without a tenant', async () => {
    const { container, execute } = makeContainer({ features: [MANAGE] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    expect((await PUT(putRequest({ enabled: 'yes' }))).status).toBe(400)
    expect((await PUT(putRequest({ content: 'partial' }))).status).toBe(400)
    expect((await PUT(putRequest('{not json'))).status).toBe(400)
    getAuthFromRequest.mockResolvedValue(authOf({ tenantId: null }))
    expect((await PUT(putRequest({ enabled: true }))).status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  test.each([
    ['deny', 'content_export_not_allowed'],
    [undefined, 'content_export_not_allowed'],
    ['allow', 'content_export_unavailable'],
  ])('422 for content export when the deployment content mode is %s', async (mode, error) => {
    enableDeployment(mode ? { OM_AGENT_OTEL_EXPORT_CONTENT: mode } : {})
    const { container, execute } = makeContainer({ features: [MANAGE, VIEW_CONTENT] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(putRequest({ enabled: true, content: 'full' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error })
    expect(execute).not.toHaveBeenCalled()
  })

  test('saves through the update command', async () => {
    const execute = jest.fn(async () => ({
      result: {
        settings: otelExportSettingsSchema.parse({ enabled: true }),
        source: 'tenant',
        updatedAt: '2026-10-27T10:00:00.000Z',
      },
      logEntry: null,
    }))
    const { container } = makeContainer({ features: ['agent_orchestrator.*'], execute })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(putRequest({ enabled: true }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledWith(
      UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID,
      expect.objectContaining({
        input: { tenantId: TENANT, settings: otelExportSettingsSchema.parse({ enabled: true }) },
      }),
    )
    expect(body).toMatchObject({
      settings: { enabled: true },
      source: 'tenant',
      updatedAt: '2026-10-27T10:00:00.000Z',
      deployment: { enabled: false, endpointConfigured: false },
      health: { lastSuccessAt: null },
    })
  })

  test('maps a stale lock version to 409', async () => {
    const store = makeConfigStore({ enabled: false })
    const execute = jest.fn(async (_id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => ({
      result: await updateOtelExportSettingsCommand.execute(
        options.input as Parameters<typeof updateOtelExportSettingsCommand.execute>[0],
        options.ctx,
      ),
      logEntry: null,
    }))
    const wired = makeContainer({ store, features: [MANAGE], execute })
    createRequestContainer.mockResolvedValue(wired.container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(
      putRequest({ enabled: true }, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'optimistic_lock_conflict',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    })
    expect(store.setValue).not.toHaveBeenCalled()
  })
})

describe('agent_orchestrator.otelExportSettings.update', () => {
  test('writes the tenant row and logs before/after', async () => {
    const store = makeConfigStore({ enabled: false })
    const { container } = makeContainer({ store })

    const { result, log } = await runUpdate(container, { enabled: true })

    expect(store.setValue).toHaveBeenCalledWith(
      OTEL_EXPORT_CONFIG_MODULE,
      OTEL_EXPORT_CONFIG_NAME,
      expect.objectContaining({ enabled: true }),
      { tenantId: TENANT },
    )
    expect(result).toMatchObject({ source: 'tenant', updatedAt: store.settingsRow()?.updatedAt })
    expect(log).toMatchObject({
      actionLabel: 'Update OTel export settings',
      resourceKind: 'agent_orchestrator.otel_export_settings',
      resourceId: TENANT,
      tenantId: TENANT,
      snapshotBefore: { enabled: false },
      snapshotAfter: expect.objectContaining({ enabled: true }),
    })
  })

  test('undo restores the previous value', async () => {
    const store = makeConfigStore({ enabled: true, exportUserIds: true })
    const { container } = makeContainer({ store })
    const { ctx, input, logEntry } = await runUpdate(container, { enabled: false })

    await updateOtelExportSettingsCommand.undo!({ input, ctx, logEntry })

    expect(store.settingsRow()?.value).toEqual({ enabled: true, exportUserIds: true })
  })

  test('undo of the first save clears the tenant row', async () => {
    const store = makeConfigStore()
    const { container } = makeContainer({ store })
    const { ctx, input, logEntry } = await runUpdate(container, { enabled: true })

    await updateOtelExportSettingsCommand.undo!({ input, ctx, logEntry })

    expect(store.settingsRow()?.value).toBeNull()
  })

  test('a stale lock version is rejected with the 409 conflict body', async () => {
    const store = makeConfigStore({ enabled: false })
    const { container } = makeContainer({ store })
    const request = putRequest({}, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' })

    const failure = await runUpdate(container, { enabled: true }, { request }).catch((error: unknown) => error)

    expect(isCrudHttpError(failure)).toBe(true)
    expect(failure).toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(store.setValue).not.toHaveBeenCalled()
  })

  test('refuses content export even when called directly', async () => {
    enableDeployment({ OM_AGENT_OTEL_EXPORT_CONTENT: 'allow' })
    const store = makeConfigStore()
    const { container } = makeContainer({ store })

    await expect(
      updateOtelExportSettingsCommand.execute(
        { tenantId: TENANT, settings: otelExportSettingsSchema.parse({ content: 'full' }) },
        commandCtx(container),
      ),
    ).rejects.toMatchObject({ status: 422, body: { error: 'content_export_unavailable' } })
    expect(store.setValue).not.toHaveBeenCalled()
  })

  test('refuses to write another tenant', async () => {
    const { container } = makeContainer({})
    const ctx = commandCtx(container, { auth: authOf({ tenantId: OTHER_TENANT }) as CommandRuntimeContext['auth'] })

    await expect(
      updateOtelExportSettingsCommand.execute(
        { tenantId: TENANT, settings: otelExportSettingsSchema.parse({}) },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('replay requires agents.manage', async () => {
    const store = makeConfigStore()
    const denied = makeContainer({ store, features: ['agent_orchestrator.trace.view'] })
    const { input, logEntry } = await runUpdate(denied.container, { enabled: true })

    await expect(
      updateOtelExportSettingsCommand.authorizeReplay!({
        operation: 'undo',
        input,
        ctx: commandCtx(denied.container),
        logEntry,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const granted = makeContainer({ store, features: [MANAGE] })
    await expect(
      updateOtelExportSettingsCommand.authorizeReplay!({
        operation: 'undo',
        input,
        ctx: commandCtx(granted.container),
        logEntry,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('POST /otel-export/test', () => {
  test('403 without agents.manage', async () => {
    enableDeployment()
    const { container } = makeContainer({ features: ['agent_orchestrator.trace.view'] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    expect((await postTestSpan(testRequest())).status).toBe(403)
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('409 when the deployment switch is off', async () => {
    const { container, consume } = makeContainer({ features: [MANAGE] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await postTestSpan(testRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'otel_export_disabled' })
    expect(consume).not.toHaveBeenCalled()
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('429 when the tenant ceiling is spent', async () => {
    enableDeployment()
    const consume = jest.fn(async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 8_000 }))
    const { container } = makeContainer({ features: [MANAGE], consume })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await postTestSpan(testRequest())

    expect(response.status).toBe(429)
    expect(consume).toHaveBeenCalledWith(
      `tenant:${TENANT}`,
      expect.objectContaining({ points: 1, duration: 10, keyPrefix: 'agent_orchestrator:otel_export_test' }),
    )
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('sends one synthetic span and records success', async () => {
    enableDeployment()
    postOtlpTraces.mockResolvedValue({
      outcome: 'ok',
      httpStatus: 200,
      retryAfterMs: null,
      errorCode: null,
      latencyMs: 12,
    })
    const { container, store } = makeContainer({ features: [MANAGE] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await postTestSpan(testRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, httpStatus: 200, latencyMs: 12, errorCode: null })
    expect(postOtlpTraces).toHaveBeenCalledTimes(1)
    const call = postOtlpTraces.mock.calls[0][0] as PostOtlpTracesInput
    expect(call.endpoint).toBe(ENDPOINT)
    expect(call.headers).toEqual({ authorization: `Bearer ${HEADER_SECRET}` })
    const sent = JSON.parse(call.body)
    const resource = sent.resourceSpans[0].resource.attributes as Array<{ key: string; value: { stringValue?: string } }>
    const attributeMap = Object.fromEntries(resource.map((entry) => [entry.key, entry.value.stringValue]))
    expect(attributeMap).toMatchObject({
      'service.name': 'open-mercato-agents',
      'om.tenant.id': TENANT,
      'om.organization.id': ORG,
    })
    const spans = sent.resourceSpans[0].scopeSpans[0].spans
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('om.export.test')
    expect(spans[0].traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(spans[0].spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(spans[0].traceId).not.toMatch(/^0+$/)
    expect(spans[0].spanId).not.toMatch(/^0+$/)
    expect(store.healthRow()?.value).toMatchObject({ lastSuccessAt: expect.any(String), lastErrorCode: null })
  })

  test('reports a backend rejection as ok false and records the error', async () => {
    enableDeployment()
    postOtlpTraces.mockResolvedValue({
      outcome: 'drop',
      httpStatus: 401,
      retryAfterMs: null,
      errorCode: 'http_401',
      latencyMs: 30,
    })
    const { container, store } = makeContainer({ features: [MANAGE] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await postTestSpan(testRequest())
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(text)).toEqual({ ok: false, httpStatus: 401, latencyMs: 30, errorCode: 'http_401' })
    expect(text).not.toContain(HEADER_SECRET)
    expect(text).not.toContain('collector.example.test')
    expect(store.healthRow()?.value).toMatchObject({ lastErrorAt: expect.any(String), lastErrorCode: 'http_401' })
  })
})
