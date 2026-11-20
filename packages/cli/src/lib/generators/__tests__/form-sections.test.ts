import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleRegistries, generateModuleRegistryApp } from '../module-registry'
import { generatedDerivedCrudRouteIndex, readDerivedCrudFormSectionRouteIndex } from '../form-sections'

let root: string

function write(relativePath: string, source: string): void {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function resolver(enabled: ModuleEntry[], standalone = false): PackageResolver {
  const packageRoot = path.join(root, 'package')
  const appRoot = path.join(root, 'app')
  const output = path.join(appRoot, '.mercato', 'generated')
  return {
    isMonorepo: () => !standalone,
    getRootDir: () => root,
    getAppDir: () => appRoot,
    getOutputDir: () => output,
    getModulesConfigPath: () => path.join(appRoot, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: ({ id }) => ({
      appBase: path.join(appRoot, 'src', 'modules', id),
      pkgBase: path.join(packageRoot, standalone ? 'dist' : 'src', 'modules', id),
    }),
    getModuleImportBase: ({ id }) => ({
      appBase: `@/modules/${id}`,
      pkgBase: `@open-mercato/core/modules/${id}`,
    }),
    getPackageOutputDir: () => output,
    getPackageRoot: () => packageRoot,
  }
}

function generated(kind: 'facts' | 'runtime'): string {
  return fs.readFileSync(path.join(root, 'app/.mercato/generated', `crud-form-section-${kind}.generated.ts`), 'utf8')
}

function identity(id: string, version = 1): string {
  return JSON.stringify({ id, roundTripId: `${id}@v${version}` })
}

function declaration(
  id: string,
  options: {
    kind?: 'hostFacts' | 'contributionFacts'
    version?: number
    loaderVersion?: number
    loader?: string
    noLoader?: true
    noFact?: true
  } = {},
): string {
  const { kind = 'contributionFacts', version = 1, loaderVersion = version } = options
  const descriptor = { id, roundTripId: `${id}@v${version}` }
  const fact = options.noFact ? '' : JSON.stringify(kind === 'hostFacts' ? descriptor : {
    ...descriptor,
    address: { hostId: 'example.product', formVariant: 'default', formOperation: 'update', sectionId: 'notes' },
    operation: 'add',
    requiredCapabilities: [],
  })
  const loaderIdentity = identity(id, loaderVersion).slice(1, -1)
  const loadExpression = options.loader ?? "lazyCrudFormSectionRuntime(() => import('./descriptor.client'))"
  const loader = options.noLoader ? '' : `{ ${loaderIdentity}, load: ${loadExpression} }`
  return `
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
export const crudFormSections = defineCrudFormSections({
  ${kind}: [${fact}],
  runtimes: [${loader}],
})
`
}

function runtime(id: string, version = 1): string {
  return `export const crudFormSectionRuntime = ${identity(id, version)}`
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-form-sections-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('CrudForm section registry generation', () => {
  it('keeps server imports isolated, follows dependency order and excludes disabled modules', async () => {
    const packageModule = 'package/src/modules/shared_forms'
    const dependent = 'app/src/modules/alpha_forms'
    write(`${packageModule}/form-sections.ts`, declaration('shared.product', { kind: 'hostFacts' }))
    write(`${packageModule}/descriptor.client.tsx`, runtime('shared.product'))
    write(`${dependent}/index.ts`, "export const metadata = { requires: ['shared_forms'] }")
    write(`${dependent}/form-sections.ts`, declaration('alpha.notes'))
    write(`${dependent}/descriptor.client.ts`, runtime('alpha.notes'))
    write('app/src/modules/disabled/form-sections.ts', 'export const crudFormSections = invalid()')
    const fixture = resolver([{ id: 'alpha_forms', from: '@app' }, { id: 'shared_forms' }])
    await generateModuleRegistries({ resolver: fixture, quiet: true })

    const facts = generated('facts')
    expect(facts).toContain('from "@open-mercato/core/modules/shared_forms/form-sections"')
    expect(facts).toContain('from "../../src/modules/alpha_forms/form-sections"')
    expect(facts).toContain('fact: sections0.hostFacts[0]')
    expect(facts).toContain('fact: sections1.contributionFacts[0]')
    expect(facts).not.toMatch(/descriptor\.client|disabled/)

    const browser = generated('runtime')
    expect(browser).toContain('load: () => import("@open-mercato/core/modules/shared_forms/descriptor.client")')
    expect(browser).toContain('load: () => import("../../src/modules/alpha_forms/descriptor.client")')
    expect(browser).toContain('return runtimesById.get(id)')
    expect(browser.indexOf('id: "shared.product"')).toBeLessThan(browser.indexOf('id: "alpha.notes"'))
    expect(browser).not.toMatch(/\/form-sections"|disabled/)
    const secondRun = await generateModuleRegistries({ resolver: fixture, quiet: true })
    expect(secondRun.flatMap((result) => result.filesWritten)).toEqual([])
  })

  it('exposes only literal host surface facts to the browser registry', async () => {
    const base = 'app/src/modules/example'
    write(`${base}/form-sections.ts`, `
      import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
      export const crudFormSections = defineCrudFormSections({
        hostFacts: [{
          id: 'example.host', roundTripId: 'example.host@v1', hostResourceKind: 'example.todo',
          alternatives: [{ surface: {
            id: 'example.base', hostId: 'example.todo', formVariant: 'default', formOperation: 'update',
            orderedSectionIds: ['details'], callerIds: ['example.page'], contributionIds: [],
            ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
          }, activeDataContractIds: ['server-contract'] }],
        }],
        hostProviders: [{ hostDescriptorId: 'example.host', requireFeatures: [],
          authorizeHost: async function serverAuthorization() { return null },
        }],
        runtimes: [{ id: 'example.host', roundTripId: 'example.host@v1',
          load: lazyCrudFormSectionRuntime(() => import('./descriptor.client')),
        }],
      })
    `)
    write(`${base}/descriptor.client.ts`, runtime('example.host'))
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })

    expect(generated('facts')).toContain('crudFormSectionServerModules')
    expect(generated('runtime')).toContain('crudFormSectionClientHostFacts')
    expect(generated('runtime')).toContain('"id": "example.base"')
    expect(generated('runtime')).toContain('"hostResourceKind": "example.todo"')
    expect(generated('runtime')).not.toMatch(/serverAuthorization|server-contract/)
    expect(generated('runtime')).not.toContain('/form-sections"')
  })

  it('discovers a server-only leaf default without a browser descriptor or loader', async () => {
    const onlyDefaults = `
      import { defineCrudFormSections } from '@open-mercato/shared/modules/form-sections'
      export const crudFormSections = defineCrudFormSections({
        leafDefaultProviders: [{
          fact: { id: 'example.code-default', roundTripId: 'example.code-default@v1',
            hostId: 'example.todo', formVariant: 'default', formOperation: 'create', payloadPath: 'code', readsPayloadPaths: [] },
          resolve() { return 'server-default-value' },
        }],
      })
    `
    write('app/src/modules/example/form-sections.ts', onlyDefaults)
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('facts')).toContain('{ moduleId: "example", sections: sections0 }')
    expect(generated('runtime')).not.toMatch(/code-default|server-default-value|\/form-sections"/)
    write('app/src/modules/other/form-sections.ts', onlyDefaults)
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'example', from: '@app' }, { id: 'other', from: '@app' }]), quiet: true,
    })).rejects.toThrow(/Duplicate leaf default provider id/)
  })

  it('discovers sink declarations through the server registry and rejects mismatched owners', async () => {
    const sinkDeclaration = `
      export const crudFormSections = defineCrudFormSections({
        sinks: [defineCrudFormSectionSink({
          fact: { id: 'example.brand', roundTripId: 'example.brand@v1', ownerModuleId: 'example', atomicity: 'host-transaction' },
          schema: serverOnlySchema,
          persist: serverOnlyPersistence,
        })],
      })
    `
    const source = 'app/src/modules/example/form-sections.ts'
    write(source, sinkDeclaration)
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('facts')).toContain('{ moduleId: "example", sections: sections0 }')
    expect(generated('runtime')).not.toMatch(/example.brand|serverOnly|\/form-sections"/)
    write(source, sinkDeclaration.replace("ownerModuleId: 'example'", "ownerModuleId: 'other'"))
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true,
    })).rejects.toThrow(/sink "example.brand" must be declared in its owning module/)
  })

  it('reads standalone npm dist .js declarations and runtime exports without a source mirror', async () => {
    const base = 'package/dist/modules/installed'
    write(`${base}/form-sections.js`, declaration('installed.notes')
      .replace('export const crudFormSections', 'const crudFormSections')
      .replace('./descriptor.client', './descriptor.client.js') + '\nexport { crudFormSections }\n')
    write(`${base}/descriptor.client.js`, runtime('installed.notes')
      .replace('export const crudFormSectionRuntime', 'const descriptor') + '\nexport { descriptor as crudFormSectionRuntime }\n')
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'installed' }], true), quiet: true })
    expect(generated('facts')).toContain('"@open-mercato/core/modules/installed/form-sections"')
    expect(generated('runtime')).toContain('import("@open-mercato/core/modules/installed/descriptor.client")')
  })

  it.each([
    ['missing loader', { noLoader: true as const }, 1, /fact "test.notes" has no matching runtime loader/],
    ['missing fact', { noFact: true as const }, 1, /runtime loader "test.notes" has no matching fact/],
    ['fact and loader revision mismatch', { loaderVersion: 2 }, 2, /fact and runtime roundTripId differ/],
    ['loaded descriptor revision mismatch', {}, 2, /exports "test.notes@v2" but loader declares "test.notes@v1"/],
    ['non-literal import', { loader: 'lazyCrudFormSectionRuntime(() => import(runtimePath))' }, 1, /expected a non-empty literal runtime import specifier/],
  ])('rejects %s', async (_name, options, runtimeVersion, diagnostic) => {
    const base = 'app/src/modules/test'
    write(`${base}/form-sections.ts`, declaration('test.notes', options))
    write(`${base}/descriptor.client.ts`, runtime('test.notes', runtimeVersion))
    await expect(generateModuleRegistryApp({ resolver: resolver([{ id: 'test', from: '@app' }]), quiet: true })).rejects.toThrow(diagnostic)
  })

  it('extracts named runtime helper identities without importing the client module', async () => {
    write('app/src/modules/example/form-sections.ts', declaration('example.notes'))
    write('app/src/modules/example/descriptor.client.ts', `
      import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'
      export const crudFormSectionRuntime = defineCrudFormSectionRuntime({
        id: 'example.notes', roundTripId: 'example.notes@v1', group: createClientOnlyGroup(),
      })
    `)
    await generateModuleRegistries({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('runtime')).toContain('load: () => import("../../src/modules/example/descriptor.client")')
  })

  it('rejects descriptor ids repeated across enabled modules', async () => {
    for (const moduleId of ['alpha', 'beta']) {
      write(`app/src/modules/${moduleId}/form-sections.ts`, declaration('test.notes'))
      write(`app/src/modules/${moduleId}/descriptor.client.ts`, runtime('test.notes'))
    }
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'alpha', from: '@app' }, { id: 'beta', from: '@app' }]),
      quiet: true,
    })).rejects.toThrow(/Duplicate form-sections descriptor id "test.notes" in "alpha" and "beta"/)
  })
})

const plainDerivedRoute = `
  import { z } from 'zod'
  import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
  export const crudRoute = makeCrudRoute({
    metadata: {
      POST: { requireAuth: true, requireFeatures: ['example.manage'] },
      PUT: { requireAuth: true },
      DELETE: { requireAuth: true, requireFeatures: ['example.manage'] },
    },
    orm: { entity: ExampleRecord },
    actions: {
      create: { commandId: 'example.records.create', schema: z.object({ name: z.string() }) },
      update: { commandId: 'example.records.update', mapInput: ({ parsed }) => parsed },
      delete: { commandId: 'example.records.delete' },
    },
  })
  export const { metadata, POST, PUT, DELETE } = crudRoute
`

const derivedDeclaration = `
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
import { defineCrudRouteSectionHost } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'
import { crudRoute } from './api/records/route'
export const crudFormSections = defineCrudFormSections({
  hostFacts: [{
    id: 'example.edit-rec', roundTripId: 'example.edit-rec@v1', hostResourceKind: 'example.records',
    alternatives: [{ surface: {
      id: 'example.edit-base', hostId: 'example.record', formVariant: 'default', formOperation: 'update',
      orderedSectionIds: ['details'], callerIds: [], contributionIds: [],
      ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
    } }],
  }],
  derivedHosts: [defineCrudRouteSectionHost({
    hostId: 'example.record', formVariant: 'default', formOperation: 'update', hostDescriptorId: 'example.edit-rec',
    route: crudRoute, sections: [{ id: 'details', writes: 'parent' }],
    delete: { proof: { finalInput: 'transactional-final-input/v1' } },
  })],
  runtimes: [{ id: 'example.edit-rec', roundTripId: 'example.edit-rec@v1',
    load: lazyCrudFormSectionRuntime(() => import('./descriptor.client')),
  }],
})
`

function writeDerivedFixture(base: string, declarationSource = derivedDeclaration, routeSource = plainDerivedRoute, ext = 'ts'): void {
  write(`${base}/form-sections.${ext}`, declarationSource)
  write(`${base}/api/records/route.${ext}`, routeSource)
  write(`${base}/descriptor.client.${ext}`, runtime('example.edit-rec'))
}

describe('derived CRUD section route generation', () => {
  it('emits one standalone-compatible façade into the static client, runtime, shard and docs route indices', async () => {
    writeDerivedFixture('app/src/modules/example')
    const fixture = resolver([{ id: 'example', from: '@app' }])
    await generateModuleRegistries({ resolver: fixture, quiet: true })
    const [derived] = readDerivedCrudFormSectionRouteIndex(fixture.getOutputDir())
    expect(derived).toMatchObject({ moduleId: 'example', routePath: '/example/records/section-policy', methods: ['DELETE', 'PUT'] })
    const content = fs.readFileSync(path.join(fixture.getOutputDir(), derived.fileName), 'utf8')
    expect(content).toContain('export const PUT = facade.handlers.PUT!')
    expect(content).toContain('export const DELETE = facade.handlers.DELETE!')
    expect(content).not.toContain('export const POST')
    expect(content).toContain('export const openApi = facade.openApi')
    for (const fileName of ['api-routes.generated.ts', 'api-route-metadata.generated.ts', 'modules.runtime.generated.ts']) {
      expect(fs.readFileSync(path.join(fixture.getOutputDir(), fileName), 'utf8')).toContain('/example/records/section-policy')
    }
    const docsIndex = path.join(fixture.getOutputDir(), generatedDerivedCrudRouteIndex)
    expect(fs.readFileSync(docsIndex, 'utf8')).toContain('/example/records/section-policy')
    expect(generated('facts')).toContain('bindDerivedCrudRouteSectionHosts')
    expect(generated('runtime')).toContain('"example.edit-rec.update"')
    expect(generated('runtime')).toContain('"clientMutationSurfaces"')
    expect(generated('runtime')).toContain('"routePattern": "/example/records/section-policy"')
    expect(generated('runtime')).toContain('"method": "DELETE"')
    expect(generated('runtime')).not.toContain('example.records.update')
    expect(generated('runtime')).not.toContain('createDerivedCrudFormSectionFacade')
    const second = await generateModuleRegistries({ resolver: fixture, quiet: true })
    expect(second.flatMap((result) => result.filesWritten)).toEqual([])
  })

  it('recognizes the original route binding from packaged JS', async () => {
    writeDerivedFixture('package/dist/modules/example', derivedDeclaration.replace("'./api/records/route'", "'./api/records/route.js'"), plainDerivedRoute, 'js')
    const fixture = resolver([{ id: 'example' }], true)
    await generateModuleRegistries({ resolver: fixture, quiet: true })
    const [derived] = readDerivedCrudFormSectionRouteIndex(fixture.getOutputDir())
    expect(fs.readFileSync(path.join(fixture.getOutputDir(), derived.fileName), 'utf8'))
      .toContain('@open-mercato/core/modules/example/form-sections')
  })

  it.each([
    ['secondary write', derivedDeclaration.replace("writes: 'parent'", "writes: 'child'"), plainDerivedRoute, /secondary write/],
    ['unknown route factory', derivedDeclaration, plainDerivedRoute.replace('= makeCrudRoute({', '= differentFactory({'), /named original makeCrudRoute/],
    ['custom command mapper', derivedDeclaration, plainDerivedRoute.replace('=> parsed', '=> ({ body: parsed })'), /requires direct command input/],
  ])('rejects %s as a failed qualifier', async (_name, formSource, routeSource, diagnostic) => {
    writeDerivedFixture('app/src/modules/example', formSource, routeSource)
    await expect(generateModuleRegistries({
      resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true,
    })).rejects.toThrow(diagnostic)
  })
})

it('projects a hand-written child façade without exposing its delegated command or binding definitions', async () => {
  const source = derivedDeclaration
    .replace("import { crudRoute } from './api/records/route'", '')
    .replace(/derivedHosts: \[defineCrudRouteSectionHost\(\{[\s\S]*?\}\)\],/, '')
    .replace('mutationSurfaceIds: [], dependencies: [],\n    } }]', `mutationSurfaceIds: ['example.offer.update'], dependencies: [],
    }, mutationSurfaces: [{
      id: 'example.offer.update', kind: 'section-action', requestOperation: 'update',
      guardedFacade: { method: 'PATCH', routePattern: '/example/records/[parentId]/offers/[offerId]' },
      hostResourceKind: 'example.records', mutationResourceKind: 'example.offer', optimisticLock: 'target-required',
      delegatedTarget: { kind: 'command', id: 'secret.server.command' }, resourceBindingIds: ['server.binding.v1'],
    }] }]`)
  write('app/src/modules/example/form-sections.ts', source)
  write('app/src/modules/example/descriptor.client.ts', runtime('example.edit-rec'))
  const fixture = resolver([{ id: 'example', from: '@app' }])
  await generateModuleRegistries({ resolver: fixture, quiet: true })
  expect(generated('runtime')).toContain('"routePattern": "/example/records/[parentId]/offers/[offerId]"')
  expect(generated('runtime')).toContain('"optimisticLock": "target-required"')
  expect(generated('runtime')).not.toMatch(/secret\.server\.command|server\.binding\.v1/)
})
