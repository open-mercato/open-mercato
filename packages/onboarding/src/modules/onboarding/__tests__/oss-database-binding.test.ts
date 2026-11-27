import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript-js'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { PackageResolver } from '../../../../../cli/src/lib/resolver'
import { generateModuleRegistry } from '../../../../../cli/src/lib/generators/module-registry'
import * as declarations from '@open-mercato/shared/lib/db/declarations'
import { databaseDeclarations } from '@open-mercato/core/modules/directory/database'
import { isDatabaseRuntimeEnabled } from '@open-mercato/shared/lib/db/runtime'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasPersistedWorkspace, runOnboardingIdentity } from '../lib/tenant-continuation'
import type { OnboardingRequest } from '../data/entities'

const mockDispose = jest.fn(async () => undefined)
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}), dispose: mockDispose }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const findOne = jest.mocked(findOneWithDecryption)
let fixtureRoot: string

function executeGenerated(source: string, resolve: (specifier: string) => unknown): Record<string, unknown> {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, unknown> = {}
  new Function('require', 'exports', compiled)(resolve, exports)
  return exports
}

beforeEach(async () => {
  jest.clearAllMocks()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseRuntime.v1')]
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')]
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-onboarding-binding-'))
  const ownerRoot = path.resolve(__dirname, '../../../../../core/src/modules/directory')
  const resolver: PackageResolver = {
    isMonorepo: () => true,
    getRootDir: () => fixtureRoot,
    getAppDir: () => fixtureRoot,
    getOutputDir: () => fixtureRoot,
    getModulesConfigPath: () => path.join(fixtureRoot, 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => [{ id: 'directory', from: '@open-mercato/core' }],
    getModulePaths: () => ({ appBase: path.join(fixtureRoot, 'absent'), pkgBase: ownerRoot }),
    getModuleImportBase: () => ({ appBase: '@/modules/directory', pkgBase: '@open-mercato/core/modules/directory' }),
    getPackageOutputDir: () => fixtureRoot,
    getPackageRoot: () => path.dirname(ownerRoot),
  }
  expect((await generateModuleRegistry({ resolver, quiet: true })).errors).toEqual([])
  const read = (name: string) => fs.readFileSync(path.join(fixtureRoot, name), 'utf8')
  const generated = executeGenerated(read('database-declarations.generated.ts'), (specifier) => {
    expect(specifier).toBe('@open-mercato/core/modules/directory/database')
    return { databaseDeclarations }
  })
  const bootstrap = read('bootstrap-registrations.generated.ts')
  expect(bootstrap).not.toContain('@open-mercato/enterprise')
  const registrations = executeGenerated(bootstrap, (specifier) => {
    if (specifier === './database-declarations.generated') return generated
    if (specifier === '@open-mercato/shared/lib/db/declarations') return declarations
    if (specifier === './backend-route-shards.generated') return { backendRouteFacades: [] }
    if (specifier === './frontend-routes.generated') return { frontendRoutes: [] }
    if (specifier === '@open-mercato/shared/modules/registry') return { registerBackendRouteManifests: () => undefined, registerFrontendRouteManifests: () => undefined }
    throw new Error(`Unexpected bootstrap import: ${specifier}`)
  })
  const register = registrations.runBootstrapRegistrations as () => void
  register()
})

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')]
})

test.each(['persisted', 'inactive tenant', 'foreign organization', 'inactive organization'])(
  'OSS bootstrap validates %s through real onboarding without an adapter', async (mode) => {
    expect(isDatabaseRuntimeEnabled()).toBe(false)
    findOne.mockImplementation(async (_em, entity, where) => {
      if (entity.name === 'Tenant') {
        expect(where).toEqual({ id: tenantId, isActive: true, deletedAt: null })
        return mode === 'inactive tenant' ? null : { id: tenantId }
      }
      expect(where).toEqual({ id: organizationId, tenant: tenantId, isActive: true, deletedAt: null })
      return mode === 'persisted' ? { id: organizationId } : null
    })
    const request = { tenantId, organizationId } as OnboardingRequest
    await expect(runOnboardingIdentity(() => hasPersistedWorkspace({} as EntityManager, request)))
      .resolves.toBe(mode === 'persisted')
    expect(findOne).toHaveBeenCalledTimes(mode === 'inactive tenant' ? 1 : 2)
    expect(mockDispose).toHaveBeenCalledTimes(1)
  },
)

test('missing declarations still fail closed', async () => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')]
  await expect(hasPersistedWorkspace({} as EntityManager, { tenantId, organizationId } as OnboardingRequest)).resolves.toBe(false)
  expect(findOne).not.toHaveBeenCalled()
})
