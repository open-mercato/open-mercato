import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  calculateGenerateWatchStructureChecksum,
  collectGenerateWatchStructureSnapshot,
  createGenerateWatchStructureCache,
  diffGenerateWatchStructureSnapshots,
  type GenerateWatchStructureOptions,
} from '../generate-watch-structure'
import { planGenerateWatchChanges, type GenerateWatchSnapshot } from '../generate-watch-plan'

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('calculateGenerateWatchStructureChecksum', () => {
  let root: string
  let appDir: string
  let pkgModule: string
  let appModule: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-generate-watch-'))
    appDir = path.join(root, 'apps', 'mercato')
    pkgModule = path.join(root, 'packages', 'core', 'src', 'modules', 'customers')
    appModule = path.join(appDir, 'src', 'modules', 'customers')
    write(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
    write(path.join(pkgModule, 'index.ts'), 'export const metadata = { id: "customers" }\n')
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export default function Page() { return null }\n')
    write(path.join(pkgModule, 'components', 'detail', 'PersonDetailTabs.tsx'), 'export function PersonDetailTabs() { return null }\n')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function checksumModule(modulesFile: string, appBase: string, packageBase: string): string {
    return calculateGenerateWatchStructureChecksum({
      modulesFile,
      moduleRoots: [{ appBase, pkgBase: packageBase }],
    })
  }

  function currentChecksum(): string {
    return checksumModule(path.join(appDir, 'src', 'modules.ts'), appModule, pkgModule)
  }

  function createStandaloneModule() {
    const standaloneRoot = path.join(root, 'standalone')
    const packageRoot = path.join(standaloneRoot, 'node_modules', '@open-mercato', 'core')
    const sourceModule = path.join(packageRoot, 'src', 'modules', 'customers')
    const distModule = path.join(packageRoot, 'dist', 'modules', 'customers')
    const standaloneAppModule = path.join(standaloneRoot, 'src', 'modules', 'customers')
    const modulesFile = path.join(standaloneRoot, 'src', 'modules.ts')
    write(modulesFile, 'export const enabledModules = ["customers"]\n')
    write(path.join(sourceModule, 'index.ts'), 'export const metadata = { id: "customers" }\n')
    write(path.join(distModule, 'index.js'), 'export const metadata = { id: "customers" }\n')
    return {
      sourceModule,
      distModule,
      appModule: standaloneAppModule,
      modulesFile,
    }
  }

  it('ignores ordinary component edits outside generator discovery paths', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'components', 'detail', 'PersonDetailTabs.tsx'), 'export function PersonDetailTabs() { return "changed" }\n')

    expect(currentChecksum()).toBe(before)
  })

  it('changes when a discovered backend page is added', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'companies', 'page.tsx'), 'export default function Page() { return null }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when route metadata changes', () => {
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.meta.ts'), 'export const metadata = { nav: { label: "People" } }\n')
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.meta.ts'), 'export const metadata = { nav: { label: "Contacts" } }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when inline page metadata changes', () => {
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export const metadata = { nav: { label: "People" } }\nexport default function Page() { return null }\n')
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export const metadata = { nav: { label: "Contacts" } }\nexport default function Page() { return null }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when a convention file changes', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'acl.ts'), 'export const features = [{ id: "customers.view" }]\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when an identical convention file moves between module roots', () => {
    const ordersPkgModule = path.join(root, 'packages', 'core', 'src', 'modules', 'orders')
    const ordersAppModule = path.join(appDir, 'src', 'modules', 'orders')
    const customersCli = path.join(pkgModule, 'cli.ts')
    const ordersCli = path.join(ordersPkgModule, 'cli.ts')
    const cliSource = 'export default function registerCli() {}\n'
    const moduleRoots = [
      { appBase: appModule, pkgBase: pkgModule },
      { appBase: ordersAppModule, pkgBase: ordersPkgModule },
    ]
    write(path.join(ordersPkgModule, 'index.ts'), 'export const metadata = { id: "orders" }\n')
    write(customersCli, cliSource)
    const before = calculateGenerateWatchStructureChecksum({
      modulesFile: path.join(appDir, 'src', 'modules.ts'),
      moduleRoots,
    })

    fs.rmSync(customersCli)
    write(ordersCli, cliSource)

    expect(calculateGenerateWatchStructureChecksum({
      modulesFile: path.join(appDir, 'src', 'modules.ts'),
      moduleRoots,
    })).not.toBe(before)
  })

  // A runtime.ts the watcher cannot see is the failure SPEC-072 exists to remove, reappearing in
  // the dev loop: the registry is not regenerated, `Module.runtime` stays undefined, and the
  // runtime never starts — with no error and no warning.
  it('changes when a module runtime is added, edited and removed', () => {
    const before = currentChecksum()
    const runtimePath = path.join(pkgModule, 'runtime.ts')

    write(runtimePath, 'export const runtime = { start: async () => {} }\n')
    const afterAdd = currentChecksum()
    expect(afterAdd).not.toBe(before)

    write(runtimePath, 'export const runtime = { roles: ["worker"], start: async () => {} }\n')
    expect(currentChecksum()).not.toBe(afterAdd)

    fs.rmSync(runtimePath)
    expect(currentChecksum()).toBe(before)
  })

  it('changes when a discovered worker is added and removed', () => {
    const before = currentChecksum()
    const workerPath = path.join(pkgModule, 'workers', 'sync-customers.ts')

    write(workerPath, 'export default async function syncCustomers() {}\n')
    const afterAdd = currentChecksum()
    expect(afterAdd).not.toBe(before)

    fs.rmSync(workerPath)
    expect(currentChecksum()).toBe(before)
  })

  it('changes when the module registry configuration changes', () => {
    const before = currentChecksum()

    write(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = ["customers"]\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('tracks generator-relevant API route changes from a standalone source mirror', () => {
    const standalone = createStandaloneModule()
    const sourceRoute = path.join(standalone.sourceModule, 'api', 'records', 'route.ts')
    const distRoute = path.join(standalone.distModule, 'api', 'records', 'route.js')
    write(
      sourceRoute,
      'export const metadata = { path: "/records" }\nexport async function GET() { return null }\n',
    )
    write(
      distRoute,
      'export const metadata = { path: "/records" };\nexport async function GET() { return null; }\n',
    )
    const before = checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)

    write(
      sourceRoute,
      'export const metadata = { path: "/contacts" }\nexport async function GET() { return null }\n',
    )
    const afterSourceMetadata = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceMetadata).not.toBe(before)

    write(
      distRoute,
      'export const metadata = { path: "/contacts" };\nexport async function GET() { return null; }\n',
    )
    const afterDistMetadata = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterDistMetadata).not.toBe(afterSourceMetadata)

    write(
      sourceRoute,
      'export const metadata = { path: "/contacts" }\nexport async function POST() { return null }\n',
    )
    const afterSourceMethod = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceMethod).not.toBe(afterDistMetadata)

    write(
      distRoute,
      'export const metadata = { path: "/contacts" };\nexport async function POST() { return null; }\n',
    )
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule))
      .not.toBe(afterSourceMethod)
  })

  it('tracks standalone source-mirror page metadata but ignores ordinary page implementation edits', () => {
    const standalone = createStandaloneModule()
    const sourcePage = path.join(standalone.sourceModule, 'backend', 'customers', 'people', 'page.tsx')
    const sourceMeta = path.join(standalone.sourceModule, 'backend', 'customers', 'people', 'page.meta.ts')
    write(sourcePage, 'export default function Page() { return null }\n')
    write(sourceMeta, 'export const metadata = { nav: { label: "People" } }\n')
    write(
      path.join(standalone.distModule, 'backend', 'customers', 'people', 'page.js'),
      'export default function Page() { return null; }\n',
    )
    write(
      path.join(standalone.distModule, 'backend', 'customers', 'people', 'page.meta.js'),
      'export const metadata = { nav: { label: "People" } };\n',
    )
    const before = checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)

    write(sourcePage, 'export default function Page() { return "implementation changed" }\n')
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)).toBe(before)

    write(sourceMeta, 'export const metadata = { nav: { label: "Contacts" } }\n')
    const afterSourceMetadata = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceMetadata).not.toBe(before)

    write(
      path.join(standalone.distModule, 'backend', 'customers', 'people', 'page.meta.js'),
      'export const metadata = { nav: { label: "Contacts" } };\n',
    )
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule))
      .not.toBe(afterSourceMetadata)
  })

  it('tracks additions and deletions enumerated from a standalone source mirror', () => {
    const standalone = createStandaloneModule()
    const before = checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)
    const sourceWorker = path.join(standalone.sourceModule, 'workers', 'sync-customers.ts')
    write(sourceWorker, 'export default async function syncCustomers() {}\n')
    write(
      path.join(standalone.distModule, 'workers', 'sync-customers.js'),
      'export default async function syncCustomers() {}\n',
    )

    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)).not.toBe(before)

    fs.rmSync(sourceWorker)
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)).toBe(before)
  })

  it('tracks stale compiled entities after the source-mirror convention is deleted', () => {
    const standalone = createStandaloneModule()
    const sourceEntities = path.join(standalone.sourceModule, 'data', 'entities.ts')
    const distEntities = path.join(standalone.distModule, 'data', 'entities.js')
    const before = checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)

    write(sourceEntities, 'export class Customer {}\n')
    const afterSourceAdd = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceAdd).not.toBe(before)

    write(distEntities, 'export class Customer {}\n')
    const afterDistAdd = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterDistAdd).not.toBe(afterSourceAdd)

    write(sourceEntities, 'export class CustomerAccount {}\n')
    const afterSourceEdit = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceEdit).not.toBe(afterDistAdd)

    write(distEntities, 'export class CustomerAccount {}\n')
    const afterDistEdit = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterDistEdit).not.toBe(afterSourceEdit)

    fs.rmSync(sourceEntities)
    const afterSourceDelete = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )
    expect(afterSourceDelete).not.toBe(afterDistEdit)
    expect(afterSourceDelete).not.toBe(before)

    fs.rmSync(distEntities)
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule))
      .toBe(before)
  })

  it('fingerprints the selected app override instead of the shadowed package route', () => {
    const standalone = createStandaloneModule()
    const routeSource = 'export const metadata = { path: "/records" }\nexport async function GET() { return null }\n'
    const packageRoute = path.join(standalone.sourceModule, 'api', 'records', 'route.js')
    const appRoute = path.join(standalone.appModule, 'api', 'records', 'route.js')
    write(packageRoute, routeSource)
    write(path.join(standalone.distModule, 'api', 'records', 'route.js'), routeSource)
    const beforeOverride = checksumModule(
      standalone.modulesFile,
      standalone.appModule,
      standalone.distModule,
    )

    write(appRoute, routeSource)
    const withOverride = checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule)
    expect(withOverride).not.toBe(beforeOverride)

    write(
      packageRoute,
      'export const metadata = { path: "/shadowed" }\nexport async function POST() { return null }\n',
    )
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule))
      .toBe(withOverride)

    fs.rmSync(appRoute)
    expect(checksumModule(standalone.modulesFile, standalone.appModule, standalone.distModule))
      .not.toBe(withOverride)
  })

  it('keeps content-sensitive fingerprinting for dist-only installed packages', () => {
    const standaloneRoot = path.join(root, 'dist-only')
    const distModule = path.join(
      standaloneRoot,
      'node_modules',
      '@open-mercato',
      'core',
      'dist',
      'modules',
      'customers',
    )
    const modulesFile = path.join(standaloneRoot, 'src', 'modules.ts')
    const routePath = path.join(distModule, 'api', 'records', 'route.js')
    write(modulesFile, 'export const enabledModules = ["customers"]\n')
    write(path.join(distModule, 'index.js'), 'export const metadata = { id: "customers" }\n')
    write(routePath, 'export const metadata = { path: "/records" };\nexport async function GET() {}\n')
    const appModule = path.join(standaloneRoot, 'src', 'modules', 'customers')
    const before = checksumModule(modulesFile, appModule, distModule)

    write(routePath, 'export const metadata = { path: "/contacts" };\nexport async function GET() {}\n')
    expect(checksumModule(modulesFile, appModule, distModule)).not.toBe(before)
  })
})

describe('structured generator inputs', () => {
  let root: string
  let pkg: string
  let app: string
  let options: GenerateWatchStructureOptions

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-watch-snapshot-'))
    pkg = path.join(root, 'packages/core/src/modules/customers')
    app = path.join(root, 'app/src/modules/customers')
    fs.mkdirSync(pkg, { recursive: true })
    fs.mkdirSync(app, { recursive: true })
    options = { modulesFile: path.join(root, 'app/src/modules.ts'), moduleRoots: [{ appBase: app, pkgBase: pkg }] }
    write(options.modulesFile, 'export const enabledModules = []')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function capture(): GenerateWatchSnapshot {
    return collectGenerateWatchStructureSnapshot(options)
  }

  function changesSince(previous: GenerateWatchSnapshot) {
    const next = capture()
    return { next, changes: diffGenerateWatchStructureSnapshots(previous, next) }
  }

  it('reuses cached content until stat identity changes or the file is deleted', () => {
    const route = path.join(pkg, 'api/items/route.ts')
    const helper = path.join(pkg, 'api/items/helper.ts')
    write(route, 'import { value } from "./helper"; export const GET = () => value')
    write(helper, 'export const value = 1')
    const cache = createGenerateWatchStructureCache()
    const readSpy = jest.spyOn(fs, 'readFileSync')

    collectGenerateWatchStructureSnapshot(options, cache)
    const readsAfterFirstCapture = readSpy.mock.calls.length
    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy).toHaveBeenCalledTimes(readsAfterFirstCapture)

    write(helper, 'export const value = 200')
    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy.mock.calls.length).toBeGreaterThan(readsAfterFirstCapture)
    const readsAfterChange = readSpy.mock.calls.length

    fs.rmSync(helper)
    collectGenerateWatchStructureSnapshot(options, cache)
    write(helper, 'export const value = 300')
    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy.mock.calls.length).toBeGreaterThan(readsAfterChange)
  })

  it('preserves unreachable cache entries only for uncertain captures and prunes them after authoritative removal', () => {
    const route = path.join(pkg, 'api/items/route.ts')
    const helper = path.join(pkg, 'api/items/helper.ts')
    write(route, 'import { value } from "./helper"; export const GET = () => value')
    write(helper, 'export const value = 1')
    const cache = createGenerateWatchStructureCache()
    const readSpy = jest.spyOn(fs, 'readFileSync')
    const moduleRoots = options.moduleRoots

    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy.mock.calls.filter(([file]) => file === helper)).toHaveLength(1)

    options.moduleRoots = []
    options.webResearchAdapterFullReasons = ['Cannot scan adapter packages']
    collectGenerateWatchStructureSnapshot(options, cache)
    options.moduleRoots = moduleRoots
    delete options.webResearchAdapterFullReasons
    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy.mock.calls.filter(([file]) => file === helper)).toHaveLength(1)

    options.moduleRoots = []
    collectGenerateWatchStructureSnapshot(options, cache)
    options.moduleRoots = moduleRoots
    collectGenerateWatchStructureSnapshot(options, cache)
    expect(readSpy.mock.calls.filter(([file]) => file === helper)).toHaveLength(2)
  })

  it('includes deterministic adapter scan uncertainty in snapshot full fallback reasons', () => {
    options.webResearchAdapterFullReasons = [
      'Cannot scan web-research adapter packages: /z',
      'Cannot scan web-research adapter packages: /a',
      'Cannot scan web-research adapter packages: /z',
    ]

    const snapshot = capture()

    expect(snapshot.fullReasons).toEqual([
      'Cannot scan web-research adapter packages: /a',
      'Cannot scan web-research adapter packages: /z',
    ])
    expect(planGenerateWatchChanges([], snapshot.fullReasons).mode).toBe('full')
  })

  it('preserves module identity when an identical route moves between existing roots', () => {
    const second = path.join(root, 'packages/core/src/modules/sales')
    fs.mkdirSync(second, { recursive: true })
    options.moduleRoots.push({ appBase: path.join(root, 'app/src/modules/sales'), pkgBase: second })
    const route = 'api/items/route.ts'
    write(path.join(pkg, route), 'export const GET = () => null')
    const before = capture()
    fs.renameSync(path.join(pkg, route), path.join(second, 'route.tmp'))
    write(path.join(second, route), 'export const GET = () => null')
    fs.rmSync(path.join(second, 'route.tmp'))
    const { changes } = changesSince(before)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', category: 'api-route', path: path.join(pkg, route) }),
      expect.objectContaining({ kind: 'add', category: 'api-route', path: path.join(second, route) }),
    ]))
    expect(planGenerateWatchChanges(changes).registryOutputs).toEqual(['main', 'runtime', 'api-routes'])
  })

  it('detects identical cli conventions moving between modules', () => {
    const second = path.join(root, 'packages/core/src/modules/sales')
    fs.mkdirSync(second, { recursive: true })
    options.moduleRoots.push({ appBase: path.join(root, 'app/src/modules/sales'), pkgBase: second })
    write(path.join(pkg, 'cli.ts'), 'export default []')
    const before = capture()
    fs.renameSync(path.join(pkg, 'cli.ts'), path.join(second, 'cli.ts'))
    const { changes } = changesSince(before)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', category: 'cli', path: path.join(pkg, 'cli.ts') }),
      expect.objectContaining({ kind: 'add', category: 'cli', path: path.join(second, 'cli.ts') }),
    ]))
  })

  it('keeps source additions, compiled arrival, edits and deletions as separate transitions', () => {
    const source = path.join(root, 'node_modules/@example/pkg/src/modules/customers')
    const dist = path.join(root, 'node_modules/@example/pkg/dist/modules/customers')
    fs.mkdirSync(source, { recursive: true })
    fs.mkdirSync(dist, { recursive: true })
    options.moduleRoots = [{ appBase: app, pkgBase: dist }]
    const sourceRoute = path.join(source, 'api/items/route.ts')
    const runtimeRoute = path.join(dist, 'api/items/route.js')
    let before = capture()
    write(sourceRoute, 'export const GET = () => null')
    let result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'add', path: sourceRoute, category: 'api-route' }))
    before = result.next
    write(runtimeRoute, 'export const GET = () => null')
    result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'add', path: runtimeRoute, category: 'api-route' }))
    before = result.next
    write(runtimeRoute, 'export const POST = () => null')
    result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'change', path: runtimeRoute, category: 'api-route' }))
    before = result.next
    fs.rmSync(runtimeRoute)
    result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'delete', path: runtimeRoute, category: 'api-route' }))
    write(runtimeRoute, 'export const POST = () => null')
    before = capture()
    fs.rmSync(sourceRoute)
    result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'delete', path: sourceRoute, category: 'api-route' }))
    expect([...result.next.records.values()].filter((record) => record.category === 'api-route')).toEqual([])
  })

  it.each(['cli', 'di', 'search', 'events'] as const)(
    'retains cached standalone %s runtime inputs after source-mirror convention deletion',
    (category) => {
      const source = path.join(root, 'node_modules/pkg/src/modules/customers')
      const dist = path.join(root, 'node_modules/pkg/dist/modules/customers')
      fs.mkdirSync(source, { recursive: true })
      fs.mkdirSync(dist, { recursive: true })
      options.moduleRoots = [{ appBase: app, pkgBase: dist }]
      const sourceFile = path.join(source, `${category}.ts`)
      const runtimeFile = path.join(dist, `${category}.js`)
      const cache = createGenerateWatchStructureCache()
      const snapshot = () => collectGenerateWatchStructureSnapshot(options, cache)
      const empty = snapshot()

      write(sourceFile, 'export const metadata = { value: 1 }')
      const sourceOnly = snapshot()
      expect(diffGenerateWatchStructureSnapshots(empty, sourceOnly)).toContainEqual(
        expect.objectContaining({ category, path: sourceFile, kind: 'add' }),
      )
      write(runtimeFile, 'export const metadata = { value: 1 }')
      const paired = snapshot()
      expect(diffGenerateWatchStructureSnapshots(sourceOnly, paired)).toContainEqual(
        expect.objectContaining({ category, path: runtimeFile, kind: 'add' }),
      )

      fs.rmSync(sourceFile)
      const runtimeOnly = snapshot()
      const removedSource = diffGenerateWatchStructureSnapshots(paired, runtimeOnly)
      expect(removedSource).toContainEqual(expect.objectContaining({ category, path: sourceFile, kind: 'delete' }))
      expect(removedSource).not.toContainEqual(expect.objectContaining({ path: runtimeFile, kind: 'delete' }))
      expect([...runtimeOnly.records.values()]).toContainEqual(expect.objectContaining({
        category, path: runtimeFile, key: expect.stringContaining(':runtime'),
      }))
      expect(runtimeOnly.fullReasons).toEqual([])
      const readSpy = jest.spyOn(fs, 'readFileSync')
      expect(snapshot().checksum).toBe(runtimeOnly.checksum)
      expect(readSpy).not.toHaveBeenCalled()
      readSpy.mockRestore()

      write(runtimeFile, 'export const metadata = { value: 2 }')
      const editedRuntime = snapshot()
      const changes = diffGenerateWatchStructureSnapshots(runtimeOnly, editedRuntime)
      expect(changes).toContainEqual(expect.objectContaining({ category, path: runtimeFile, kind: 'change' }))
      expect(changes.every((change) => change.category === category)).toBe(true)
      expect(planGenerateWatchChanges(changes).mode).toBe('incremental')

      fs.rmSync(runtimeFile)
      const removedRuntime = snapshot()
      expect(diffGenerateWatchStructureSnapshots(editedRuntime, removedRuntime)).toContainEqual(
        expect.objectContaining({ category, path: runtimeFile, kind: 'delete' }),
      )
      expect(removedRuntime.checksum).toBe(empty.checksum)
    },
  )

  it('shadows stale compiled conventions with app overrides and inherits runtime helper categories', () => {
    const source = path.join(root, 'node_modules/pkg/src/modules/customers')
    const dist = path.join(root, 'node_modules/pkg/dist/modules/customers')
    fs.mkdirSync(source, { recursive: true })
    options.moduleRoots = [{ appBase: app, pkgBase: dist }]
    const runtimeFile = path.join(dist, 'cli.js')
    const helper = path.join(dist, 'lib/cli-options.js')
    const appFile = path.join(app, 'cli.ts')
    write(runtimeFile, 'import { value } from "./lib/cli-options"; export default value')
    write(helper, 'export const value = 1')
    write(appFile, 'export default []')
    const overridden = capture()

    write(runtimeFile, 'import { value } from "./lib/cli-options"; export default [value]')
    write(helper, 'export const value = 2')
    expect(capture().checksum).toBe(overridden.checksum)

    fs.rmSync(appFile)
    const revealed = capture()
    expect(diffGenerateWatchStructureSnapshots(overridden, revealed)).toContainEqual(
      expect.objectContaining({ category: 'cli', path: runtimeFile, kind: 'add' }),
    )
    write(helper, 'export const value = 3')
    const { changes } = changesSince(revealed)
    expect(changes).toContainEqual(expect.objectContaining({ category: 'cli', path: helper, kind: 'change' }))
    expect(planGenerateWatchChanges(changes).registryOutputs).toEqual(['main', 'cli'])
  })

  it('handles dist-only modules and source-mirror authority appearing later', () => {
    const dist = path.join(root, 'node_modules/pkg/dist/modules/customers')
    options.moduleRoots = [{ appBase: app, pkgBase: dist }]
    write(path.join(dist, 'workers/job.js'), 'export default async function job() {}')
    const before = capture()
    const source = path.join(root, 'node_modules/pkg/src/modules/customers')
    fs.mkdirSync(source, { recursive: true })
    const { changes } = changesSince(before)
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'delete', category: 'workers' }))
    expect(planGenerateWatchChanges(changes).mode).toBe('full')
  })

  it('honors app overrides across extensions and reveals package inputs on deletion', () => {
    write(path.join(pkg, 'workers/job.js'), 'export default async function job() {}')
    const before = capture()
    write(path.join(app, 'workers/job.ts'), 'export default async function job() {}')
    const overridden = capture()
    expect(diffGenerateWatchStructureSnapshots(before, overridden)).toContainEqual(
      expect.objectContaining({ category: 'workers', path: path.join(app, 'workers/job.ts') }),
    )
    write(path.join(pkg, 'workers/job.js'), 'export default async function hiddenJob() {}')
    expect(capture().checksum).toBe(overridden.checksum)
    fs.rmSync(path.join(app, 'workers/job.ts'))
    const { changes } = changesSince(overridden)
    expect(changes).toContainEqual(expect.objectContaining({ category: 'workers', path: path.join(pkg, 'workers/job.js') }))
  })

  it('tracks command ids and deletion while excluding command helpers and tests', () => {
    const before = capture()
    for (const file of ['index.ts', 'shared.ts', 'factory.ts', 'save.test.ts', 'save.d.ts']) {
      write(path.join(pkg, 'commands', file), 'export const ignored = true')
    }
    expect(capture().checksum).toBe(before.checksum)
    const command = path.join(pkg, 'commands/nested/save.ts')
    write(command, 'export const command = { id: \"customers.save\" }')
    const added = capture()
    write(command, 'export const command = { id: \"customers.update\" }')
    expect(changesSince(added).changes).toContainEqual(expect.objectContaining({ category: 'commands', kind: 'change', path: command }))
    fs.rmSync(command)
    expect(changesSince(added).changes).toContainEqual(expect.objectContaining({ category: 'commands', kind: 'delete', path: command }))
  })

  it('tracks legacy method APIs and preserves the command-interceptor overlap', () => {
    const before = capture()
    write(path.join(pkg, 'api/get/items.ts'), 'export default function handler() {}')
    write(path.join(pkg, 'commands/interceptors.ts'), 'export const interceptors = []')
    const { changes } = changesSince(before)
    const plan = planGenerateWatchChanges(changes)
    expect(plan.mode).toBe('incremental')
    expect(plan.groups).toEqual(['registry', 'openapi'])
    expect(plan.registryOutputs).toEqual(['main', 'runtime', 'api-routes', 'commands', 'registry.command-interceptors'])
  })

  it('uses locale membership and merge-side identity without hashing translation values', () => {
    const locale = path.join(pkg, 'i18n/en.json')
    write(locale, '{\"hello\":\"Hello\"}')
    const before = capture()
    write(locale, '{\"hello\":\"Hi\"}')
    expect(capture().checksum).toBe(before.checksum)
    write(path.join(app, 'i18n/en.json'), '{\"hello\":\"Custom\"}')
    expect(changesSince(before).changes).toContainEqual(expect.objectContaining({ category: 'i18n', kind: 'add', path: path.join(app, 'i18n/en.json') }))
    const merged = capture()
    fs.rmSync(locale)
    expect(changesSince(merged).changes).toContainEqual(expect.objectContaining({ category: 'i18n', kind: 'delete', path: locale }))
  })

  it('reads built-in-style static plugin descriptors and watches arbitrary nested contributions', () => {
    write(path.join(pkg, 'generators.ts'), `
      import type { GeneratorPlugin } from '@open-mercato/shared/modules/generators'
      const file = 'custom/nested.items.ts'
      const plugin: GeneratorPlugin = { id: 'test.items', conventionFile: file, buildOutput: () => '' }
      export const generatorPlugins = [plugin]
      export default generatorPlugins
    `)
    const before = capture()
    expect(before.fullReasons).toEqual([])
    write(path.join(pkg, 'custom/nested.items.ts'), 'export default [\"entry\"]')
    const { changes } = changesSince(before)
    expect(changes).toContainEqual(expect.objectContaining({ category: 'generator-plugin', kind: 'add' }))
    expect(planGenerateWatchChanges(changes).mode).toBe('full')
    const contributed = capture()
    fs.rmSync(path.join(pkg, 'generators.ts'))
    expect(planGenerateWatchChanges(changesSince(contributed).changes).mode).toBe('full')
  })

  it('falls back explicitly for dynamic plugin descriptors instead of missing contributions', () => {
    write(path.join(pkg, 'generators.ts'), 'export const generatorPlugins = makePlugins()')
    const snapshot = capture()
    expect(snapshot.fullReasons).toEqual([])
    expect(planGenerateWatchChanges(diffGenerateWatchStructureSnapshots(snapshot, capture())).mode).toBe('none')
    const contribution = path.join(pkg, 'custom/unknown.items.ts')
    write(contribution, 'export const items = [\"new\"]')
    const { changes } = changesSince(snapshot)
    const plan = planGenerateWatchChanges(changes)
    expect(plan.mode).toBe('full')
    expect(plan.reasons).toContain(`Generator plugin dependency changed: ${contribution}`)
  })

  it('inherits backend-page planning through transitive metadata helpers', () => {
    write(path.join(pkg, 'backend/page.tsx'), 'export default function Page() { return null }')
    write(path.join(pkg, 'backend/page.meta.ts'), 'import { label } from "../lib/label"; export const metadata = { label }')
    write(path.join(pkg, 'lib/label.ts'), 'export { label } from "./nested"')
    write(path.join(pkg, 'lib/nested.ts'), 'export const label = "First"')
    const before = capture()
    write(path.join(pkg, 'components/Unrelated.tsx'), 'export default () => null')
    expect(capture().checksum).toBe(before.checksum)
    const nested = path.join(pkg, 'lib/nested.ts')
    write(nested, 'export const label = "Second"')
    const { changes } = changesSince(before)
    expect(changes).toContainEqual(expect.objectContaining({ category: 'backend-page', path: nested }))
    const plan = planGenerateWatchChanges(changes)
    expect(plan.mode).toBe('incremental')
    expect(plan.registryOutputs).toEqual(['main', 'runtime', 'app', 'backend-routes'])
  })

  it('tracks page default-export shape without treating ordinary page rendering edits as structural', () => {
    const page = path.join(pkg, 'backend/page.tsx')
    write(page, 'export default function Page() { return null }')
    const before = capture()
    write(page, 'export default function Page() { return \"Updated render\" }')
    expect(capture().checksum).toBe(before.checksum)
    write(page, 'export function Page() { return null }')
    expect(changesSince(before).changes).toContainEqual(expect.objectContaining({ category: 'backend-page', kind: 'change' }))
  })

  it('tracks entity override and legacy schema selection candidates', () => {
    const before = capture()
    write(path.join(pkg, 'db/schema.ts'), 'export class Customer {}')
    write(path.join(app, 'data/entities.override.ts'), 'export class CustomCustomer {}')
    const { changes } = changesSince(before)
    expect(changes.every((change) => change.category === 'entities')).toBe(true)
    expect(planGenerateWatchChanges(changes).groups).toEqual(['entity-ids', 'entities'])
  })

  it('tracks standalone package-generated entity metadata as an entity input', () => {
    const packageRoot = path.join(root, 'node_modules/pkg')
    const dist = path.join(packageRoot, 'dist/modules/customers')
    fs.mkdirSync(dist, { recursive: true })
    options.moduleRoots = [{ appBase: app, pkgBase: dist }]
    const before = capture()
    const ids = path.join(packageRoot, 'dist/generated/entities.ids.generated.js')
    write(ids, 'export const E = { customers: { person: \"customers:person\" } }')
    const { changes } = changesSince(before)
    expect(changes).toContainEqual(expect.objectContaining({ category: 'entities', path: ids }))
    expect(planGenerateWatchChanges(changes).groups).toEqual(['entity-ids', 'entities'])
    const usingDist = capture()
    const direct = path.join(packageRoot, 'generated')
    expect([...usingDist.records.values()]).toContainEqual(expect.objectContaining({
      category: 'entities', path: direct, fingerprint: 'missing',
    }))
    fs.mkdirSync(direct)
    const switched = changesSince(usingDist)
    expect(switched.changes).toContainEqual(expect.objectContaining({ category: 'entities', path: direct, kind: 'change' }))
    expect(switched.changes).toContainEqual(expect.objectContaining({ category: 'entities', path: ids, kind: 'delete' }))
  })

  it('does not broaden API plans when OpenAPI also reports the same route input', () => {
    const route = path.join(pkg, 'api/items/route.ts')
    write(route, 'export const GET = () => null')
    options.openapiInputs = [route]
    const before = capture()
    write(route, 'export const POST = () => null')
    expect(planGenerateWatchChanges(changesSince(before).changes).groups).toEqual(['registry', 'openapi'])
  })

  it('unions inherited categories and extension identity when seeds share a helper', () => {
    const search = path.join(pkg, 'search.ts')
    const notifications = path.join(pkg, 'notifications.ts')
    const helper = path.join(pkg, 'lib/search-options.ts')
    write(search, 'import { enabled } from "./lib/search-options"; export const searchConfig = { enabled }')
    write(notifications, 'import { enabled } from "./lib/search-options"; export const handlers = enabled ? [] : []')
    write(helper, 'export const enabled = false')
    options.openapiInputs = [search]
    const before = capture()
    write(helper, 'export const enabled = true')
    const changes = changesSince(before).changes
    expect(changes.filter((change) => change.path === helper).map((change) => change.category).sort())
      .toEqual(['extension', 'openapi', 'search'])
    expect(changes).toContainEqual(expect.objectContaining({
      category: 'extension', extensionId: 'registry.notifications', path: helper,
    }))
    const plan = planGenerateWatchChanges(changes)
    expect(plan.mode).toBe('incremental')
    expect(plan.groups).toEqual(['registry', 'openapi'])
    expect(plan.registryOutputs).toEqual(['registry.search', 'registry.notifications'])
  })

  it('plans OpenAPI helpers and adapter manifests without a full fallback', () => {
    const openapiInput = path.join(root, 'app/src/openapi.ts')
    const openapiHelper = path.join(root, 'app/src/openapi-helper.ts')
    const adapterManifest = path.join(root, 'packages/adapter/package.json')
    write(openapiInput, 'export { schema } from "./openapi-helper"')
    write(openapiHelper, 'export const schema = { version: 1 }')
    write(adapterManifest, '{"name":"adapter","openMercato":{"webResearchAdapter":{"id":"first"}}}')
    options.openapiInputs = [openapiInput]
    options.webResearchAdapterInputs = [adapterManifest]
    const manifestReadSpy = jest.spyOn(fs, 'readFileSync')
    const before = capture()
    expect(manifestReadSpy.mock.calls.some(([file]) => file === adapterManifest)).toBe(false)
    manifestReadSpy.mockRestore()
    write(openapiHelper, 'export const schema = { version: 2 }')
    write(adapterManifest, '{"name":"adapter","openMercato":{"webResearchAdapter":{"id":"second"}}}')
    const changes = changesSince(before).changes
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'openapi', path: openapiHelper }),
      expect.objectContaining({ category: 'web-research-adapters', path: adapterManifest }),
    ]))
    const plan = planGenerateWatchChanges(changes)
    expect(plan.mode).toBe('incremental')
    expect(plan.groups).toEqual(['web-research-adapters', 'openapi'])
  })

  it('detects supervisor override calls outside module conventions without tracking unrelated component edits', () => {
    const file = path.join(root, 'app/src/components/Setup.tsx')
    write(file, 'export const setup = () => null')
    const before = capture()
    write(file, 'import { applyWorkerOverrides as apply } from \"@open-mercato/shared/modules/overrides\"; apply({})')
    const { changes } = changesSince(before)
    expect(planGenerateWatchChanges(changes).registryOutputs).toEqual(['supervisor'])
  })

  it('normalizes root property ordering while retaining module order as configuration', () => {
    const before = capture()
    options.moduleRoots = [{ pkgBase: pkg, appBase: app }]
    expect(capture().checksum).toBe(before.checksum)
    const second = { appBase: path.join(root, 'app/src/modules/sales'), pkgBase: path.join(root, 'packages/core/src/modules/sales') }
    options.moduleRoots.push(second)
    const ordered = capture()
    options.moduleRoots.reverse()
    const { changes } = changesSince(ordered)
    expect(planGenerateWatchChanges(changes).mode).toBe('full')
    expect(changes).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'configuration' })]))
  })

  it('observes compiled page metadata updates independently of source edits', () => {
    const source = path.join(root, 'node_modules/pkg/src/modules/customers')
    const dist = path.join(root, 'node_modules/pkg/dist/modules/customers')
    options.moduleRoots = [{ appBase: app, pkgBase: dist }]
    write(path.join(source, 'backend/page.tsx'), 'export default function Page() { return null }')
    write(path.join(source, 'backend/page.meta.ts'), 'export const metadata = { label: "First" }')
    write(path.join(dist, 'backend/page.js'), 'export default function Page() { return null }')
    const compiledMeta = path.join(dist, 'backend/page.meta.js')
    write(compiledMeta, 'export const metadata = { label: "First" }')
    let before = capture()
    write(path.join(source, 'backend/page.meta.ts'), 'export const metadata = { label: "Second" }')
    let result = changesSince(before)
    expect(planGenerateWatchChanges(result.changes).registryOutputs).toEqual(['main', 'runtime', 'app', 'backend-routes'])
    before = result.next
    write(compiledMeta, 'export const metadata = { label: "Second" }')
    result = changesSince(before)
    expect(result.changes).toContainEqual(expect.objectContaining({ category: 'backend-page', path: compiledMeta, kind: 'change' }))
  })

  it('does not interpret read and scan failures as authoritative deletion', () => {
    write(path.join(pkg, 'workers/job.ts'), 'export default () => null')
    const before = capture()
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('denied') })
    const unreadable = capture()
    readSpy.mockRestore()
    expect(planGenerateWatchChanges(diffGenerateWatchStructureSnapshots(before, unreadable), unreadable.fullReasons).mode).toBe('full')
    expect(unreadable.fullReasons).toEqual(expect.arrayContaining([expect.stringContaining('Cannot read generator input:')]))
    const scanSpy = jest.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('denied') })
    const unscannable = capture()
    scanSpy.mockRestore()
    expect(planGenerateWatchChanges(diffGenerateWatchStructureSnapshots(before, unscannable), unscannable.fullReasons).mode).toBe('full')
    expect(unscannable.fullReasons).toEqual(expect.arrayContaining([expect.stringContaining('Cannot scan generator inputs:')]))
  })
})
