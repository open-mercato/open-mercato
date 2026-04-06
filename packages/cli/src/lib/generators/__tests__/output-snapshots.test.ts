/**
 * Snapshot tests for all generated output files.
 *
 * These tests scaffold a realistic module set (core module + app module + config module),
 * run each generator, and snapshot every produced file. They serve as a regression
 * safety net for the ts-morph AST migration — any change in generated output will
 * cause the snapshot to fail.
 *
 * To update snapshots after an intentional change:
 *   npx jest --updateSnapshot output-snapshots
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } from '../module-registry'
import { generateModuleDi } from '../module-di'
import { generateModuleEntities } from '../module-entities'
import { generateEntityIds } from '../entity-ids'

let tmpDir: string
let outputDir: string
let fileMtimeNonce = 0

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'output-snapshot-'))
}

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  const mtime = new Date(Date.now() + fileMtimeNonce)
  fileMtimeNonce += 1
  fs.utimesSync(filePath, mtime, mtime)
}

function pkgModulePath(modId: string, ...segments: string[]): string {
  return path.join(tmpDir, 'packages', 'core', 'src', 'modules', modId, ...segments)
}

function appModulePath(modId: string, ...segments: string[]): string {
  return path.join(tmpDir, 'app', 'src', 'modules', modId, ...segments)
}

function createMockResolver(enabled: ModuleEntry[]): PackageResolver {
  return {
    isMonorepo: () => true,
    getRootDir: () => tmpDir,
    getAppDir: () => path.join(tmpDir, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'packages', 'core'),
  }
}

function readGenerated(filename: string): string | null {
  const filePath = path.join(outputDir, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

// ---------------------------------------------------------------------------
// Fixture: scaffold a realistic set of modules
// ---------------------------------------------------------------------------

function scaffoldFixture(): ModuleEntry[] {
  // --- Module 1: "orders" (core package module with pages, APIs, subscribers, widgets, entities) ---
  touchFile(
    pkgModulePath('orders', 'index.ts'),
    "export const metadata = { id: 'orders', label: 'Orders' }\n",
  )
  touchFile(
    pkgModulePath('orders', 'frontend', 'page.tsx'),
    'export default function OrdersPage() { return null }\n',
  )
  touchFile(
    pkgModulePath('orders', 'backend', 'page.tsx'),
    'export default function OrdersBackendPage() { return null }\n',
  )
  touchFile(
    pkgModulePath('orders', 'backend', 'page.meta.ts'),
    "export const metadata = { requireAuth: true, pageTitle: 'Orders', group: 'Sales' }\n",
  )
  touchFile(
    pkgModulePath('orders', 'backend', 'details', '[id]', 'page.tsx'),
    'export default function OrderDetailPage() { return null }\n',
  )
  touchFile(
    pkgModulePath('orders', 'api', 'orders', 'route.ts'),
    `export const metadata = { path: '/orders' }
export const openApi = { get: { summary: 'List orders' } }
export function GET() { return new Response('ok') }
export function POST() { return new Response('created') }
`,
  )
  touchFile(
    pkgModulePath('orders', 'subscribers', 'on-created.ts'),
    "export const metadata = { event: 'orders.order.created', persistent: true }\nexport default async function handler() {}\n",
  )
  touchFile(
    pkgModulePath('orders', 'subscribers', 'on-payment.ts'),
    "export const metadata = { event: 'payments.payment.completed', persistent: true }\nexport default async function handler() {}\n",
  )
  touchFile(
    pkgModulePath('orders', 'workers', 'sync-job.ts'),
    "export const metadata = { queue: 'orders.sync', concurrency: 2 }\nexport default async function handler() {}\n",
  )
  touchFile(
    pkgModulePath('orders', 'widgets', 'dashboard', 'revenue', 'widget.tsx'),
    'export default function RevenueWidget() { return null }\n',
  )
  touchFile(
    pkgModulePath('orders', 'widgets', 'injection', 'sidebar', 'widget.tsx'),
    'export default function SidebarWidget() { return null }\n',
  )
  touchFile(
    pkgModulePath('orders', 'data', 'entities.ts'),
    `export class SalesOrder {
  id!: string
  tenantId!: string
  totalGross!: number
  status!: string
  createdAt!: Date
}
export class OrderItem {
  id!: string
  orderId!: string
  productName!: string
  quantity!: number
}
`,
  )
  touchFile(
    pkgModulePath('orders', 'acl.ts'),
    "export const features = ['orders.view', 'orders.create', 'orders.edit', 'orders.delete']\n",
  )
  touchFile(
    pkgModulePath('orders', 'setup.ts'),
    "export const setup = { defaultRoleFeatures: ['orders.view'] }\n",
  )
  touchFile(
    pkgModulePath('orders', 'di.ts'),
    'export function register(container: any) { /* orders DI */ }\n',
  )
  touchFile(
    pkgModulePath('orders', 'i18n', 'en.json'),
    JSON.stringify({ orders: { list: { title: 'Orders' } } }),
  )
  touchFile(
    pkgModulePath('orders', 'i18n', 'pl.json'),
    JSON.stringify({ orders: { list: { title: 'Zamówienia' } } }),
  )

  // --- Module 2: "products" (core module with search, events, translations) ---
  touchFile(
    pkgModulePath('products', 'index.ts'),
    "export const metadata = { id: 'products', label: 'Products' }\n",
  )
  touchFile(
    pkgModulePath('products', 'backend', 'page.tsx'),
    'export default function ProductsPage() { return null }\n',
  )
  touchFile(
    pkgModulePath('products', 'api', 'products', 'route.ts'),
    `export const metadata = { path: '/products' }
export const openApi = { get: { summary: 'List products' } }
export function GET() { return new Response('ok') }
export function POST() { return new Response('created') }
export function PUT() { return new Response('updated') }
export function DELETE() { return new Response('deleted') }
`,
  )
  touchFile(
    pkgModulePath('products', 'data', 'entities.ts'),
    `export class Product {
  id!: string
  tenantId!: string
  name!: string
  sku!: string
  price!: number
}
export class Category {
  id!: string
  tenantId!: string
  name!: string
  parentId?: string
}
`,
  )
  touchFile(
    pkgModulePath('products', 'data', 'extensions.ts'),
    "export const extensions = []\n",
  )
  touchFile(
    pkgModulePath('products', 'translations.ts'),
    "export const translatableFields = { product: ['name', 'description'] }\n",
  )
  touchFile(
    pkgModulePath('products', 'di.ts'),
    'export function register(container: any) { /* products DI */ }\n',
  )
  touchFile(
    pkgModulePath('products', 'acl.ts'),
    "export const features = ['products.view', 'products.create']\n",
  )

  // --- Module 3: "custom_app" (app-level module) ---
  touchFile(
    appModulePath('custom_app', 'index.ts'),
    "export const metadata = { id: 'custom_app', label: 'Custom App Module' }\n",
  )
  touchFile(
    appModulePath('custom_app', 'backend', 'page.tsx'),
    'export default function CustomAppPage() { return null }\n',
  )
  touchFile(
    appModulePath('custom_app', 'subscribers', 'on-action.ts'),
    "export const metadata = { event: 'custom_app.action.fired' }\nexport default async function handler() {}\n",
  )
  touchFile(
    appModulePath('custom_app', 'widgets', 'dashboard', 'my-widget', 'widget.tsx'),
    'export default function MyWidget() { return null }\n',
  )
  touchFile(
    appModulePath('custom_app', 'acl.ts'),
    "export const features = ['custom_app.view']\n",
  )
  touchFile(
    appModulePath('custom_app', 'data', 'entities.ts'),
    `export class CustomRecord {
  id!: string
  tenantId!: string
  title!: string
}
`,
  )
  touchFile(
    appModulePath('custom_app', 'di.ts'),
    'export function register(container: any) { /* custom_app DI */ }\n',
  )

  return [
    { id: 'orders', from: '@open-mercato/core' },
    { id: 'products', from: '@open-mercato/core' },
    { id: 'custom_app', from: '@app' },
  ]
}

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = createTmpDir()
  outputDir = path.join(tmpDir, 'app', '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
  fileMtimeNonce = 0
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// DI generator snapshots
// ---------------------------------------------------------------------------

describe('generateModuleDi output snapshots', () => {
  it('produces stable di.generated.ts with multiple modules', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateModuleDi({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('di.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })

  it('produces stable di.generated.ts with zero modules', async () => {
    const resolver = createMockResolver([])
    const result = await generateModuleDi({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('di.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Entities generator snapshots
// ---------------------------------------------------------------------------

describe('generateModuleEntities output snapshots', () => {
  it('produces stable entities.generated.ts with multiple modules', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateModuleEntities({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('entities.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })

  it('produces stable entities.generated.ts with zero modules', async () => {
    const resolver = createMockResolver([])
    const result = await generateModuleEntities({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('entities.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Entity IDs generator snapshots
// ---------------------------------------------------------------------------

describe('generateEntityIds output snapshots', () => {
  it('produces stable entities.ids.generated.ts with entity classes', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateEntityIds({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const idsContent = readGenerated('entities.ids.generated.ts')
    expect(idsContent).not.toBeNull()
    expect(idsContent).toMatchSnapshot('entities.ids.generated.ts')

    const registryContent = readGenerated('entity-fields-registry.ts')
    if (registryContent) {
      expect(registryContent).toMatchSnapshot('entity-fields-registry.ts')
    }
  })

  it('produces stable per-entity field files', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })

    const entityDir = path.join(outputDir, 'entities')
    if (!fs.existsSync(entityDir)) return

    const entityFiles = fs.readdirSync(entityDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'))
      .sort()

    for (const file of entityFiles) {
      const content = fs.readFileSync(path.join(entityDir, file), 'utf8')
      expect(content).toMatchSnapshot(`entity/${file}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Module registry generator snapshots (main — 28+ output files)
// ---------------------------------------------------------------------------

describe('generateModuleRegistry output snapshots', () => {
  const registryFiles = [
    'modules.generated.ts',
    'modules.runtime.generated.ts',
    'frontend-routes.generated.ts',
    'backend-routes.generated.ts',
    'api-routes.generated.ts',
    'dashboard-widgets.generated.ts',
    'injection-widgets.generated.ts',
    'injection-tables.generated.ts',
    'search.generated.ts',
    'events.generated.ts',
    'analytics.generated.ts',
    'notifications.generated.ts',
    'notifications.client.generated.ts',
    'notification-handlers.generated.ts',
    'message-types.generated.ts',
    'message-objects.generated.ts',
    'messages.client.generated.ts',
    'ai-tools.generated.ts',
    'translations-fields.generated.ts',
    'enrichers.generated.ts',
    'interceptors.generated.ts',
    'component-overrides.generated.ts',
    'inbox-actions.generated.ts',
    'guards.generated.ts',
    'command-interceptors.generated.ts',
    'frontend-middleware.generated.ts',
    'backend-middleware.generated.ts',
    'bootstrap-registrations.generated.ts',
    'payments.client.generated.ts',
    'security-mfa-providers.generated.ts',
    'security-sudo.generated.ts',
    'subscribers.generated.ts',
    'bootstrap-modules.generated.ts',
    'cli-modules.generated.ts',
  ]

  it('produces stable output for all registry files with realistic modules', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    for (const file of registryFiles) {
      const content = readGenerated(file)
      if (content !== null) {
        expect(content).toMatchSnapshot(file)
      }
    }

    // Also snapshot any additional generated .ts files not in the known list
    const allFiles = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.generated.ts'))
      .sort()

    for (const file of allFiles) {
      if (!registryFiles.includes(file)) {
        const content = readGenerated(file)
        if (content) {
          expect(content).toMatchSnapshot(`extra/${file}`)
        }
      }
    }
  })

  it('produces stable output with zero modules', async () => {
    const resolver = createMockResolver([])
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    for (const file of registryFiles) {
      const content = readGenerated(file)
      if (content !== null) {
        expect(content).toMatchSnapshot(`empty/${file}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Module registry app snapshots
// ---------------------------------------------------------------------------

describe('generateModuleRegistryApp output snapshots', () => {
  it('produces stable modules.app.generated.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateModuleRegistryApp({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('modules.app.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })

  it('produces stable modules.app.generated.ts with zero modules', async () => {
    const resolver = createMockResolver([])
    const result = await generateModuleRegistryApp({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('modules.app.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Module registry CLI snapshots
// ---------------------------------------------------------------------------

describe('generateModuleRegistryCli output snapshots', () => {
  it('produces stable modules.cli.generated.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    const result = await generateModuleRegistryCli({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('modules.cli.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })

  it('produces stable modules.cli.generated.ts with zero modules', async () => {
    const resolver = createMockResolver([])
    const result = await generateModuleRegistryCli({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const content = readGenerated('modules.cli.generated.ts')
    expect(content).not.toBeNull()
    expect(content).toMatchSnapshot()
  })
})
