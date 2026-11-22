import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { getDataSyncAdapter, registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { register } from '../di'
import { xeroContactsAdapter } from '../lib/contacts/adapter'
import { createXeroHealthCheck } from '../lib/health'
import { XERO_PROVIDER_KEY } from '../lib/constants'

jest.mock('../lib/contacts/adapter', () => ({ xeroContactsAdapter: { providerKey: 'xero' } }))
const healthCheck = { check: jest.fn() }
jest.mock('../lib/health', () => ({ createXeroHealthCheck: jest.fn(() => healthCheck) }))

const credentialsService = { resolve: jest.fn() }
const grantService = { inspectGrant: jest.fn() }

function containerWithIntegrationServices() {
  const container = createContainer()
  container.register({
    integrationCredentialsService: asValue(credentialsService),
    integrationOAuthGrantService: asValue(grantService),
  })
  return container
}

const adapterRegistryKey = Symbol.for('@open-mercato/data-sync/adapter-registry')
const registryHost = globalThis as unknown as Record<string | symbol, unknown>
let previousRegistry: unknown

beforeEach(() => {
  previousRegistry = registryHost[adapterRegistryKey]
  delete registryHost[adapterRegistryKey]
})

afterEach(() => {
  if (previousRegistry === undefined) delete registryHost[adapterRegistryKey]
  else registryHost[adapterRegistryKey] = previousRegistry
})

describe('sync_xero DI registrar', () => {
  it('is marked process-safe', () => {
    expect(getProcessDiRegistrar(register)).toBeDefined()
  })

  it('publishes the contacts adapter only once the process root activates', () => {
    const liveAdapter = { ...xeroContactsAdapter }
    registerDataSyncAdapter(liveAdapter)
    const root = containerWithIntegrationServices()
    getProcessDiRegistrar(register)!(root)
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(liveAdapter)
    runProcessActivations(root)
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(xeroContactsAdapter)
  })

  it('registers the adapter immediately through the legacy entry point', () => {
    register(containerWithIntegrationServices())
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(xeroContactsAdapter)
  })

  it('builds the health check per request scope from the scope integration services', async () => {
    const root = containerWithIntegrationServices()
    register(root)
    const scope = root.createScope()
    await scope.resolve<{ check: (...args: unknown[]) => unknown }>('xeroHealthCheck').check(null, {})
    expect(createXeroHealthCheck).toHaveBeenCalledWith({ credentialsService, grantService })
    expect(healthCheck.check).toHaveBeenCalledTimes(1)
  })
})
