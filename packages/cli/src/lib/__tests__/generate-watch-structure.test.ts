import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { calculateGenerateWatchStructureChecksum } from '../generate-watch-structure'

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
