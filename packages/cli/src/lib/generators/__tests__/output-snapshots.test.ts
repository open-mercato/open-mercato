/**
 * Snapshot tests for all generated output files.
 *
 * These tests scaffold a comprehensive module set that exercises EVERY convention
 * file type — search, events, notifications, messages, widgets, enrichers,
 * interceptors, guards, etc. — so that every sub-generator within module-registry.ts
 * produces non-empty output in the snapshots.
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
// Fixture: scaffold modules that exercise EVERY convention file type
// ---------------------------------------------------------------------------

function scaffoldFixture(): ModuleEntry[] {
  // =========================================================================
  // Module 1: "orders" — full-featured core module
  //   Exercises: index, frontend page, backend page + meta, detail page,
  //   API route (GET+POST), subscribers, workers, dashboard widgets,
  //   injection widgets, entities, ACL, setup, DI, i18n,
  //   events, notifications, notification handlers, enrichers,
  //   api interceptors, guards, command interceptors, translations,
  //   inbox actions, analytics, middleware, injection table
  // =========================================================================

  touchFile(
    pkgModulePath('orders', 'index.ts'),
    "export const metadata = { id: 'orders', label: 'Orders' }\n",
  )

  // -- Pages --
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

  // -- API routes --
  touchFile(
    pkgModulePath('orders', 'api', 'orders', 'route.ts'),
    `export const metadata = { path: '/orders' }
export const openApi = { get: { summary: 'List orders' } }
export function GET() { return new Response('ok') }
export function POST() { return new Response('created') }
`,
  )

  // -- Subscribers --
  touchFile(
    pkgModulePath('orders', 'subscribers', 'on-created.ts'),
    "export const metadata = { event: 'orders.order.created', persistent: true }\nexport default async function handler() {}\n",
  )
  touchFile(
    pkgModulePath('orders', 'subscribers', 'on-payment.ts'),
    "export const metadata = { event: 'payments.payment.completed', persistent: true }\nexport default async function handler() {}\n",
  )

  // -- Workers --
  touchFile(
    pkgModulePath('orders', 'workers', 'sync-job.ts'),
    "export const metadata = { queue: 'orders.sync', concurrency: 2 }\nexport default async function handler() {}\n",
  )

  // -- Dashboard widgets --
  touchFile(
    pkgModulePath('orders', 'widgets', 'dashboard', 'revenue', 'widget.tsx'),
    'export default function RevenueWidget() { return null }\n',
  )

  // -- Injection widgets --
  touchFile(
    pkgModulePath('orders', 'widgets', 'injection', 'sidebar', 'widget.tsx'),
    'export default function SidebarWidget() { return null }\n',
  )

  // -- Injection table --
  touchFile(
    pkgModulePath('orders', 'widgets', 'injection-table.ts'),
    `export const injectionTable = {
  'crud-form:orders:sales_order:fields': [{ widgetId: 'orders.sidebar', kind: 'section', priority: 50 }],
}
export default injectionTable
`,
  )

  // -- Entities --
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

  // -- ACL + Setup --
  touchFile(
    pkgModulePath('orders', 'acl.ts'),
    "export const features = ['orders.view', 'orders.create', 'orders.edit', 'orders.delete']\n",
  )
  touchFile(
    pkgModulePath('orders', 'setup.ts'),
    "export const setup = { defaultRoleFeatures: ['orders.view'] }\n",
  )

  // -- DI --
  touchFile(
    pkgModulePath('orders', 'di.ts'),
    'export function register(container: any) { /* orders DI */ }\n',
  )

  // -- i18n --
  touchFile(
    pkgModulePath('orders', 'i18n', 'en.json'),
    JSON.stringify({ orders: { list: { title: 'Orders' } } }),
  )
  touchFile(
    pkgModulePath('orders', 'i18n', 'pl.json'),
    JSON.stringify({ orders: { list: { title: 'Zam\u00f3wienia' } } }),
  )

  // -- Events --
  touchFile(
    pkgModulePath('orders', 'events.ts'),
    `export const eventsConfig = {
  moduleId: 'orders',
  events: [
    { id: 'orders.order.created', label: 'Order Created', entity: 'sales_order', category: 'crud' },
    { id: 'orders.order.updated', label: 'Order Updated', entity: 'sales_order', category: 'crud' },
  ]
}
export default eventsConfig
`,
  )

  // -- Notifications --
  touchFile(
    pkgModulePath('orders', 'notifications.ts'),
    `export const notificationTypes = [
  {
    type: 'orders.order.created',
    module: 'orders',
    titleKey: 'orders.notifications.created.title',
    bodyKey: 'orders.notifications.created.body',
    icon: 'package',
    severity: 'info',
  },
]
export default notificationTypes
`,
  )

  // -- Notification handlers --
  touchFile(
    pkgModulePath('orders', 'notifications.handlers.ts'),
    `export const notificationHandlers = [
  {
    type: 'orders.order.created',
    handler: async (notification: any, context: any) => { /* handle */ },
  },
]
export default notificationHandlers
`,
  )

  // -- Enrichers --
  touchFile(
    pkgModulePath('orders', 'data', 'enrichers.ts'),
    `export const enrichers = [
  {
    id: 'orders.item-count',
    targetEntity: 'orders:sales_order',
    features: ['orders.view'],
    priority: 10,
    timeout: 2000,
    critical: false,
    async enrichOne(record: any) { return { ...record, _itemCount: 0 } },
    async enrichMany(records: any[]) { return records.map(r => ({ ...r, _itemCount: 0 })) },
  },
]
`,
  )

  // -- API interceptors --
  touchFile(
    pkgModulePath('orders', 'api', 'interceptors.ts'),
    `export const interceptors = [
  {
    id: 'orders.validate-total',
    targetRoute: 'orders',
    methods: ['POST', 'PUT'],
    priority: 100,
    async before(request: any) { return { ok: true } },
  },
]
`,
  )

  // -- Guards --
  touchFile(
    pkgModulePath('orders', 'data', 'guards.ts'),
    `export const guards = [
  {
    id: 'orders.prevent-duplicate',
    entity: 'orders:sales_order',
    event: 'create',
    description: 'Prevents duplicate orders',
    async validate(input: any) { return { ok: true } },
  },
]
`,
  )

  // -- Command interceptors --
  touchFile(
    pkgModulePath('orders', 'commands', 'interceptors.ts'),
    `export const interceptors = [
  {
    id: 'orders.audit-log',
    commandId: 'orders.create',
    phase: 'after',
    async handler(command: any) { return { ok: true } },
  },
]
`,
  )

  // -- Translations --
  touchFile(
    pkgModulePath('orders', 'translations.ts'),
    `export const translatableFields = {
  'orders:sales_order': ['status_label', 'notes'],
  'orders:order_item': ['product_name'],
}
export default translatableFields
`,
  )

  // -- Inbox actions --
  touchFile(
    pkgModulePath('orders', 'inbox-actions.ts'),
    `export const inboxActions = [
  {
    type: 'orders.approve',
    id: 'orders.approve-order',
    label: 'Approve Order',
    icon: 'check',
    description: 'Approve a pending order',
    async execute(action: any) { return { ok: true } },
  },
]
export default inboxActions
`,
  )

  // -- Analytics --
  touchFile(
    pkgModulePath('orders', 'analytics.ts'),
    `export const analyticsConfig = {
  entities: [
    {
      entityId: 'orders:sales_order',
      requiredFeatures: ['orders.view'],
      entityConfig: { tableName: 'sales_orders', dateField: 'created_at' },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        totalGross: { dbColumn: 'total_gross', type: 'numeric' },
      },
    },
  ],
}
export default analyticsConfig
`,
  )

  // -- AI tools --
  touchFile(
    pkgModulePath('orders', 'ai-tools.ts'),
    `export const aiTools = [
  {
    name: 'list_orders',
    description: 'List recent orders',
    inputSchema: {},
    requiredFeatures: ['orders.view'],
  },
]
export default aiTools
`,
  )

  // -- AI agents --
  touchFile(
    pkgModulePath('orders', 'ai-agents.ts'),
    `export const aiAgents = [
  {
    id: 'orders.assistant',
    module: 'orders',
    displayName: 'Orders Assistant',
    allowedTools: ['list_orders'],
    readOnly: true,
  },
]
export default aiAgents
`,
  )

  // -- Frontend middleware --
  touchFile(
    pkgModulePath('orders', 'frontend', 'middleware.ts'),
    `export const middleware = [
  {
    id: 'orders.auth-check',
    pattern: '/orders/**',
    handler: async (req: any) => req,
  },
]
export default middleware
`,
  )

  // -- Backend middleware --
  touchFile(
    pkgModulePath('orders', 'backend', 'middleware.ts'),
    `export const middleware = [
  {
    id: 'orders.admin-check',
    pattern: '/backend/orders/**',
    handler: async (req: any) => req,
  },
]
export default middleware
`,
  )

  // -- Component overrides --
  touchFile(
    pkgModulePath('orders', 'widgets', 'components.ts'),
    `export const componentOverrides = [
  {
    targetId: 'page:orders/list',
    mode: 'wrapper',
    component: () => null,
  },
]
export default componentOverrides
`,
  )

  // -- Custom entities (ce.ts) --
  touchFile(
    pkgModulePath('orders', 'ce.ts'),
    `export const entities = [
  {
    id: 'orders:custom_field_set',
    label: 'Order Custom Fields',
    description: 'Custom fields for orders',
    fields: [
      { id: 'priority', type: 'text', label: 'Priority' },
    ],
  },
]
`,
  )

  // -- Extensions --
  touchFile(
    pkgModulePath('orders', 'data', 'extensions.ts'),
    `export const extensions = [
  { sourceEntity: 'orders:sales_order', targetEntity: 'customers:person', foreignKey: 'customer_id' },
]
`,
  )

  // -- Message types --
  touchFile(
    pkgModulePath('orders', 'message-types.ts'),
    `export const messageTypes = [
  {
    type: 'orders.order_confirmation',
    module: 'orders',
    labelKey: 'orders.messages.confirmation.label',
    icon: 'mail',
    color: 'blue',
    allowReply: false,
    allowForward: true,
  },
]
export default messageTypes
`,
  )

  // -- Message objects --
  touchFile(
    pkgModulePath('orders', 'message-objects.ts'),
    `export const messageObjectTypes = [
  {
    module: 'orders',
    entityType: 'sales_order',
    messageTypes: ['orders.order_confirmation'],
    entityId: 'orders:sales_order',
    optionLabelField: 'id',
    labelKey: 'orders.messages.objects.order.label',
    icon: 'package',
  },
]
export default messageObjectTypes
`,
  )

  // =========================================================================
  // Module 2: "products" — core module with search, events, translations
  // =========================================================================

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
  touchFile(
    pkgModulePath('products', 'events.ts'),
    `export const eventsConfig = {
  moduleId: 'products',
  events: [
    { id: 'products.product.created', label: 'Product Created', entity: 'product', category: 'crud' },
  ]
}
export default eventsConfig
`,
  )
  touchFile(
    pkgModulePath('products', 'notifications.ts'),
    `export const notificationTypes = [
  {
    type: 'products.low_stock',
    module: 'products',
    titleKey: 'products.notifications.low_stock.title',
    bodyKey: 'products.notifications.low_stock.body',
    icon: 'alert-triangle',
    severity: 'warning',
  },
]
export default notificationTypes
`,
  )

  // =========================================================================
  // Module 3: "custom_app" — app-level module (from: '@app')
  //   Exercises: app-owned pages, subscribers, dashboard widgets, DI, entities
  // =========================================================================

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
  // -- App-level worker (exercises .ts source metadata extraction with variable reference) --
  touchFile(
    appModulePath('custom_app', 'workers', 'background-task.ts'),
    "const CUSTOM_QUEUE = 'custom-app-tasks'\nexport const metadata = { queue: CUSTOM_QUEUE, concurrency: 3 }\nexport default async function handler() {}\n",
  )
  touchFile(
    appModulePath('custom_app', 'events.ts'),
    `export const eventsConfig = {
  moduleId: 'custom_app',
  events: [
    { id: 'custom_app.action.fired', label: 'Action Fired', entity: 'custom_record', category: 'lifecycle' },
  ]
}
export default eventsConfig
`,
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

function listGeneratedTsFiles(): string[] {
  return fs.readdirSync(outputDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.checksum'))
    .sort()
}

function captureGeneratedFiles(): Map<string, string> {
  const captured = new Map<string, string>()
  for (const file of listGeneratedTsFiles()) {
    const content = readGenerated(file)
    if (content) {
      captured.set(file, content)
    }
  }
  return captured
}

describe('generator output compatibility', () => {
  const registryFiles = [
    'ai-tools.generated.ts',
    'ai-agents.generated.ts',
    'analytics.generated.ts',
    'api-routes.generated.ts',
    'backend-middleware.generated.ts',
    'backend-routes.generated.ts',
    'bootstrap-modules.generated.ts',
    'bootstrap-registrations.generated.ts',
    'cli-modules.generated.ts',
    'command-interceptors.generated.ts',
    'component-overrides.generated.ts',
    'dashboard-widgets.generated.ts',
    'events.generated.ts',
    'frontend-middleware.generated.ts',
    'frontend-routes.generated.ts',
    'guards.generated.ts',
    'inbox-actions.generated.ts',
    'injection-tables.generated.ts',
    'injection-widgets.generated.ts',
    'interceptors.generated.ts',
    'message-objects.generated.ts',
    'message-types.generated.ts',
    'messages.client.generated.ts',
    'modules.generated.ts',
    'modules.runtime.generated.ts',
    'notification-handlers.generated.ts',
    'notifications.client.generated.ts',
    'notifications.generated.ts',
    'payments.client.generated.ts',
    'search.generated.ts',
    'subscribers.generated.ts',
    'translations-fields.generated.ts',
  ]

  it('writes the expected file inventory for the full fixture', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })
    await generateModuleRegistryApp({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const generatedFiles = listGeneratedTsFiles()
    expect(generatedFiles).toEqual(expect.arrayContaining([
      ...registryFiles,
      'di.generated.ts',
      'entities.generated.ts',
      'entities.ids.generated.ts',
      'entity-fields-registry.ts',
      'modules.app.generated.ts',
      'modules.cli.generated.ts',
    ]))
  })

  it('is idempotent for the full fixture', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })
    await generateModuleRegistryApp({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const firstRun = captureGeneratedFiles()

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })
    await generateModuleRegistryApp({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const secondRun = captureGeneratedFiles()
    expect(secondRun).toEqual(firstRun)
  })

  it('includes app-level workers with variable-referenced queue names in generated output', async () => {
    const enabled = scaffoldFixture()
    const resolver = createMockResolver(enabled)

    await generateModuleRegistry({ resolver, quiet: true })

    const modulesContent = readGenerated('modules.generated.ts')
    expect(modulesContent).not.toBeNull()
    expect(modulesContent).toContain('custom-app-tasks')
    expect(modulesContent).toContain('background-task')
  })

  it('writes the expected minimal inventory with zero modules enabled', async () => {
    const resolver = createMockResolver([])

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    await generateModuleEntities({ resolver, quiet: true })
    await generateEntityIds({ resolver, quiet: true })
    await generateModuleRegistryApp({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const generatedFiles = listGeneratedTsFiles()
    expect(generatedFiles).toEqual(expect.arrayContaining([
      ...registryFiles,
      'di.generated.ts',
      'entities.generated.ts',
      'entities.ids.generated.ts',
      'entity-fields-registry.ts',
      'modules.app.generated.ts',
      'modules.cli.generated.ts',
    ]))
  })
})
