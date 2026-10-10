import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import {
  generateModuleRegistries,
  generateModuleRegistry,
  generateModuleRegistryApp,
  generateModuleRegistryCli,
} from '../module-registry'
import * as extensions from '../extensions'

let root: string
let outputDir: string
let nonce: number

type CapturedFiles = Record<string, { content: string; mtimeMs: number }>

function put(moduleId: string, relativePath: string, content: string, app = false): string {
  const base = app ? path.join(root, 'app', 'src', 'modules') : path.join(root, 'packages', 'core', 'src', 'modules')
  const file = path.join(base, moduleId, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  const timestamp = new Date(Date.now() + ++nonce * 1000)
  fs.utimesSync(file, timestamp, timestamp)
  return file
}

function resolver(destination = outputDir): PackageResolver {
  const enabled: ModuleEntry[] = [
    { id: 'orders', from: '@open-mercato/core' },
    { id: 'contacts', from: '@open-mercato/core' },
  ]
  return {
    isMonorepo: () => true,
    getRootDir: () => root,
    getAppDir: () => path.join(root, 'app'),
    getOutputDir: () => destination,
    getModulesConfigPath: () => path.join(root, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry) => ({
      appBase: path.join(root, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(root, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => destination,
    getPackageRoot: () => path.join(root, 'packages', 'core'),
  }
}

function capture(directory = outputDir): CapturedFiles {
  if (!fs.existsSync(directory)) return {}
  return Object.fromEntries(fs.readdirSync(directory).filter((name) => fs.statSync(path.join(directory, name)).isFile()).sort().map((name) => {
    const file = path.join(directory, name)
    return [name, { content: fs.readFileSync(file, 'utf8'), mtimeMs: fs.statSync(file).mtimeMs }]
  }))
}

function contentOf(files: CapturedFiles, matches: (name: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([name]) => matches(name)).map(([name, file]) => [name, file.content]))
}

function traceExtensionOutputs(): string[] {
  const emitted: string[] = []
  const load = extensions.loadGeneratorExtensions
  jest.spyOn(extensions, 'loadGeneratorExtensions').mockImplementation((options) => load(options).map((extension) => ({
    ...extension,
    generateOutput() {
      emitted.push(extension.id)
      return extension.generateOutput()
    },
  })))
  return emitted
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-registry-'))
  outputDir = path.join(root, 'generated')
  nonce = 0
  for (const id of ['orders', 'contacts']) {
    put(id, 'index.ts', `export const metadata = { id: '${id}' }\n`)
    put(id, `api/${id}/route.ts`, `export const metadata = { path: '/${id}' }\nexport function GET() { return null }\n`)
    put(id, `backend/${id}/page.tsx`, 'export default function Page() { return null }\n')
    put(id, `backend/${id}/page.meta.ts`, `export const metadata = { pageTitle: '${id}' }\n`)
    put(id, 'search.ts', 'export const searchConfig = { entities: [] }\n')
    put(id, 'events.ts', 'export const eventsConfig = { events: [] }\n')
    put(id, 'cli.ts', 'export default []\n')
    put(id, 'i18n/en.json', '{}\n')
  }
})

afterEach(() => {
  jest.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

it('keeps the default combined outputs byte-identical to the existing individual entrypoints', async () => {
  await generateModuleRegistry({ resolver: resolver(), quiet: true })
  await generateModuleRegistryApp({ resolver: resolver(), quiet: true })
  await generateModuleRegistryCli({ resolver: resolver(), quiet: true })
  const baseline = capture()
  const combinedDir = path.join(root, 'combined')
  await generateModuleRegistries({ resolver: resolver(combinedDir), quiet: true })
  expect(contentOf(capture(combinedDir), () => true)).toEqual(contentOf(baseline, () => true))
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  expect(capture()).toEqual(baseline)
})

it('treats an explicit empty output selection as no work', async () => {
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: [] })
  expect(capture()).toEqual({})
})

it('adds API routes without emitting extensions or changing unselected outputs and checksums', async () => {
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  const before = capture()
  put('orders', 'api/new/route.ts', "export const metadata = { path: '/new' }\nexport function POST() { return null }\n")
  const emitted = traceExtensionOutputs()
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['main', 'runtime', 'api-routes'] })
  const selected = (name: string) => /^(modules\.(generated|runtime\.generated)|subscribers\.generated|api-route)/.test(name)
  const after = capture()
  expect(after['api-routes.generated.ts'].content).toContain('/new')
  expect(after['api-routes.generated.ts'].content).toContain('/contacts')
  expect(emitted).toEqual([])
  expect(Object.fromEntries(Object.entries(after).filter(([name]) => !selected(name)))).toEqual(
    Object.fromEntries(Object.entries(before).filter(([name]) => !selected(name))),
  )
  const fullDir = path.join(root, 'full')
  await generateModuleRegistries({ resolver: resolver(fullDir), quiet: true })
  expect(contentOf(after, (name) => selected(name) && name.endsWith('.ts'))).toEqual(
    contentOf(capture(fullDir), (name) => selected(name) && name.endsWith('.ts')),
  )
})

it.each(['api', 'backend'] as const)('deletes only the selected %s route shard family', async (kind) => {
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  const before = capture()
  const selected = (name: string) => name.startsWith(`${kind}-route`)
  const removedSource = kind === 'api' ? 'api/orders/route.ts' : 'backend/orders/page.tsx'
  fs.unlinkSync(path.join(root, 'packages', 'core', 'src', 'modules', 'orders', removedSource))
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: [`${kind}-routes`] })
  const after = capture()
  expect(after[`${kind}-routes.generated.ts`].content).not.toContain(kind === 'api' ? '/orders' : '/backend/orders')
  expect(after[`${kind}-routes.generated.ts`].content).toContain(kind === 'api' ? '/contacts' : '/backend/contacts')
  const staleShards = Object.keys(before).filter((name) => name.startsWith(`${kind}-route-shard.`) && !(name in after))
  expect(staleShards.some((name) => name.endsWith('.ts'))).toBe(true)
  for (const name of staleShards.filter((entry) => entry.endsWith('.ts'))) {
    expect(after[name.replace(/\.ts$/, '.checksum')]).toBeUndefined()
  }
  expect(Object.fromEntries(Object.entries(after).filter(([name]) => !selected(name)))).toEqual(
    Object.fromEntries(Object.entries(before).filter(([name]) => !selected(name))),
  )
  const fullDir = path.join(root, 'full')
  await generateModuleRegistries({ resolver: resolver(fullDir), quiet: true })
  expect(contentOf(after, (name) => selected(name) && name.endsWith('.ts'))).toEqual(
    contentOf(capture(fullDir), (name) => selected(name) && name.endsWith('.ts')),
  )
})

it('aggregates extension-only outputs across modules and app overrides without core registries', async () => {
  put('orders', 'search.ts', 'export const searchConfig = { entities: [] }\n', true)
  const emitted = traceExtensionOutputs()
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['registry.search'] })
  const incremental = capture()
  expect(Object.keys(incremental)).toEqual(['search.generated.checksum', 'search.generated.ts'])
  expect(incremental['search.generated.ts'].content).toContain('@/modules/orders/search')
  expect(incremental['search.generated.ts'].content).toContain('@open-mercato/core/modules/contacts/search')
  expect(incremental['search.generated.ts'].content).not.toContain('@open-mercato/core/modules/orders/search')
  expect(emitted).toEqual(['registry.search'])
  const fullDir = path.join(root, 'full')
  await generateModuleRegistries({ resolver: resolver(fullDir), quiet: true })
  expect(incremental['search.generated.ts'].content).toBe(capture(fullDir)['search.generated.ts'].content)
})

it('keeps a selected unchanged output checksum stable when unrelated source mtimes change', async () => {
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['registry.search'] })
  const before = capture()
  put('orders', 'api/orders/route.ts', "export const metadata = { path: '/orders' }\nexport function GET() { return 'changed implementation' }\n")
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['registry.search'] })
  expect(capture()).toEqual(before)
})

it('reconciles locale shards only for the i18n group', async () => {
  const locale = put('orders', 'i18n/pl.json', '{}\n')
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  fs.unlinkSync(locale)
  const before = capture()
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['app'] })
  const unselectedLocaleFiles = (name: string) => name.startsWith('modules.i18n.')
  expect(Object.fromEntries(Object.entries(capture()).filter(([name]) => unselectedLocaleFiles(name)))).toEqual(
    Object.fromEntries(Object.entries(before).filter(([name]) => unselectedLocaleFiles(name))),
  )
  const results = await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['i18n'] })
  const after = capture()
  expect(after['modules.i18n.pl.generated.ts']).toBeUndefined()
  expect(after['modules.i18n.pl.generated.checksum']).toBeUndefined()
  expect(after['modules.i18n.en.generated.ts']).toBeDefined()
  expect(after['modules.i18n.loaders.generated.ts'].content).not.toContain('./modules.i18n.pl.generated')
  expect(results.flatMap((result) => result.filesWritten)).toContain(path.join(outputDir, 'modules.i18n.pl.generated.ts'))
  const fullDir = path.join(root, 'full')
  await generateModuleRegistries({ resolver: resolver(fullDir), quiet: true })
  expect(contentOf(after, (name) => unselectedLocaleFiles(name) && name.endsWith('.ts'))).toEqual(
    contentOf(capture(fullDir), (name) => unselectedLocaleFiles(name) && name.endsWith('.ts')),
  )
})

it('preserves unselected plugin ownership and reconciles it on the next full generation', async () => {
  const declaration = put('orders', 'generators.ts', `module.exports = { generatorPlugins: [{
    id: 'orders.extra', conventionFile: 'extra.ts', importPrefix: 'EXTRA',
    configExpr: (name) => name,
    outputFileName: 'extra.generated.ts',
    buildOutput: ({ importSection, entriesLiteral }) => importSection + '\\nexport const entries = [' + entriesLiteral + ']\\n',
  }] }\n`)
  put('orders', 'extra.ts', 'export const value = 1\n')
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  const before = capture()
  expect(before['extra.generated.ts']).toBeDefined()
  fs.unlinkSync(declaration)
  await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['api-routes'] })
  const after = capture()
  for (const name of ['extra.generated.ts', 'extra.generated.checksum', '.generator-plugin-outputs.json']) {
    expect(after[name]).toEqual(before[name])
  }
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  const full = capture()
  expect(full['extra.generated.ts']).toBeUndefined()
  expect(full['extra.generated.checksum']).toBeUndefined()
  expect(full['.generator-plugin-outputs.json']).toBeUndefined()
})

it('emits the aggregate command loader once without unrelated registry families', async () => {
  for (const id of ['orders', 'contacts']) {
    put(id, 'commands/create.ts', `const command = { id: '${id}.create' }\nregisterCommand(command)\n`)
  }
  const results = await generateModuleRegistries({ resolver: resolver(), quiet: true, outputGroups: ['commands'] })
  const files = capture()
  expect(Object.keys(files)).toEqual(['command-loaders.generated.checksum', 'command-loaders.generated.ts'])
  expect(files['command-loaders.generated.ts'].content).toContain('orders.create')
  expect(files['command-loaders.generated.ts'].content).toContain('contacts.create')
  expect(results.flatMap((result) => [...result.filesWritten, ...result.filesUnchanged])).toEqual([
    path.join(outputDir, 'command-loaders.generated.ts'),
  ])
})

it('renders every explicitly selected family with the same bytes as full generation', async () => {
  await generateModuleRegistries({ resolver: resolver(), quiet: true })
  const baseline = capture()
  const selectedDir = path.join(root, 'selected')
  const outputGroups = [
    'main', 'runtime', 'app', 'bootstrap', 'cli', 'frontend-routes', 'backend-routes', 'api-routes',
    'commands', 'i18n', 'supervisor', 'enabled-ids', 'bootstrap-registrations', 'plugins',
    ...extensions.loadGeneratorExtensions(resolver()).map((extension) => extension.id),
  ]
  await generateModuleRegistries({ resolver: resolver(selectedDir), quiet: true, outputGroups })
  expect(contentOf(capture(selectedDir), (name) => !name.endsWith('.checksum'))).toEqual(
    contentOf(baseline, (name) => !name.endsWith('.checksum')),
  )
})
