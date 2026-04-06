/**
 * Structural contract tests for generated files.
 *
 * These tests verify that every generated .ts file:
 * - Starts with the AUTO-GENERATED comment
 * - Exports the exact symbols that downstream code depends on
 * - Is syntactically valid TypeScript
 *
 * Unlike snapshot tests, these survive formatting changes. They are the
 * hard safety net that must pass without modification after the ts-morph migration.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import ts from 'typescript'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } from '../module-registry'
import { generateModuleDi } from '../module-di'
import { generateModuleEntities } from '../module-entities'
import { generateEntityIds } from '../entity-ids'

let tmpDir: string
let outputDir: string
let fileMtimeNonce = 0

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'structural-contract-'))
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

function readGenerated(filename: string): string {
  const filePath = path.join(outputDir, filename)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected generated file not found: ${filename}`)
  }
  return fs.readFileSync(filePath, 'utf8')
}

function readGeneratedOptional(filename: string): string | null {
  const filePath = path.join(outputDir, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

// Scaffold the same fixture as output-snapshots.test.ts
function scaffoldFixture(): ModuleEntry[] {
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
}
`,
  )
  touchFile(
    pkgModulePath('orders', 'acl.ts'),
    "export const features = ['orders.view', 'orders.create']\n",
  )
  touchFile(
    pkgModulePath('orders', 'setup.ts'),
    "export const setup = { defaultRoleFeatures: ['orders.view'] }\n",
  )
  touchFile(
    pkgModulePath('orders', 'di.ts'),
    'export function register(container: any) {}\n',
  )

  touchFile(
    pkgModulePath('products', 'index.ts'),
    "export const metadata = { id: 'products', label: 'Products' }\n",
  )
  touchFile(
    pkgModulePath('products', 'backend', 'page.tsx'),
    'export default function ProductsPage() { return null }\n',
  )
  touchFile(
    pkgModulePath('products', 'data', 'entities.ts'),
    `export class Product {
  id!: string
  tenantId!: string
  name!: string
}
`,
  )
  touchFile(
    pkgModulePath('products', 'translations.ts'),
    "export const translatableFields = { product: ['name'] }\n",
  )
  touchFile(
    pkgModulePath('products', 'di.ts'),
    'export function register(container: any) {}\n',
  )
  touchFile(
    pkgModulePath('products', 'acl.ts'),
    "export const features = ['products.view']\n",
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
    'export function register(container: any) {}\n',
  )

  return [
    { id: 'orders', from: '@open-mercato/core' },
    { id: 'products', from: '@open-mercato/core' },
    { id: 'custom_app', from: '@app' },
  ]
}

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
// AUTO-GENERATED header contract
// ---------------------------------------------------------------------------

describe('auto-generated header', () => {
  it('all generated .ts files start with "// AUTO-GENERATED" comment', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })

    const tsFiles = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.generated.ts'))

    expect(tsFiles.length).toBeGreaterThan(0)

    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(outputDir, file), 'utf8')
      expect(content.startsWith('// AUTO-GENERATED')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// TypeScript syntax validity
// ---------------------------------------------------------------------------

describe('TypeScript syntax validity', () => {
  it('all generated .ts files parse without syntax errors', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })

    const tsFiles = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.checksum'))
      .sort()

    expect(tsFiles.length).toBeGreaterThan(0)

    const errors: string[] = []
    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(outputDir, file), 'utf8')
      const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind)
      const diagnostics = (sf as any).parseDiagnostics as ts.DiagnosticWithLocation[] | undefined
      if (diagnostics && diagnostics.length > 0) {
        errors.push(`${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`)
      }
    }

    expect(errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DI generator contracts
// ---------------------------------------------------------------------------

describe('di.generated.ts contracts', () => {
  it('exports diRegistrars named export and default export', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleDi({ resolver, quiet: true })

    const content = readGenerated('di.generated.ts')
    expect(content).toContain('export { diRegistrars }')
    expect(content).toContain('export default diRegistrars')
  })

  it('contains one import per module with di.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleDi({ resolver, quiet: true })

    const content = readGenerated('di.generated.ts')
    // orders, products, custom_app all have di.ts
    expect(content).toContain('orders/di')
    expect(content).toContain('products/di')
    expect(content).toContain('custom_app/di')
  })
})

// ---------------------------------------------------------------------------
// Entities generator contracts
// ---------------------------------------------------------------------------

describe('entities.generated.ts contracts', () => {
  it('exports entities array', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })

    const content = readGenerated('entities.generated.ts')
    expect(content).toContain('export const entities = [')
  })

  it('contains enhanceEntities function', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })

    const content = readGenerated('entities.generated.ts')
    expect(content).toContain('function enhanceEntities(')
  })

  it('references all modules with entities', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })

    const content = readGenerated('entities.generated.ts')
    expect(content).toContain('orders/data/entities')
    expect(content).toContain('products/data/entities')
    expect(content).toContain('custom_app/data/entities')
  })
})

// ---------------------------------------------------------------------------
// Entity IDs contracts
// ---------------------------------------------------------------------------

describe('entities.ids.generated.ts contracts', () => {
  it('exports M and E constants', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })

    const content = readGenerated('entities.ids.generated.ts')
    expect(content).toContain('export const M')
    expect(content).toContain('export const E')
  })
})

// ---------------------------------------------------------------------------
// Module registry contracts (main output files)
// ---------------------------------------------------------------------------

describe('modules.generated.ts contracts', () => {
  it('exports modules array, modulesInfo, and default export', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('modules.generated.ts')
    expect(content).toContain('export const modules: Module[] = [')
    expect(content).toContain('export const modulesInfo')
    expect(content).toContain('export default modules')
  })

  it('contains all enabled module IDs', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('modules.generated.ts')
    expect(content).toContain('"orders"')
    expect(content).toContain('"products"')
    expect(content).toContain('"custom_app"')
  })
})

describe('route manifest contracts', () => {
  it('frontend-routes.generated.ts exports frontendRoutes', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('frontend-routes.generated.ts')
    expect(content).toContain('export const frontendRoutes')
    expect(content).toContain('export default frontendRoutes')
  })

  it('backend-routes.generated.ts exports backendRoutes', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('backend-routes.generated.ts')
    expect(content).toContain('export const backendRoutes')
    expect(content).toContain('export default backendRoutes')
  })

  it('api-routes.generated.ts exports apiRoutes', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('api-routes.generated.ts')
    expect(content).toContain('export const apiRoutes')
    expect(content).toContain('export default apiRoutes')
  })
})

describe('search.generated.ts contracts', () => {
  it('exports searchModuleConfigEntries and searchModuleConfigs', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('search.generated.ts')
    expect(content).toContain('export const searchModuleConfigEntries')
    expect(content).toContain('export const searchModuleConfigs')
  })
})

describe('events.generated.ts contracts', () => {
  it('exports eventModuleConfigEntries', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('events.generated.ts')
    expect(content).toContain('export const eventModuleConfigEntries')
  })
})

describe('widget file contracts', () => {
  it('dashboard-widgets.generated.ts exports dashboardWidgetEntries', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('dashboard-widgets.generated.ts')
    expect(content).toContain('export const dashboardWidgetEntries')
  })

  it('injection-widgets.generated.ts exports injectionWidgetEntries', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('injection-widgets.generated.ts')
    expect(content).toContain('export const injectionWidgetEntries')
  })
})

describe('notifications.generated.ts contracts', () => {
  it('exports notificationTypeEntries', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('notifications.generated.ts')
    expect(content).toContain('export const notificationTypeEntries')
  })
})

describe('translations-fields.generated.ts contracts', () => {
  it('exports translatableFieldEntries', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const content = readGenerated('translations-fields.generated.ts')
    expect(content).toContain('export const translatableFieldEntries')
  })
})

describe('modules.app.generated.ts contracts', () => {
  it('exports modules array and default export', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryApp({ resolver, quiet: true })

    const content = readGenerated('modules.app.generated.ts')
    expect(content).toContain('export const modules: Module[] = [')
    expect(content).toContain('export default modules')
  })
})

describe('modules.cli.generated.ts contracts', () => {
  it('exports modules array', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryCli({ resolver, quiet: true })

    const content = readGenerated('modules.cli.generated.ts')
    expect(content).toContain('export const modules: Module[] = [')
  })
})

// ---------------------------------------------------------------------------
// Misc registry contracts
// ---------------------------------------------------------------------------

describe('miscellaneous registry contracts', () => {
  let enabled: ModuleEntry[]
  let resolver: PackageResolver

  beforeEach(async () => {
    enabled = scaffoldFixture()
    resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
  })

  it('enrichers.generated.ts exports enricherEntries', () => {
    const content = readGeneratedOptional('enrichers.generated.ts')
    if (content) expect(content).toContain('export const enricherEntries')
  })

  it('interceptors.generated.ts exports interceptorEntries', () => {
    const content = readGeneratedOptional('interceptors.generated.ts')
    if (content) expect(content).toContain('export const interceptorEntries')
  })

  it('guards.generated.ts exports guardEntries', () => {
    const content = readGeneratedOptional('guards.generated.ts')
    if (content) expect(content).toContain('export const guardEntries')
  })

  it('command-interceptors.generated.ts exports commandInterceptorEntries', () => {
    const content = readGeneratedOptional('command-interceptors.generated.ts')
    if (content) expect(content).toContain('export const commandInterceptorEntries')
  })

  it('component-overrides.generated.ts exports componentOverrideEntries', () => {
    const content = readGeneratedOptional('component-overrides.generated.ts')
    if (content) expect(content).toContain('export const componentOverrideEntries')
  })

  it('inbox-actions.generated.ts exports inboxActionConfigEntries', () => {
    const content = readGeneratedOptional('inbox-actions.generated.ts')
    if (content) expect(content).toContain('export const inboxActionConfigEntries')
  })

  it('ai-tools.generated.ts exports aiToolConfigEntries', () => {
    const content = readGeneratedOptional('ai-tools.generated.ts')
    if (content) expect(content).toContain('export const aiToolConfigEntries')
  })

  it('analytics.generated.ts exports analyticsModuleConfigEntries', () => {
    const content = readGeneratedOptional('analytics.generated.ts')
    if (content) expect(content).toContain('export const analyticsModuleConfigEntries')
  })
})
