import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { getDataSyncAdapter, registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { register } from '../di'
import { xeroContactsAdapter } from '../lib/contacts/adapter'
import { createXeroHealthCheck } from '../lib/health'
import { XERO_PROVIDER_KEY } from '../lib/constants'

jest.mock('../lib/contacts/adapter', () => ({ xeroContactsAdapter: { providerKey: 'xero' } }))
jest.mock('../lib/health', () => ({ createXeroHealthCheck: jest.fn() }))

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
    expect(getProcessDiRegistrar(register)).toEqual(expect.any(Function))
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

  it('builds the health check per request scope from that scope\'s integration services', () => {
    const root = containerWithIntegrationServices()
    register(root)
    const scopeCredentials = { resolve: jest.fn() }
    const scopeGrants = { inspectGrant: jest.fn() }
    const firstScope = root.createScope()
    firstScope.register({
      integrationCredentialsService: asValue(scopeCredentials),
      integrationOAuthGrantService: asValue(scopeGrants),
    })
    const secondScope = root.createScope()
    const mockedFactory = jest.mocked(createXeroHealthCheck)
    mockedFactory.mockImplementation(() => ({ check: jest.fn() }))
    const first = firstScope.resolve<{ check: jest.Mock }>('xeroHealthCheck')
    first.check()
    const second = secondScope.resolve<{ check: jest.Mock }>('xeroHealthCheck')
    second.check()
    expect(mockedFactory).toHaveBeenNthCalledWith(1, { credentialsService: scopeCredentials, grantService: scopeGrants })
    expect(mockedFactory).toHaveBeenNthCalledWith(2, { credentialsService, grantService })
    expect(mockedFactory).toHaveBeenCalledTimes(2)
  })
})
