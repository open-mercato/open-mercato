import { createTillioClient } from '../lib/client'
import { TillioApiError } from '../lib/errors'
import { TILLIO_INTEGRATION_ID } from '../integration'
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
// These cases drive one attach at a time, so the section needs no serialization; the advisory
// lock itself needs a database and is exercised where the route wires it.
const passThroughLock = <T>(run: () => Promise<T>): Promise<T> => run()
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

    const record = await attachOperator({ credentialsService: service, scope, appUrl, withLock: passThroughLock }, {
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

    await expect(attachOperator({ credentialsService: service, scope, appUrl, withLock: passThroughLock }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toBeInstanceOf(TillioOperatorLimitError)
    expect(client.validateConfig).not.toHaveBeenCalled()
  })

  it('rejects when the environment is not ready', async () => {
    const client = mockClient()
    const { service } = fakeStore({ [TILLIO_INTEGRATION_ID]: { apiUrl: 'https://a.example.com', apiKey: 'k' } })

    await expect(attachOperator({ credentialsService: service, scope, appUrl, withLock: passThroughLock }, { plugin: 'Ringostat', config: { key: 'k' } }))
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

    await expect(attachOperator({ credentialsService: service, scope, appUrl, withLock: passThroughLock }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toThrow('disk full')
    expect(client.deleteConfig).toHaveBeenCalledWith('Ringostat', 'tok-1', 'app.example.com/OM-x-ringostat-1')
  })

  it('gives up rather than overwriting an operator a concurrent attach stored first', async () => {
    const client = mockClient()
    const store: Record<string, Record<string, unknown> | null> = { [TILLIO_INTEGRATION_ID]: { ...readyEnv } }
    let reads = 0
    const service: TillioCredentialsService = {
      getRaw: jest.fn(async (id: string) => {
        // The second read is the one taken right before the write: by then a concurrent
        // attach has already stored its operator.
        if (id === TILLIO_OPERATORS_INTEGRATION_ID && ++reads === 2) {
          return {
            operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'other' }, token: 'other-token', tenantDomain: 'd', envFingerprint: 'fp' }],
            defaultOperatorId: 'ringostat-1',
          }
        }
        return store[id] ?? null
      }),
      save: jest.fn(async (id: string, credentials: Record<string, unknown>) => {
        store[id] = credentials
      }),
    }

    await expect(attachOperator({ credentialsService: service, scope, appUrl, withLock: passThroughLock }, { plugin: 'Ringostat', config: { key: 'k' } }))
      .rejects.toBeInstanceOf(TillioOperatorLimitError)
    expect(client.deleteConfig).toHaveBeenCalledWith('Ringostat', 'tok-1', 'app.example.com/OM-x-ringostat-1')
    expect(store[TILLIO_OPERATORS_INTEGRATION_ID]).toBeUndefined()
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

    expect(result).toEqual({ ok: true, detached: true, revoked: true })
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

    expect(result).toEqual({ ok: true, detached: false, revoked: false })
    expect(client.deleteConfig).not.toHaveBeenCalled()
  })

  it('keeps the operator when the provider refuses the revocation', async () => {
    const providerMessage = 'provider response from https://internal.example.invalid: token secret-token'
    mockClient({ deleteConfig: jest.fn().mockRejectedValue(new TillioApiError(providerMessage, 422, 'invalid')) })
    const { service, store } = fakeStore({
      [TILLIO_INTEGRATION_ID]: { ...readyEnv },
      [TILLIO_OPERATORS_INTEGRATION_ID]: {
        operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'x' }, token: 'tok-1', tenantDomain: 'd', envFingerprint: 'fp' }],
        defaultOperatorId: 'ringostat-1',
      },
    })

    await expect(detachOperator({ credentialsService: service, scope }, 'ringostat-1'))
      .rejects.toMatchObject({
        name: 'TillioRevocationFailedError',
        environmentMissing: false,
        message: 'Tillio did not confirm the operator token was revoked.',
      })

    const saved = store[TILLIO_OPERATORS_INTEGRATION_ID] as { operators: unknown[] }
    expect(saved.operators).toHaveLength(1)
  })

  it('keeps the operator when the environment is gone, so the token is not orphaned silently', async () => {
    const client = mockClient()
    const { service, store } = fakeStore({
      [TILLIO_OPERATORS_INTEGRATION_ID]: {
        operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'x' }, token: 'tok-1', tenantDomain: 'd', envFingerprint: 'fp' }],
        defaultOperatorId: 'ringostat-1',
      },
    })

    await expect(detachOperator({ credentialsService: service, scope }, 'ringostat-1'))
      .rejects.toMatchObject({ name: 'TillioRevocationFailedError', environmentMissing: true })

    expect(client.deleteConfig).not.toHaveBeenCalled()
    const saved = store[TILLIO_OPERATORS_INTEGRATION_ID] as { operators: unknown[] }
    expect(saved.operators).toHaveLength(1)
  })

  it('removes the operator on a forced detach and reports the token was not revoked', async () => {
    mockClient({ deleteConfig: jest.fn().mockRejectedValue(new TillioApiError('nope', 422, 'invalid')) })
    const { service, store } = fakeStore({
      [TILLIO_INTEGRATION_ID]: { ...readyEnv },
      [TILLIO_OPERATORS_INTEGRATION_ID]: {
        operators: [{ id: 'ringostat-1', plugin: 'Ringostat', config: { key: 'x' }, token: 'tok-1', tenantDomain: 'd', envFingerprint: 'fp' }],
        defaultOperatorId: 'ringostat-1',
      },
    })

    const result = await detachOperator({ credentialsService: service, scope }, 'ringostat-1', { force: true })

    expect(result).toEqual({ ok: true, detached: true, revoked: false })
    const saved = store[TILLIO_OPERATORS_INTEGRATION_ID] as { operators: unknown[] }
    expect(saved.operators).toHaveLength(0)
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
