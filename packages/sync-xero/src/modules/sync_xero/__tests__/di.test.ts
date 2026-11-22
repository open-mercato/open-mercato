import { createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { getDataSyncAdapter, registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { register } from '../di'
import { xeroContactsAdapter } from '../lib/contacts/adapter'
import { xeroHealthCheck } from '../lib/health'
import { XERO_PROVIDER_KEY } from '../lib/constants'

jest.mock('../lib/contacts/adapter', () => ({ xeroContactsAdapter: { providerKey: 'xero' } }))
jest.mock('../lib/health', () => ({ xeroHealthCheck: { check: jest.fn() } }))

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
    const root = createContainer()
    getProcessDiRegistrar(register)!(root)
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(liveAdapter)
    expect(root.resolve('xeroHealthCheck')).toBe(xeroHealthCheck)
    runProcessActivations(root)
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(xeroContactsAdapter)
  })

  it('registers the adapter and health check immediately through the legacy entry point', () => {
    const container = createContainer()
    register(container)
    expect(getDataSyncAdapter(XERO_PROVIDER_KEY)).toBe(xeroContactsAdapter)
    expect(container.resolve('xeroHealthCheck')).toBe(xeroHealthCheck)
  })
})
