import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../../resolver'
import { generateModuleRegistries } from '../module-registry'

const modulePath = 'app/src/modules/example'
const originalRoute = `
  import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
  export const crudRoute = makeCrudRoute({
    metadata: { PUT: { requireAuth: true } },
    orm: { entity: ExampleRecord },
    actions: { update: { commandId: 'example.records.update' } },
  })
  export const { metadata, PUT } = crudRoute
`

let root: string

function write(file: string, source: string): void {
  const target = path.join(root, modulePath, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function generate() {
  const appRoot = path.join(root, 'app')
  const output = path.join(appRoot, '.mercato', 'generated')
  const resolver: PackageResolver = {
    isMonorepo: () => true,
    getRootDir: () => root,
    getAppDir: () => appRoot,
    getOutputDir: () => output,
    getModulesConfigPath: () => path.join(appRoot, 'src/modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => [{ id: 'example', from: '@app' }],
    getModulePaths: () => ({ appBase: path.join(root, modulePath), pkgBase: path.join(root, 'package') }),
    getModuleImportBase: () => ({ appBase: '@/modules/example', pkgBase: '@open-mercato/core/modules/example' }),
    getPackageOutputDir: () => output,
    getPackageRoot: () => path.join(root, 'package'),
  }
  return generateModuleRegistries({ resolver, quiet: true })
}

function addDerivedHost(routePath: string): void {
  write(`api/${routePath}/route.ts`, originalRoute)
  write('descriptor.client.ts', "export const crudFormSectionRuntime = { id: 'example.edit', roundTripId: 'example.edit@v1' }")
  write('form-sections.ts', `
    import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
    import { defineCrudRouteSectionHost } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'
    import { crudRoute } from './api/${routePath}/route'
    export const crudFormSections = defineCrudFormSections({
      hostFacts: [{ id: 'example.edit', roundTripId: 'example.edit@v1', hostResourceKind: 'example.records' }],
      derivedHosts: [defineCrudRouteSectionHost({
        hostId: 'example.record', formVariant: 'default', formOperation: 'update', hostDescriptorId: 'example.edit',
        route: crudRoute, sections: [{ id: 'details', writes: 'parent' }],
      })],
      runtimes: [{ id: 'example.edit', roundTripId: 'example.edit@v1',
        load: lazyCrudFormSectionRuntime(() => import('./descriptor.client')),
      }],
    })
  `)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-form-section-route-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

it.each(['Records/section-policy', 'records/[id]', 'records/[...rest]'])('rejects overlapping API path %s', async (pathPattern) => {
  addDerivedHost('records')
  write(`api/${pathPattern}/route.ts`, `
    export const metadata = { PUT: { requireAuth: true } }
    export async function PUT() { return new Response() }
  `)
  await expect(generate()).rejects.toThrow(/conflicts with an existing API route/)
})

it('rejects a parameterized original host route', async () => {
  addDerivedHost('records/[id]')
  await expect(generate()).rejects.toThrow(/literal API path without parameters/)
})
