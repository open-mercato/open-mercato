/**
 * Structural contract tests for generated files.
 *
 * These tests verify:
 * - Every generated .ts file starts with the AUTO-GENERATED comment
 * - Every file parses as valid TypeScript (zero syntax errors)
 * - Every downstream-consumed export symbol exists
 * - The SHAPE of exported arrays/objects: correct entry count, moduleId presence,
 *   nested properties, helper function existence, type annotations
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

/**
 * Count how many times a pattern appears in content.
 */
function countMatches(content: string, pattern: RegExp): number {
  return (content.match(pattern) || []).length
}

function parseSource(content: string, fileName = 'generated.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function getExportedNames(content: string, fileName = 'generated.ts'): Set<string> {
  const sourceFile = parseSource(content, fileName)
  const exportedNames = new Set<string>()

  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false

    if (isExported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exportedNames.add(declaration.name.text)
        }
      }
    }

    if (isExported && ts.isFunctionDeclaration(statement) && statement.name) {
      exportedNames.add(statement.name.text)
    }

    if (isExported && ts.isTypeAliasDeclaration(statement)) {
      exportedNames.add(statement.name.text)
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exportedNames.add('default')
    }

    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.add(element.name.text)
      }
    }
  }

  return exportedNames
}

function expectExports(content: string, names: string[], fileName?: string): void {
  const exportedNames = getExportedNames(content, fileName)
  for (const name of names) {
    expect(exportedNames.has(name)).toBe(true)
  }
}

function expectModuleIds(content: string, moduleIds: string[]): void {
  for (const moduleId of moduleIds) {
    expect(content).toMatch(new RegExp(`moduleId:\\s*['"]${moduleId}['"]`))
  }
}

function hasTypeImport(content: string, symbolName: string, moduleSpecifier?: string): boolean {
  const sourceFile = parseSource(content)

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    if (
      moduleSpecifier
      && (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier)
    ) {
      continue
    }

    const clause = statement.importClause
    if (clause.name?.text === symbolName && clause.isTypeOnly) {
      return true
    }

    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const element of clause.namedBindings.elements) {
      if (element.name.text === symbolName || element.propertyName?.text === symbolName) {
        if (clause.isTypeOnly || element.isTypeOnly) {
          return true
        }
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Fixture (same as output-snapshots.test.ts — exercises every convention file)
// ---------------------------------------------------------------------------

function scaffoldFixture(): ModuleEntry[] {
  // Module 1: "orders" — full-featured core module
  touchFile(pkgModulePath('orders', 'index.ts'), "export const metadata = { id: 'orders', label: 'Orders' }\n")
  touchFile(pkgModulePath('orders', 'frontend', 'page.tsx'), 'export default function OrdersPage() { return null }\n')
  touchFile(pkgModulePath('orders', 'backend', 'page.tsx'), 'export default function OrdersBackendPage() { return null }\n')
  touchFile(pkgModulePath('orders', 'backend', 'page.meta.ts'), "export const metadata = { requireAuth: true, pageTitle: 'Orders', group: 'Sales' }\n")
  touchFile(pkgModulePath('orders', 'backend', 'details', '[id]', 'page.tsx'), 'export default function OrderDetailPage() { return null }\n')
  touchFile(pkgModulePath('orders', 'api', 'orders', 'route.ts'), `export const metadata = { path: '/orders' }\nexport function GET() { return new Response('ok') }\nexport function POST() { return new Response('created') }\n`)
  touchFile(pkgModulePath('orders', 'subscribers', 'on-created.ts'), "export const metadata = { event: 'orders.order.created', persistent: true }\nexport default async function handler() {}\n")
  touchFile(pkgModulePath('orders', 'subscribers', 'on-payment.ts'), "export const metadata = { event: 'payments.payment.completed', persistent: true }\nexport default async function handler() {}\n")
  touchFile(pkgModulePath('orders', 'workers', 'sync-job.ts'), "export const metadata = { queue: 'orders.sync', concurrency: 2 }\nexport default async function handler() {}\n")
  touchFile(pkgModulePath('orders', 'widgets', 'dashboard', 'revenue', 'widget.tsx'), 'export default function RevenueWidget() { return null }\n')
  touchFile(pkgModulePath('orders', 'widgets', 'injection', 'sidebar', 'widget.tsx'), 'export default function SidebarWidget() { return null }\n')
  touchFile(pkgModulePath('orders', 'widgets', 'injection-table.ts'), `export const injectionTable = {\n  'crud-form:orders:sales_order:fields': [{ widgetId: 'orders.sidebar', kind: 'section', priority: 50 }],\n}\nexport default injectionTable\n`)
  touchFile(pkgModulePath('orders', 'widgets', 'components.ts'), `export const componentOverrides = [\n  { targetId: 'page:orders/list', mode: 'wrapper', component: () => null },\n]\nexport default componentOverrides\n`)
  touchFile(pkgModulePath('orders', 'data', 'entities.ts'), `export class SalesOrder {\n  id!: string\n  tenantId!: string\n  totalGross!: number\n  status!: string\n  createdAt!: Date\n}\nexport class OrderItem {\n  id!: string\n  orderId!: string\n  productName!: string\n  quantity!: number\n}\n`)
  touchFile(pkgModulePath('orders', 'data', 'extensions.ts'), "export const extensions = [\n  { sourceEntity: 'orders:sales_order', targetEntity: 'customers:person', foreignKey: 'customer_id' },\n]\n")
  touchFile(pkgModulePath('orders', 'data', 'enrichers.ts'), `export const enrichers = [\n  { id: 'orders.item-count', targetEntity: 'orders:sales_order', features: ['orders.view'], priority: 10, timeout: 2000, critical: false, async enrichOne(r: any) { return r }, async enrichMany(r: any[]) { return r } },\n]\n`)
  touchFile(pkgModulePath('orders', 'data', 'guards.ts'), `export const guards = [\n  { id: 'orders.prevent-duplicate', entity: 'orders:sales_order', event: 'create', description: 'Prevents duplicate orders', async validate(input: any) { return { ok: true } } },\n]\n`)
  touchFile(pkgModulePath('orders', 'api', 'interceptors.ts'), `export const interceptors = [\n  { id: 'orders.validate-total', targetRoute: 'orders', methods: ['POST', 'PUT'], priority: 100, async before(request: any) { return { ok: true } } },\n]\n`)
  touchFile(pkgModulePath('orders', 'commands', 'interceptors.ts'), `export const interceptors = [\n  { id: 'orders.audit-log', commandId: 'orders.create', phase: 'after', async handler(command: any) { return { ok: true } } },\n]\n`)
  touchFile(pkgModulePath('orders', 'acl.ts'), "export const features = ['orders.view', 'orders.create', 'orders.edit', 'orders.delete']\n")
  touchFile(pkgModulePath('orders', 'setup.ts'), "export const setup = { defaultRoleFeatures: ['orders.view'] }\n")
  touchFile(pkgModulePath('orders', 'encryption.ts'), "export const defaultEncryptionMaps = [{ entityId: 'orders:sales_order', fields: [{ field: 'customer_email', hashField: 'customer_email_hash' }] }]\nexport default defaultEncryptionMaps\n")
  touchFile(pkgModulePath('orders', 'di.ts'), 'export function register(container: any) {}\n')
  touchFile(pkgModulePath('orders', 'i18n', 'en.json'), JSON.stringify({ orders: { list: { title: 'Orders' } } }))
  touchFile(pkgModulePath('orders', 'i18n', 'pl.json'), JSON.stringify({ orders: { list: { title: 'Zamówienia' } } }))
  touchFile(pkgModulePath('orders', 'events.ts'), `export const eventsConfig = {\n  moduleId: 'orders',\n  events: [\n    { id: 'orders.order.created', label: 'Order Created', entity: 'sales_order', category: 'crud' },\n    { id: 'orders.order.updated', label: 'Order Updated', entity: 'sales_order', category: 'crud' },\n  ]\n}\nexport default eventsConfig\n`)
  touchFile(pkgModulePath('orders', 'notifications.ts'), `export const notificationTypes = [\n  { type: 'orders.order.created', module: 'orders', titleKey: 'orders.notifications.created.title', bodyKey: 'orders.notifications.created.body', icon: 'package', severity: 'info' },\n]\nexport default notificationTypes\n`)
  touchFile(pkgModulePath('orders', 'notifications.handlers.ts'), `export const notificationHandlers = [\n  { type: 'orders.order.created', handler: async (n: any) => {} },\n]\nexport default notificationHandlers\n`)
  touchFile(pkgModulePath('orders', 'translations.ts'), `export const translatableFields = {\n  'orders:sales_order': ['status_label', 'notes'],\n  'orders:order_item': ['product_name'],\n}\nexport default translatableFields\n`)
  touchFile(pkgModulePath('orders', 'inbox-actions.ts'), `export const inboxActions = [\n  { type: 'orders.approve', id: 'orders.approve-order', label: 'Approve Order', icon: 'check', description: 'Approve pending', async execute(a: any) { return { ok: true } } },\n]\nexport default inboxActions\n`)
  touchFile(pkgModulePath('orders', 'inbox-ops-sources.ts'), `export const inboxOpsSourceAdapters = [\n  {\n    sourceEntityType: 'orders:message',\n    async loadSource(args: any) { return args },\n    async buildInput(args: any) {\n      return {\n        sourceEntityType: 'orders:message',\n        sourceEntityId: args.sourceEntityId,\n        body: 'hello',\n        bodyFormat: 'text',\n        participants: [],\n        capabilities: {\n          canDraftReply: false,\n          canUseTimelineContext: false,\n        },\n      }\n    },\n  },\n]\n\nexport default inboxOpsSourceAdapters\n`)
  touchFile(pkgModulePath('orders', 'analytics.ts'), `export const analyticsConfig = {\n  entities: [{ entityId: 'orders:sales_order', requiredFeatures: ['orders.view'], entityConfig: { tableName: 'sales_orders', dateField: 'created_at' }, fieldMappings: { id: { dbColumn: 'id', type: 'uuid' } } }],\n}\nexport default analyticsConfig\n`)
  touchFile(pkgModulePath('orders', 'ai-tools.ts'), `export const aiTools = [\n  { name: 'list_orders', description: 'List recent orders', inputSchema: {}, requiredFeatures: ['orders.view'] },\n]\nexport default aiTools\n`)
  touchFile(pkgModulePath('orders', 'frontend', 'middleware.ts'), `export const middleware = [\n  { id: 'orders.auth-check', pattern: '/orders/**', handler: async (req: any) => req },\n]\nexport default middleware\n`)
  touchFile(pkgModulePath('orders', 'backend', 'middleware.ts'), `export const middleware = [\n  { id: 'orders.admin-check', pattern: '/backend/orders/**', handler: async (req: any) => req },\n]\nexport default middleware\n`)
  touchFile(pkgModulePath('orders', 'message-types.ts'), `export const messageTypes = [\n  { type: 'orders.order_confirmation', module: 'orders', labelKey: 'orders.messages.confirmation.label', icon: 'mail', color: 'blue', allowReply: false, allowForward: true },\n]\nexport default messageTypes\n`)
  touchFile(pkgModulePath('orders', 'message-objects.ts'), `export const messageObjectTypes = [\n  { module: 'orders', entityType: 'sales_order', messageTypes: ['orders.order_confirmation'], entityId: 'orders:sales_order', optionLabelField: 'id', labelKey: 'orders.messages.objects.order.label', icon: 'package' },\n]\nexport default messageObjectTypes\n`)
  touchFile(pkgModulePath('orders', 'ce.ts'), `export const entities = [\n  { id: 'orders:custom_field_set', label: 'Order Custom Fields', fields: [{ id: 'priority', type: 'text', label: 'Priority' }] },\n]\n`)

  // Module 2: "products" — core module with events, notifications, translations
  touchFile(pkgModulePath('products', 'index.ts'), "export const metadata = { id: 'products', label: 'Products' }\n")
  touchFile(pkgModulePath('products', 'backend', 'page.tsx'), 'export default function ProductsPage() { return null }\n')
  touchFile(pkgModulePath('products', 'api', 'products', 'route.ts'), `export const metadata = { path: '/products' }\nexport function GET() { return new Response('ok') }\nexport function POST() { return new Response('created') }\nexport function PUT() { return new Response('updated') }\nexport function DELETE() { return new Response('deleted') }\n`)
  touchFile(pkgModulePath('products', 'data', 'entities.ts'), `export class Product {\n  id!: string\n  tenantId!: string\n  name!: string\n  sku!: string\n  price!: number\n}\nexport class Category {\n  id!: string\n  tenantId!: string\n  name!: string\n  parentId?: string\n}\n`)
  touchFile(pkgModulePath('products', 'translations.ts'), "export const translatableFields = { product: ['name', 'description'] }\n")
  touchFile(pkgModulePath('products', 'di.ts'), 'export function register(container: any) {}\n')
  touchFile(pkgModulePath('products', 'acl.ts'), "export const features = ['products.view', 'products.create']\n")
  touchFile(pkgModulePath('products', 'events.ts'), `export const eventsConfig = {\n  moduleId: 'products',\n  events: [\n    { id: 'products.product.created', label: 'Product Created', entity: 'product', category: 'crud' },\n  ]\n}\nexport default eventsConfig\n`)
  touchFile(pkgModulePath('products', 'notifications.ts'), `export const notificationTypes = [\n  { type: 'products.low_stock', module: 'products', titleKey: 'products.notifications.low_stock.title', bodyKey: 'products.notifications.low_stock.body', icon: 'alert-triangle', severity: 'warning' },\n]\nexport default notificationTypes\n`)

  // Module 3: "custom_app" — app-level module
  touchFile(appModulePath('custom_app', 'index.ts'), "export const metadata = { id: 'custom_app', label: 'Custom App Module' }\n")
  touchFile(appModulePath('custom_app', 'backend', 'page.tsx'), 'export default function CustomAppPage() { return null }\n')
  touchFile(appModulePath('custom_app', 'subscribers', 'on-action.ts'), "export const metadata = { event: 'custom_app.action.fired' }\nexport default async function handler() {}\n")
  touchFile(appModulePath('custom_app', 'widgets', 'dashboard', 'my-widget', 'widget.tsx'), 'export default function MyWidget() { return null }\n')
  touchFile(appModulePath('custom_app', 'acl.ts'), "export const features = ['custom_app.view']\n")
  touchFile(appModulePath('custom_app', 'data', 'entities.ts'), `export class CustomRecord {\n  id!: string\n  tenantId!: string\n  title!: string\n}\n`)
  touchFile(appModulePath('custom_app', 'di.ts'), 'export function register(container: any) {}\n')
  touchFile(appModulePath('custom_app', 'events.ts'), `export const eventsConfig = {\n  moduleId: 'custom_app',\n  events: [\n    { id: 'custom_app.action.fired', label: 'Action Fired', entity: 'custom_record', category: 'lifecycle' },\n  ]\n}\nexport default eventsConfig\n`)

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
// AUTO-GENERATED header
// ---------------------------------------------------------------------------

describe('auto-generated header', () => {
  it('all generated .ts files start with "// AUTO-GENERATED" comment', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })

    const tsFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.generated.ts'))
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
// di.generated.ts
// ---------------------------------------------------------------------------

describe('di.generated.ts', () => {
  it('exports diRegistrars named export and default export', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleDi({ resolver, quiet: true })
    const content = readGenerated('di.generated.ts')

    expect(content).toContain('export { diRegistrars }')
    expect(content).toContain('export default diRegistrars')
  })

  it('imports and references all 3 modules with di.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleDi({ resolver, quiet: true })
    const content = readGenerated('di.generated.ts')

    expect(content).toContain('orders/di')
    expect(content).toContain('products/di')
    expect(content).toContain('custom_app/di')
    // Each module contributes one .register call
    expect(countMatches(content, /\.register/g)).toBe(3)
  })

  it('uses filter(Boolean) cast on the array', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleDi({ resolver, quiet: true })
    const content = readGenerated('di.generated.ts')

    expect(content).toContain('.filter(Boolean)')
  })
})

// ---------------------------------------------------------------------------
// entities.generated.ts
// ---------------------------------------------------------------------------

describe('entities.generated.ts', () => {
  it('exports entities array and defines enhanceEntities', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })
    const content = readGenerated('entities.generated.ts')

    expect(content).toContain('export const entities = [')
    expect(content).toContain('function enhanceEntities(')
  })

  it('spreads enhanceEntities for all 3 modules', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })
    const content = readGenerated('entities.generated.ts')

    expect(content).toContain('orders/data/entities')
    expect(content).toContain('products/data/entities')
    expect(content).toContain('custom_app/data/entities')
    // 3 spread calls inside the array
    expect(countMatches(content, /\.\.\.enhanceEntities\(/g)).toBe(3)
  })

  it('uses correct moduleId strings in enhanceEntities calls', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleEntities({ resolver, quiet: true })
    const content = readGenerated('entities.generated.ts')

    expect(content).toMatch(/enhanceEntities\(\S+,\s*["']orders["']\)/)
    expect(content).toMatch(/enhanceEntities\(\S+,\s*["']products["']\)/)
    expect(content).toMatch(/enhanceEntities\(\S+,\s*["']custom_app["']\)/)
  })
})

// ---------------------------------------------------------------------------
// entities.ids.generated.ts
// ---------------------------------------------------------------------------

describe('entities.ids.generated.ts', () => {
  it('exports M (module map) with all modules that have entities', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })
    const content = readGenerated('entities.ids.generated.ts')

    expect(content).toContain('export const M')
    expect(content).toContain('"orders": "orders"')
    expect(content).toContain('"products": "products"')
    // custom_app entities are in app dir — may not be in M depending on parsing
  })

  it('exports E (entity map) with entity IDs per module', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })
    const content = readGenerated('entities.ids.generated.ts')

    expectExports(content, ['E'])
    expect(content).toContain('"sales_order": "orders:sales_order"')
    expect(content).toContain('"order_item": "orders:order_item"')
    expect(content).toContain('"product": "products:product"')
    expect(content).toContain('"category": "products:category"')
  })

  it('exports KnownModuleId and KnownEntities types', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })
    const content = readGenerated('entities.ids.generated.ts')

    expect(content).toContain('export type KnownModuleId')
    expect(content).toContain('export type KnownEntities')
  })

  it('generates per-entity field files with correct field names', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateEntityIds({ resolver, quiet: true })

    const salesOrderPath = path.join(outputDir, 'entities', 'sales_order', 'index.ts')
    expect(fs.existsSync(salesOrderPath)).toBe(true)
    const salesOrderContent = fs.readFileSync(salesOrderPath, 'utf8')
    expect(salesOrderContent).toContain('export const id = "id"')
    expect(salesOrderContent).toContain('export const tenant_id = "tenant_id"')
    expect(salesOrderContent).toContain('export const total_gross = "total_gross"')
    expect(salesOrderContent).toContain('export const status = "status"')
    expect(salesOrderContent).toContain('export const created_at = "created_at"')

    const productPath = path.join(outputDir, 'entities', 'product', 'index.ts')
    expect(fs.existsSync(productPath)).toBe(true)
    const productContent = fs.readFileSync(productPath, 'utf8')
    expect(productContent).toContain('export const id = "id"')
    expect(productContent).toContain('export const name = "name"')
    expect(productContent).toContain('export const sku = "sku"')
    expect(productContent).toContain('export const price = "price"')
  })
})

// ---------------------------------------------------------------------------
// modules.generated.ts — the big one
// ---------------------------------------------------------------------------

describe('modules.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('modules.generated.ts')
  })

  it('exports modules array, modulesInfo, and default export', () => {
    expect(content).toContain('export const modules: Module[] = [')
    expect(content).toContain('export const modulesInfo')
    expect(content).toContain('export default modules')
  })

  it('declares all 3 module IDs', () => {
    expect(content).toContain('id: "orders"')
    expect(content).toContain('id: "products"')
    expect(content).toContain('id: "custom_app"')
  })

  it('orders module has subscribers with event metadata', () => {
    expect(content).toContain('orders:on-created')
    expect(content).toContain('orders.order.created')
    expect(content).toContain('orders:on-payment')
    expect(content).toContain('payments.payment.completed')
  })

  it('orders module has workers with queue metadata', () => {
    expect(content).toContain('orders.sync')
    expect(content).toContain('createLazyModuleWorker')
  })

  it('modules include ACL features arrays', () => {
    expect(content).toMatch(/features:.*orders/)
    expect(content).toMatch(/features:.*products/)
    expect(content).toMatch(/features:.*custom_app/)
  })

  it('modules include setup references', () => {
    expect(content).toContain('setup:')
  })

  it('modules include default encryption maps from encryption.ts', () => {
    expect(content).toContain('defaultEncryptionMaps:')
    expect(content).toContain('ENCRYPTION_orders_')
  })

  it('modules include translation locale keys', () => {
    expect(content).toContain("'en':")
    expect(content).toContain("'pl':")
  })

  it('modules include customFieldSets reference from ce.ts', () => {
    expect(content).toContain('customFieldSets:')
  })

  it('modules include entityExtensions reference from extensions.ts', () => {
    expect(content).toContain('entityExtensions:')
  })

  it('orders module includes dashboard widget keys', () => {
    expect(content).toContain('dashboardWidgets:')
    expect(content).toContain('orders:revenue')
  })

  it('imports createLazyModuleSubscriber and createLazyModuleWorker', () => {
    expect(content).toContain('createLazyModuleSubscriber')
    expect(content).toContain('createLazyModuleWorker')
  })

  it('imports events config for orders module', () => {
    expect(content).toMatch(/EVENTS_orders/)
  })

  it('imports analytics config for orders module', () => {
    expect(content).toMatch(/ANALYTICS_orders/)
  })
})

describe('subscribers.generated.ts', () => {
  it('exports legacy moduleSubscribers from modules.runtime.generated.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    const content = readGenerated('subscribers.generated.ts')

    expect(content).toContain('modules.runtime.generated')
    expect(content).toContain("export const moduleSubscribers: NonNullable<Module['subscribers']>")
    expect(content).toContain('modules.flatMap((module) => (module.subscribers ?? []))')
  })
})

// ---------------------------------------------------------------------------
// Route manifests
// ---------------------------------------------------------------------------

describe('frontend-routes.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('frontend-routes.generated.ts')
  })

  it('exports frontendRoutes array with default', () => {
    expect(content).toContain('export const frontendRoutes')
    expect(content).toContain('export default frontendRoutes')
  })

  it('contains orders frontend route with correct pattern', () => {
    expect(content).toContain('moduleId: "orders"')
    expect(content).toContain('pattern: "/"')
  })
})

describe('backend-routes.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('backend-routes.generated.ts')
  })

  it('exports backendRoutes array with default', () => {
    expect(content).toContain('export const backendRoutes')
    expect(content).toContain('export default backendRoutes')
  })

  it('contains backend routes for all modules with backend pages', () => {
    expect(content).toContain('moduleId: "orders"')
    expect(content).toContain('moduleId: "products"')
    expect(content).toContain('moduleId: "custom_app"')
  })

  it('orders detail route has [id] parameter in pattern', () => {
    expect(content).toContain('/backend/details/[id]')
  })

  it('each route entry has pattern, moduleId, and load function', () => {
    expect(content).toContain('pattern:')
    expect(content).toContain('requireAuth:')
    expect(content).toContain('load: async () =>')
  })
})

describe('api-routes.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('api-routes.generated.ts')
  })

  it('exports apiRoutes array with default', () => {
    expect(content).toContain('export const apiRoutes')
    expect(content).toContain('export default apiRoutes')
  })

  it('contains orders API route with path and methods', () => {
    expect(content).toContain('path: "/orders"')
    expect(content).toContain('methods:')
  })

  it('products API route has all 4 methods', () => {
    expect(content).toContain('path: "/products"')
    expect(content).toMatch(/methods:.*GET.*POST.*PUT.*DELETE/)
  })
})

// ---------------------------------------------------------------------------
// events.generated.ts
// ---------------------------------------------------------------------------

describe('events.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('events.generated.ts')
  })

  it('exports entries, configs, allEvents, and isEventDeclared', () => {
    expectExports(content, ['eventModuleConfigEntries', 'eventModuleConfigs', 'allEvents', 'isEventDeclared'])
  })

  it('has entries for all 3 modules with events.ts', () => {
    expectModuleIds(content, ['orders', 'products', 'custom_app'])
  })

  it('imports from all event convention files', () => {
    expect(countMatches(content, /import \* as EVENTS_/g)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// notifications.generated.ts
// ---------------------------------------------------------------------------

describe('notifications.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('notifications.generated.ts')
  })

  it('exports entries, types, and helper functions', () => {
    expectExports(content, ['notificationTypeEntries', 'notificationTypes', 'getNotificationTypes', 'getNotificationType'])
  })

  it('has entries for orders and products modules', () => {
    expectModuleIds(content, ['orders', 'products'])
  })

  it('imports from both notification convention files', () => {
    expect(countMatches(content, /import \* as NOTIF_/g)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// notification-handlers.generated.ts
// ---------------------------------------------------------------------------

describe('notification-handlers.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('notification-handlers.generated.ts')
  })

  it('exports notificationHandlerEntries with type annotation', () => {
    expect(content).toContain('export const notificationHandlerEntries: NotificationHandlerEntry[]')
  })

  it('has entry for orders module with handlers property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('handlers:')
  })

  it('imports NotificationHandler type', () => {
    expect(hasTypeImport(content, 'NotificationHandler', '@open-mercato/shared/modules/notifications/handler')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// enrichers.generated.ts
// ---------------------------------------------------------------------------

describe('enrichers.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('enrichers.generated.ts')
  })

  it('exports enricherEntries with type annotation', () => {
    expect(content).toContain('export const enricherEntries: EnricherEntry[]')
  })

  it('has orders module entry with enrichers property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('enrichers:')
  })

  it('imports from data/enrichers.ts', () => {
    expect(content).toMatch(/import \* as ENRICHERS_/)
  })

  it('resolves optional exports without static namespace member access', () => {
    expect(content).not.toContain('.enrichers')
    expect(content).not.toContain('.default')
  })
})

// ---------------------------------------------------------------------------
// interceptors.generated.ts
// ---------------------------------------------------------------------------

describe('interceptors.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('interceptors.generated.ts')
  })

  it('exports interceptorEntries with type annotation', () => {
    expect(content).toContain('export const interceptorEntries: InterceptorEntry[]')
  })

  it('has orders module entry with interceptors property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('interceptors:')
  })

  it('resolves optional exports without static namespace member access', () => {
    expect(content).not.toContain('.interceptors')
    expect(content).not.toContain('.default')
  })
})

// ---------------------------------------------------------------------------
// guards.generated.ts
// ---------------------------------------------------------------------------

describe('guards.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('guards.generated.ts')
  })

  it('exports guardEntries with type annotation', () => {
    expect(content).toContain('export const guardEntries: GuardEntry[]')
  })

  it('has orders module entry with guards property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('guards:')
  })

  it('resolves optional exports without static namespace member access', () => {
    expect(content).not.toContain('.guards')
    expect(content).not.toContain('.default')
  })
})

// ---------------------------------------------------------------------------
// command-interceptors.generated.ts
// ---------------------------------------------------------------------------

describe('command-interceptors.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('command-interceptors.generated.ts')
  })

  it('exports commandInterceptorEntries with type annotation', () => {
    expect(content).toContain('export const commandInterceptorEntries: CommandInterceptorEntry[]')
  })

  it('has orders module entry with interceptors property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('interceptors:')
  })

  it('resolves optional exports without static namespace member access', () => {
    expect(content).not.toContain('.interceptors')
    expect(content).not.toContain('.default')
  })
})

// ---------------------------------------------------------------------------
// component-overrides.generated.ts
// ---------------------------------------------------------------------------

describe('component-overrides.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('component-overrides.generated.ts')
  })

  it('exports componentOverrideEntries with type annotation', () => {
    expect(content).toContain('export const componentOverrideEntries: ComponentOverrideEntry[]')
  })

  it('has orders module entry with componentOverrides property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('componentOverrides:')
  })

  it('imports ComponentOverride type', () => {
    expect(hasTypeImport(content, 'ComponentOverride', '@open-mercato/shared/modules/widgets/component-registry')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// inbox-actions.generated.ts
// ---------------------------------------------------------------------------

describe('inbox-actions.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('inbox-actions.generated.ts')
  })

  it('exports entries, flattened array, and helper functions', () => {
    expectExports(content, ['inboxActionConfigEntries', 'inboxActions', 'getInboxAction', 'getRegisteredActionTypes'])
  })

  it('has orders module entry with actions property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('actions:')
  })
})

// ---------------------------------------------------------------------------
// inbox-ops-sources.generated.ts
// ---------------------------------------------------------------------------

describe('inbox-ops-sources.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('inbox-ops-sources.generated.ts')
  })

  it('exports entries, flattened arrays, and lookup helpers', () => {
    expectExports(content, [
      'inboxOpsSourceConfigEntries',
      'inboxOpsSourceAdapters',
      'getInboxOpsSourceAdapter',
    ])
  })

  it('has orders module entry with adapters property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('adapters:')
  })

  it('imports source adapter types', () => {
    expect(hasTypeImport(content, 'InboxOpsSourceAdapter', '@open-mercato/shared/modules/inbox-ops-sources')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// analytics.generated.ts
// ---------------------------------------------------------------------------

describe('analytics.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('analytics.generated.ts')
  })

  it('exports entries and configs arrays', () => {
    expectExports(content, ['analyticsModuleConfigEntries', 'analyticsModuleConfigs'])
  })

  it('has orders module entry', () => {
    expectModuleIds(content, ['orders'])
  })

  it('imports AnalyticsModuleConfig type', () => {
    expect(hasTypeImport(content, 'AnalyticsModuleConfig', '@open-mercato/shared/modules/analytics')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ai-tools.generated.ts
// ---------------------------------------------------------------------------

describe('ai-tools.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('ai-tools.generated.ts')
  })

  it('exports filtered entries and flattened allAiTools', () => {
    expect(content).toContain('export const aiToolConfigEntries')
    expect(content).toContain('export const allAiTools')
  })

  it('has orders module entry with tools property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('tools:')
  })
})

// ---------------------------------------------------------------------------
// translations-fields.generated.ts
// ---------------------------------------------------------------------------

describe('translations-fields.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('translations-fields.generated.ts')
  })

  it('exports entries, allTranslatableFields, and allTranslatableEntityTypes', () => {
    expectExports(content, ['translatableFieldEntries', 'allTranslatableFields', 'allTranslatableEntityTypes'])
  })

  it('has entries for orders and products modules', () => {
    expectModuleIds(content, ['orders', 'products'])
  })
})

// ---------------------------------------------------------------------------
// message-types.generated.ts
// ---------------------------------------------------------------------------

describe('message-types.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('message-types.generated.ts')
  })

  it('exports entries, flattened types, and helper functions', () => {
    expectExports(content, ['messageTypeEntries', 'messageTypes', 'getMessageTypes', 'getMessageType'])
  })

  it('has orders module entry with types property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('types:')
  })

  it('does not reference removed legacy export aliases', () => {
    expect(content).not.toContain('.types ??')
  })
})

// ---------------------------------------------------------------------------
// message-objects.generated.ts
// ---------------------------------------------------------------------------

describe('message-objects.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('message-objects.generated.ts')
  })

  it('exports entries, flattened types, and helper functions', () => {
    expectExports(content, ['messageObjectTypeEntries', 'messageObjectTypes', 'getMessageObjectTypes', 'getMessageObjectType'])
  })

  it('has orders module entry', () => {
    expectModuleIds(content, ['orders'])
  })

  it('does not reference removed legacy export aliases', () => {
    expect(content).not.toContain('.objectTypes ??')
    expect(content).not.toContain('.types ??')
  })
})

// ---------------------------------------------------------------------------
// Widget files
// ---------------------------------------------------------------------------

describe('dashboard-widgets.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('dashboard-widgets.generated.ts')
  })

  it('exports dashboardWidgetEntries with type annotation', () => {
    expect(content).toContain('export const dashboardWidgetEntries: ModuleDashboardWidgetEntry[]')
  })

  it('has entries for orders and custom_app modules', () => {
    expect(content).toContain('moduleId: "orders"')
    expect(content).toContain('moduleId: "custom_app"')
  })

  it('entries have key, source, and loader function', () => {
    expect(content).toContain('key: "orders:revenue:widget"')
    expect(content).toContain('source: "package"')
    expect(content).toContain('source: "app"')
    expect(content).toContain('loader: () =>')
  })
})

describe('injection-widgets.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('injection-widgets.generated.ts')
  })

  it('exports injectionWidgetEntries with type annotation', () => {
    expect(content).toContain('export const injectionWidgetEntries: ModuleInjectionWidgetEntry[]')
  })

  it('has entry for orders sidebar injection widget', () => {
    expect(content).toContain('moduleId: "orders"')
    expect(content).toContain('key: "orders:sidebar:widget"')
  })
})

describe('injection-tables.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('injection-tables.generated.ts')
  })

  it('exports injectionTables with type annotation', () => {
    expect(content).toContain('export const injectionTables')
  })

  it('has orders module entry with table property', () => {
    expect(content).toContain('moduleId: "orders"')
    expect(content).toContain('table:')
  })
})

// ---------------------------------------------------------------------------
// Middleware files
// ---------------------------------------------------------------------------

describe('frontend-middleware.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('frontend-middleware.generated.ts')
  })

  it('exports frontendMiddlewareEntries', () => {
    expect(content).toContain('export const frontendMiddlewareEntries')
  })

  it('has orders module entry with middleware property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('middleware:')
  })
})

describe('backend-middleware.generated.ts', () => {
  let content: string

  beforeEach(async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    content = readGenerated('backend-middleware.generated.ts')
  })

  it('exports backendMiddlewareEntries', () => {
    expect(content).toContain('export const backendMiddlewareEntries')
  })

  it('has orders module entry with middleware property', () => {
    expectModuleIds(content, ['orders'])
    expect(content).toContain('middleware:')
  })
})

// ---------------------------------------------------------------------------
// Search (empty because no search.ts in fixture, but exports still present)
// ---------------------------------------------------------------------------

describe('search.generated.ts', () => {
  it('exports searchModuleConfigEntries and searchModuleConfigs even when empty', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistry({ resolver, quiet: true })
    const content = readGenerated('search.generated.ts')

    expectExports(content, ['searchModuleConfigEntries', 'searchModuleConfigs'])
    expect(hasTypeImport(content, 'SearchModuleConfig', '@open-mercato/shared/modules/search')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// modules.app.generated.ts
// ---------------------------------------------------------------------------

describe('modules.app.generated.ts', () => {
  it('exports modules array and default, contains all module IDs', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryApp({ resolver, quiet: true })
    const content = readGenerated('modules.app.generated.ts')

    expect(content).toContain('export const modules: Module[] = [')
    expect(content).toContain('export default modules')
    expect(content).toContain('id: "orders"')
    expect(content).toContain('id: "products"')
    expect(content).toContain('id: "custom_app"')
  })

  it('includes runtime frontend/backend routes and excludes CLI commands', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryApp({ resolver, quiet: true })
    const content = readGenerated('modules.app.generated.ts')

    expect(content).toContain('frontendRoutes:')
    expect(content).toContain('backendRoutes:')
    expect(content).toContain('createElement')
    expect(content).not.toContain('cli:')
  })

  it('includes subscribers and workers', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryApp({ resolver, quiet: true })
    const content = readGenerated('modules.app.generated.ts')

    expect(content).toContain('subscribers:')
    expect(content).toContain('orders.order.created')
  })
})

describe('bootstrap-modules.generated.ts', () => {
  it('exports legacy bootstrapModules alias from modules.app.generated.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryApp({ resolver, quiet: true })
    const content = readGenerated('bootstrap-modules.generated.ts')

    expect(content).toContain('modules.app.generated')
    expect(content).toContain('export const bootstrapModules: Module[] = modules')
  })
})

// ---------------------------------------------------------------------------
// modules.cli.generated.ts
// ---------------------------------------------------------------------------

describe('modules.cli.generated.ts', () => {
  it('exports modules array, contains all module IDs', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryCli({ resolver, quiet: true })
    const content = readGenerated('modules.cli.generated.ts')

    expect(content).toContain('export const modules: Module[] = [')
    expect(content).toContain('id: "orders"')
    expect(content).toContain('id: "products"')
    expect(content).toContain('id: "custom_app"')
  })

  it('excludes frontend/backend routes and APIs', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryCli({ resolver, quiet: true })
    const content = readGenerated('modules.cli.generated.ts')

    expect(content).not.toContain('frontendRoutes:')
    expect(content).not.toContain('backendRoutes:')
    expect(content).not.toContain('apis:')
  })

  it('includes subscribers, workers, features, and setup', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryCli({ resolver, quiet: true })
    const content = readGenerated('modules.cli.generated.ts')

    expect(content).toContain('subscribers:')
    expect(content).toContain('features:')
    expect(content).toContain('setup:')
  })
})

describe('cli-modules.generated.ts', () => {
  it('exports legacy cliModules alias from modules.cli.generated.ts', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)
    await generateModuleRegistryCli({ resolver, quiet: true })
    const content = readGenerated('cli-modules.generated.ts')

    expect(content).toContain('modules.cli.generated')
    expect(content).toContain("export const cliModules: Pick<Module, 'id' | 'cli'>[]")
    expect(content).toContain('modules.map(({ id, cli }) => ({')
    expect(content).toContain('id: id')
    expect(content).toContain('cli: cli')
  })
})
