/** @jest-environment node */
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { GET, PUT, metadata, openApi } from '../api/trace-capture/settings/route'
import {
  UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID,
  updateTraceCapturePolicyCommand,
} from '../commands/traceCapture'
import { TRACE_CAPTURE_CONFIG_MODULE, TRACE_CAPTURE_CONFIG_NAME } from '../lib/trace/capturePolicy'
import { traceCapturePolicySchema } from '../data/validators'

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

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const FULL_FEATURES = ['agent_orchestrator.agents.manage', 'agent_orchestrator.trace.view_content']

type StoredRow = { value: unknown; updatedAt: string }

function makeConfigStore(initial?: unknown) {
  const rows = new Map<string, StoredRow>()
  let tick = 0
  const nextStamp = () => new Date(Date.UTC(2026, 9, 27, 10, 0, tick++)).toISOString()
  if (initial !== undefined) rows.set(TENANT, { value: initial, updatedAt: nextStamp() })
  const getRecord = jest.fn(async (_module: string, _name: string, scope?: { tenantId?: string | null }) => {
    const row = rows.get(scope?.tenantId ?? '')
    return row ? { value: row.value, source: 'tenant', updatedAt: row.updatedAt } : null
  })
  const setValue = jest.fn(
    async (_module: string, _name: string, value: unknown, scope?: { tenantId?: string | null }) => {
      const row = { value: value ?? null, updatedAt: nextStamp() }
      rows.set(scope?.tenantId ?? '', row)
      return { value: row.value, source: 'tenant', updatedAt: row.updatedAt }
    },
  )
  return { rows, getRecord, setValue }
}

function makeContainer(options: {
  store?: ReturnType<typeof makeConfigStore>
  features?: string[]
  isSuperAdmin?: boolean
  execute?: jest.Mock
}) {
  const store = options.store ?? makeConfigStore()
  const loadAcl = jest.fn(async () => ({
    isSuperAdmin: options.isSuperAdmin ?? false,
    features: options.features ?? [],
    organizations: null,
  }))
  const execute = options.execute ?? jest.fn()
  const container = {
    resolve: (token: string) => {
      if (token === 'moduleConfigService') return { getRecord: store.getRecord, setValue: store.setValue }
      if (token === 'rbacService') return { loadAcl }
      if (token === 'commandBus') return { execute }
      throw new Error(`Unexpected DI token in test: ${token}`)
    },
  }
  return { container, store, loadAcl, execute }
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
  return new Request('http://localhost/api/agent_orchestrator/trace-capture/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function runUpdate(
  container: ReturnType<typeof makeContainer>['container'],
  policyInput: Record<string, unknown>,
  ctxOverrides: Partial<CommandRuntimeContext> = {},
) {
  const input = { tenantId: TENANT, policy: traceCapturePolicySchema.parse(policyInput) }
  const ctx = commandCtx(container, ctxOverrides)
  const prepared = await updateTraceCapturePolicyCommand.prepare!(input, ctx)
  const result = await updateTraceCapturePolicyCommand.execute(input, ctx)
  const log = await updateTraceCapturePolicyCommand.buildLog!({
    input,
    result,
    ctx,
    snapshots: { before: prepared?.before },
  })
  const logEntry: CommandUndoLogEntry = {
    commandId: UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID,
    commandPayload: log?.payload ?? null,
    snapshotBefore: log?.snapshotBefore ?? null,
    snapshotAfter: log?.snapshotAfter ?? null,
    tenantId: TENANT,
  }
  return { input, ctx, result, log, logEntry }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.OM_AGENT_TRACE_CONTENT_DEFAULT
  delete process.env.OM_AGENT_TRACE_CONTENT_MAX
})

describe('GET /trace-capture/settings', () => {
  test('returns the inherited policy with the deployment levels', async () => {
    const { container } = makeContainer({})
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())
    process.env.OM_AGENT_TRACE_CONTENT_MAX = 'metadata'

    const response = await GET(new Request('http://localhost/x'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      policy: traceCapturePolicySchema.parse({}),
      source: 'default',
      deploymentDefault: 'metadata',
      deploymentCeiling: 'metadata',
      updatedAt: null,
    })
  })

  test('returns the tenant row and its version', async () => {
    const store = makeConfigStore({ level: 'off' })
    const { container } = makeContainer({ store })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const body = await (await GET(new Request('http://localhost/x'))).json()

    expect(body.source).toBe('tenant')
    expect(body.policy.level).toBe('off')
    expect(body.updatedAt).toBe(store.rows.get(TENANT)?.updatedAt)
    expect(store.getRecord).toHaveBeenCalledWith(TRACE_CAPTURE_CONFIG_MODULE, TRACE_CAPTURE_CONFIG_NAME, {
      tenantId: TENANT,
    })
  })

  test('rejects an anonymous caller', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/x'))).status).toBe(401)
  })
})

describe('PUT /trace-capture/settings', () => {
  test('declares both write features in metadata and documents the route', () => {
    expect(metadata.GET.requireFeatures).toEqual(['agent_orchestrator.trace.view'])
    expect(metadata.PUT.requireFeatures).toEqual(FULL_FEATURES)
    expect(openApi.methods?.GET).toBeDefined()
    expect(openApi.methods?.PUT).toBeDefined()
  })

  test('403 without trace.view_content, before reading the body', async () => {
    const { container, execute } = makeContainer({ features: ['agent_orchestrator.agents.manage'] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(putRequest({ level: 'full' }))

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  test('403 without agents.manage', async () => {
    const { container } = makeContainer({ features: ['agent_orchestrator.trace.view_content'] })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    expect((await PUT(putRequest({ level: 'full' }))).status).toBe(403)
  })

  test('400 on an invalid body', async () => {
    const { container, execute } = makeContainer({ features: FULL_FEATURES })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const invalid = await PUT(putRequest({ level: 'everything' }))
    const malformed = await PUT(putRequest('{not json'))

    expect(invalid.status).toBe(400)
    expect(malformed.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  test('400 without a tenant scope', async () => {
    getAuthFromRequest.mockResolvedValue(authOf({ tenantId: null }))
    expect((await PUT(putRequest({ level: 'off' }))).status).toBe(400)
  })

  test('saves through the update command', async () => {
    const execute = jest.fn(async () => ({
      result: {
        policy: traceCapturePolicySchema.parse({ level: 'off' }),
        source: 'tenant',
        updatedAt: '2026-10-27T10:00:00.000Z',
      },
      logEntry: null,
    }))
    const { container } = makeContainer({ features: ['agent_orchestrator.*'], execute })
    createRequestContainer.mockResolvedValue(container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(putRequest({ level: 'off' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledWith(
      UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID,
      expect.objectContaining({
        input: { tenantId: TENANT, policy: traceCapturePolicySchema.parse({ level: 'off' }) },
      }),
    )
    expect(body).toMatchObject({
      source: 'tenant',
      updatedAt: '2026-10-27T10:00:00.000Z',
      deploymentDefault: 'metadata',
      deploymentCeiling: 'full',
    })
  })

  test('maps a command conflict to its status and body', async () => {
    const store = makeConfigStore({ level: 'metadata' })
    const execute = jest.fn(async (_id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => ({
      result: await updateTraceCapturePolicyCommand.execute(
        options.input as Parameters<typeof updateTraceCapturePolicyCommand.execute>[0],
        options.ctx,
      ),
      logEntry: null,
    }))
    const wired = makeContainer({ store, features: FULL_FEATURES, execute })
    createRequestContainer.mockResolvedValue(wired.container)
    getAuthFromRequest.mockResolvedValue(authOf())

    const response = await PUT(
      putRequest({ level: 'full' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ code: 'optimistic_lock_conflict', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
    expect(store.setValue).not.toHaveBeenCalled()
  })
})

describe('agent_orchestrator.traceCapturePolicy.update', () => {
  test('writes the tenant row and logs before/after', async () => {
    const store = makeConfigStore({ level: 'metadata' })
    const { container } = makeContainer({ store })

    const { result, log } = await runUpdate(container, { level: 'full' })

    expect(store.setValue).toHaveBeenCalledWith(
      TRACE_CAPTURE_CONFIG_MODULE,
      TRACE_CAPTURE_CONFIG_NAME,
      expect.objectContaining({ level: 'full' }),
      { tenantId: TENANT },
    )
    expect(result).toMatchObject({ source: 'tenant', updatedAt: store.rows.get(TENANT)?.updatedAt })
    expect(log).toMatchObject({
      resourceKind: 'agent_orchestrator.trace_capture_policy',
      resourceId: TENANT,
      tenantId: TENANT,
      snapshotBefore: { level: 'metadata' },
      snapshotAfter: expect.objectContaining({ level: 'full' }),
    })
  })

  test('undo restores the previous value', async () => {
    const store = makeConfigStore({ level: 'metadata', retentionDays: 7 })
    const { container } = makeContainer({ store })
    const { ctx, input, logEntry } = await runUpdate(container, { level: 'full' })

    await updateTraceCapturePolicyCommand.undo!({ input, ctx, logEntry })

    expect(store.rows.get(TENANT)?.value).toEqual({ level: 'metadata', retentionDays: 7 })
  })

  test('undo of the first save clears the tenant row', async () => {
    const store = makeConfigStore()
    const { container } = makeContainer({ store })
    const { ctx, input, logEntry } = await runUpdate(container, { level: 'full' })

    await updateTraceCapturePolicyCommand.undo!({ input, ctx, logEntry })

    expect(store.rows.get(TENANT)?.value).toBeNull()
  })

  test('a stale lock version is rejected with the 409 conflict body', async () => {
    const store = makeConfigStore({ level: 'metadata' })
    const { container } = makeContainer({ store })
    const request = putRequest({}, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' })

    const failure = await runUpdate(container, { level: 'full' }, { request }).catch((error: unknown) => error)

    expect(isCrudHttpError(failure)).toBe(true)
    expect(failure).toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(store.setValue).not.toHaveBeenCalled()
  })

  test('a matching lock version saves', async () => {
    const store = makeConfigStore({ level: 'metadata' })
    const { container } = makeContainer({ store })
    const current = store.rows.get(TENANT)?.updatedAt ?? ''
    const request = putRequest({}, { [OPTIMISTIC_LOCK_HEADER_NAME]: current })

    await runUpdate(container, { level: 'off' }, { request })

    expect(store.rows.get(TENANT)?.value).toEqual(expect.objectContaining({ level: 'off' }))
  })

  test('refuses to write another tenant', async () => {
    const { container } = makeContainer({})
    const ctx = commandCtx(container, { auth: authOf({ tenantId: OTHER_TENANT }) as CommandRuntimeContext['auth'] })

    await expect(
      updateTraceCapturePolicyCommand.execute(
        { tenantId: TENANT, policy: traceCapturePolicySchema.parse({}) },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('replay requires both write features', async () => {
    const store = makeConfigStore()
    const denied = makeContainer({ store, features: ['agent_orchestrator.agents.manage'] })
    const { input, logEntry } = await runUpdate(denied.container, { level: 'full' })

    await expect(
      updateTraceCapturePolicyCommand.authorizeReplay!({
        operation: 'undo',
        input,
        ctx: commandCtx(denied.container),
        logEntry,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const granted = makeContainer({ store, features: FULL_FEATURES })
    await expect(
      updateTraceCapturePolicyCommand.authorizeReplay!({
        operation: 'undo',
        input,
        ctx: commandCtx(granted.container),
        logEntry,
      }),
    ).resolves.toBeUndefined()
  })
})
