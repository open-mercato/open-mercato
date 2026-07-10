import { createTillioClient } from '../lib/client'
import { TillioApiError } from '../lib/errors'
import { TILLIO_INTEGRATION_ID } from '../lib/environment'
import { TILLIO_OPERATORS_INTEGRATION_ID, type TillioCredentialsService } from '../lib/operators-store'
import {
  attachOperator,
  classifyTillioError,
  detachOperator,
  TillioEnvironmentNotReadyError,
  TillioOperatorLimitError,
} from '../lib/operators'

jest.mock('../lib/client', () => ({
  createTillioClient: jest.fn(),
}))

const createTillioClientMock = createTillioClient as jest.MockedFunction<typeof createTillioClient>

const scope = { tenantId: 'tn', organizationId: 'org' }
const appUrl = 'https://app.example.com'
const readyEnv = { apiUrl: 'https://a.example.com', apiKey: 'k', tenantSystemId: 'OM-x' }

function fakeStore(initial: Record<string, Record<string, unknown> | null> = {}): {
  service: TillioCredentialsService
  store: Record<string, Record<string, unknown> | null>
} {
  const store: Record<string, Record<string, unknown> | null> = { ...initial }
  return {
    store,
    service: {
      getRaw: jest.fn(async (id: string) => store[id] ?? null),
      save: jest.fn(async (id: string, credentials: Record<string, unknown>) => {
        store[id] = credentials
      }),
    },
  }
}

function mockClient(overrides: Partial<{
  validateConfig: jest.Mock
  addConfig: jest.Mock
  deleteConfig: jest.Mock
}> = {}) {
  const client = {
    validateConfig: overrides.validateConfig ?? jest.fn().mockResolvedValue(undefined),
    addConfig: overrides.addConfig ?? jest.fn().mockResolvedValue({ token: 'tok-1' }),
    deleteConfig: overrides.deleteConfig ?? jest.fn().mockResolvedValue(undefined),
  }
  createTillioClientMock.mockReturnValue(client as unknown as ReturnType<typeof createTillioClient>)
  return client
}

beforeEach(() => {
  createTillioClientMock.mockReset()
})

describe('attachOperator', () => {
  it('validates, provisions, and persists the operator with an env fingerprint', async () => {
    const client = mockClient()
    const { service, store } = fakeStore({ [TILLIO_INTEGRATION_ID]: { ...readyEnv } })

    const record = await attachOperator({ credentialsService: service, scope, appUrl }, {
      plugin: 'Ringostat',
      config: { key: 'ringo-key' },
    })

    expect(client.validateConfig).toHaveBeenCalledWith('Ringostat', { key: 'ringo-key' }, 'app.example.com/OM-x-ringostat-1')
    expect(client.addConfig).toHaveBeenCalledWith('Ringostat', { key: 'ringo-key' }, 'app.example.com/OM-x-ringostat-1')
    expect(record.id).toBe('ringostat-1')
    expect(record.token).toBe('tok-1')
    expect(record.tenantDomain).toBe('app.example.com/OM-x-ringostat-1')
    expect(record.envFingerprint).toEqual(expect.any(String))

    const saved = store[TILLIO_OPERATORS_INTEGRATION_ID] as { operators: unknown[]; defaultOperatorId: string }
    expect(saved.operators).toHaveLength(1)
    expect(saved.defaultOperatorId).toBe('ringostat-1')
  })

  it('rejects a second operator (one at a time)', async () => {
    const client = mockClient()
    const { service } = fakeStore({
      [TILLIO_INTEGRATION_ID]: { ...readyEnv },
      [TILLIO_OPERATORS_INTEGRATION_ID]: {
        operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'x' }, token: 't', tenantDomain: 'd', envFingerprint: 'fp' }],
        defaultOperatorId: 'ringostat-1',
      },
    })

    await expect(attachOperator({ credentialsService: service, scope, appUrl }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toBeInstanceOf(TillioOperatorLimitError)
    expect(client.validateConfig).not.toHaveBeenCalled()
  })

  it('rejects when the environment is not ready', async () => {
    const client = mockClient()
    const { service } = fakeStore({ [TILLIO_INTEGRATION_ID]: { apiUrl: 'https://a.example.com', apiKey: 'k' } })

    await expect(attachOperator({ credentialsService: service, scope, appUrl }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toBeInstanceOf(TillioEnvironmentNotReadyError)
    expect(client.addConfig).not.toHaveBeenCalled()
  })

  it('compensates with deleteConfig when persistence fails', async () => {
    const client = mockClient()
    const store: Record<string, Record<string, unknown> | null> = { [TILLIO_INTEGRATION_ID]: { ...readyEnv } }
    const service: TillioCredentialsService = {
      getRaw: jest.fn(async (id: string) => store[id] ?? null),
      save: jest.fn(async (id: string) => {
        if (id === TILLIO_OPERATORS_INTEGRATION_ID) throw new Error('disk full')
      }),
    }

    await expect(attachOperator({ credentialsService: service, scope, appUrl }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toThrow('disk full')
    expect(client.deleteConfig).toHaveBeenCalledWith('Ringostat', 'tok-1', 'app.example.com/OM-x-ringostat-1')
  })
})

describe('detachOperator', () => {
  it('revokes the token and removes the operator', async () => {
    const client = mockClient()
    const { service, store } = fakeStore({
      [TILLIO_INTEGRATION_ID]: { ...readyEnv },
      [TILLIO_OPERATORS_INTEGRATION_ID]: {
        operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'x' }, token: 'tok-1', tenantDomain: 'app.example.com/OM-x-ringostat-1', envFingerprint: 'fp' }],
        defaultOperatorId: 'ringostat-1',
      },
    })

    const result = await detachOperator({ credentialsService: service, scope }, 'ringostat-1')

    expect(result).toEqual({ ok: true, detached: true })
    expect(client.deleteConfig).toHaveBeenCalledWith('Ringostat', 'tok-1', 'app.example.com/OM-x-ringostat-1')
    const saved = store[TILLIO_OPERATORS_INTEGRATION_ID] as { operators: unknown[]; defaultOperatorId: string | null }
    expect(saved.operators).toHaveLength(0)
    expect(saved.defaultOperatorId).toBeNull()
  })

  it('is a no-op for an unknown operator id', async () => {
    const client = mockClient()
    const { service } = fakeStore({
      [TILLIO_INTEGRATION_ID]: { ...readyEnv },
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [], defaultOperatorId: null },
    })

    const result = await detachOperator({ credentialsService: service, scope }, 'missing')

    expect(result).toEqual({ ok: true, detached: false })
    expect(client.deleteConfig).not.toHaveBeenCalled()
  })
})

describe('classifyTillioError', () => {
  it('attributes transport/auth failures to the environment', () => {
    expect(classifyTillioError(new TillioApiError('x', 0, 'network'))).toBe('environment')
    expect(classifyTillioError(new TillioApiError('x', 401, 'unauthorized'))).toBe('environment')
    expect(classifyTillioError(new TillioApiError('x', 403, 'forbidden'))).toBe('environment')
  })

  it('attributes config failures to the operator', () => {
    expect(classifyTillioError(new TillioApiError('x', 422, 'invalid'))).toBe('operator')
    expect(classifyTillioError(new Error('boom'))).toBe('operator')
  })
})
