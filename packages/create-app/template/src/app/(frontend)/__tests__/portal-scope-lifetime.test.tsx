import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'

const mockFind = jest.fn()
const mockOrm = { em: { fork: jest.fn(() => ({ find: mockFind })) } }
const mockDispose = jest.fn()

jest.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => name === 'x-next-url' ? '/acme/portal' : null }),
}))
jest.mock('next/link', () => ({ __esModule: true, default: 'a' }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer', () => ({
  getCustomerAuthFromCookies: async () => {
    await createRequestContainer()
    return null
  },
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization: class {} }))
jest.mock('@open-mercato/core/modules/customer_accounts/data/entities', () => ({ CustomerUser: class {} }))
jest.mock('@open-mercato/ui/portal/PortalLayoutShell', () => ({
  PortalLayoutShell: ({ children, organizationName }: { children: React.ReactNode; organizationName: string }) => (
    <main>{organizationName}{children}</main>
  ),
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({ AccessDeniedMessage: () => null }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => mockOrm }))
jest.mock('@mikro-orm/core', () => ({
  ...jest.requireActual('@mikro-orm/core'),
  RequestContext: { getEntityManager: () => null },
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args),
}))
jest.mock('@open-mercato/shared/lib/query/engine', () => ({ BasicQueryEngine: class {} }))
jest.mock('@open-mercato/shared/lib/data/engine', () => ({ DefaultDataEngine: class {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ commandRegistry: {}, CommandBus: class {} }))
jest.mock('@open-mercato/core/bootstrap', () => ({
  bootstrap: async () => {},
  bootstrapProcessRoot: async () => () => {},
  finalizeProcessRoot: async () => {},
}))
jest.mock('@open-mercato/shared/modules/overrides', () => ({
  composeDiOverrides: () => ({}),
  applyDiOverridesToContainer: () => {},
}))
jest.mock('@open-mercato/core/modules/query_index/lib/engine', () => ({ HybridQueryEngine: class {} }))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({ recordIndexerError: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({ registerTenantEncryptionSubscriber: jest.fn() }))

import FrontendLayout from '../layout'
import {
  createRequestContainer,
  initializeProcessContainer,
  invalidateProcessContainer,
  registerAppDiRegistrar,
  registerDiRegistrars,
  resetBootstrapCache,
} from '@open-mercato/shared/lib/di/container'

const originalEnvironment = {
  OM_PROCESS_CONTAINER_ROOT: process.env.OM_PROCESS_CONTAINER_ROOT,
  OM_BOOTSTRAP_CACHE: process.env.OM_BOOTSTRAP_CACHE,
  OM_CACHE_SINGLETON: process.env.OM_CACHE_SINGLETON,
  SEARCH_DISABLE_SINGLETON_CACHE: process.env.SEARCH_DISABLE_SINGLETON_CACHE,
}
let root: AppContainer | null

beforeEach(() => {
  process.env.OM_PROCESS_CONTAINER_ROOT = 'on'
  process.env.OM_BOOTSTRAP_CACHE = 'off'
  process.env.OM_CACHE_SINGLETON = 'on'
  process.env.SEARCH_DISABLE_SINGLETON_CACHE = 'off'
  jest.clearAllMocks()
  mockFind.mockResolvedValue([{ id: 'org', name: 'Acme', slug: 'acme', tenant: { id: 'tenant' } }])
  resetBootstrapCache()
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  registerDiRegistrars([defineProcessDiRegistrar((container) => {
    container.register({
      generationResource: asFunction(() => ({})).singleton().disposer(mockDispose),
      featureTogglesService: asValue({ getBoolConfig: async () => ({ ok: true, value: true }) }),
    })
    container.resolve('generationResource')
  })])
  root = null
})

afterEach(async () => {
  invalidateProcessContainer()
  await root?.dispose()
  registerDiRegistrars([])
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  resetBootstrapCache()
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

it.each([false, true])('releases the layout scope after portal lookup (failure: %s)', async (fails) => {
  if (fails) mockFind.mockRejectedValueOnce(new Error('lookup failed'))
  root = await initializeProcessContainer()

  const element = await FrontendLayout({ children: <span>child content</span> })
  expect(renderToStaticMarkup(element)).toContain('child content')
  expect(mockFind).toHaveBeenCalledTimes(1)
  expect(mockDispose).not.toHaveBeenCalled()

  invalidateProcessContainer()
  await root?.dispose()
  expect(mockDispose).toHaveBeenCalledTimes(1)
})

it('leaves independently acquired child-render scopes alive after the layout finishes', async () => {
  const childContainer = await createRequestContainer()
  root = await initializeProcessContainer()
  const element = await FrontendLayout({ children: <span>child content</span> })
  expect(renderToStaticMarkup(element)).toContain('Acme')

  invalidateProcessContainer()
  expect(childContainer.resolve('generationResource')).toBeDefined()
  expect(mockDispose).not.toHaveBeenCalled()
  await childContainer.dispose()
  await root?.dispose()
  expect(mockDispose).toHaveBeenCalledTimes(1)
})
