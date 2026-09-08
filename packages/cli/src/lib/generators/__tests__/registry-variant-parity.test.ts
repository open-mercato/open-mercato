/**
 * Cross-implementation parity between the two module registry variants.
 *
 * `generateModuleRegistry` (modules.generated.ts / modules.runtime.generated.ts) and
 * `generateModuleRegistryApp` (modules.app.generated.ts) describe the same modules from
 * the same discovery input. Nothing asserted that they agree, which is what let the two
 * emitters drift far enough apart to need this migration in the first place.
 *
 * These tests generate every variant from one fixture, parse the emitted module entries,
 * and assert that for each module id the properties both variants are expected to carry
 * are present or absent identically. Properties only one variant is supposed to carry are
 * asserted explicitly as known, intentional divergences, so a future change that erases or
 * widens one of them fails here rather than silently.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import ts from 'typescript-js'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryApp } from '../module-registry'

/** Properties both registry variants must agree on, per module. */
const SHARED_PROPERTIES = [
  'id',
  'info',
  'frontendRoutes',
  'backendRoutes',
  'translations',
  'subscribers',
  'workers',
  'entityExtensions',
  'customFieldSets',
  'features',
  'customEntities',
  'setup',
  'defaultEncryptionMaps',
  'integrations',
  'bundles',
] as const

let tmpDir: string
let outputDir: string
let fileMtimeNonce = 0

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
  } as unknown as PackageResolver
}

/**
 * A module carrying every optional property, plus a deliberately bare one, so the
 * parity assertions cover both the "present in both" and "absent in both" directions.
 */
function scaffoldFixture(): ModuleEntry[] {
  touchFile(pkgModulePath('orders', 'index.ts'), "export const metadata = { id: 'orders', label: 'Orders' }\n")
  touchFile(pkgModulePath('orders', 'frontend', 'page.tsx'), 'export default function OrdersPage() { return null }\n')
  touchFile(pkgModulePath('orders', 'backend', 'page.tsx'), 'export default function OrdersBackendPage() { return null }\n')
  touchFile(
    pkgModulePath('orders', 'api', 'orders', 'route.ts'),
    "export const metadata = { path: '/orders' }\nexport function GET() { return new Response('ok') }\n",
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
    pkgModulePath('orders', 'data', 'extensions.ts'),
    "export const extensions = [{ sourceEntity: 'orders:sales_order', targetEntity: 'customers:person', foreignKey: 'customer_id' }]\n",
  )
  touchFile(pkgModulePath('orders', 'acl.ts'), "export const features = ['orders.view', 'orders.create']\n")
  touchFile(pkgModulePath('orders', 'setup.ts'), "export const setup = { defaultRoleFeatures: ['orders.view'] }\n")
  touchFile(
    pkgModulePath('orders', 'encryption.ts'),
    "export const defaultEncryptionMaps = [{ entityId: 'orders:sales_order', fields: [{ field: 'customer_email' }] }]\nexport default defaultEncryptionMaps\n",
  )
  touchFile(
    pkgModulePath('orders', 'integration.ts'),
    "export const integration = { id: 'orders.shipping', label: 'Shipping' }\nexport const bundle = { id: 'orders.bundle', label: 'Bundle' }\n",
  )
  touchFile(pkgModulePath('orders', 'ce.ts'), "export const entities = [{ id: 'orders:custom', fields: [{ id: 'note', kind: 'text' }] }]\n")
  touchFile(pkgModulePath('orders', 'i18n', 'en.json'), JSON.stringify({ orders: { title: 'Orders' } }))
  touchFile(pkgModulePath('orders', 'cli.ts'), 'export default { command: "orders", run: async () => {} }\n')

  touchFile(pkgModulePath('bare', 'index.ts'), "export const metadata = { id: 'bare', label: 'Bare' }\n")

  return [
    { id: 'orders', from: '@open-mercato/core' },
    { id: 'bare', from: '@open-mercato/core' },
  ]
}

function readGenerated(fileName: string): string {
  const filePath = path.join(outputDir, fileName)
  if (!fs.existsSync(filePath)) throw new Error(`Expected generated file not found: ${fileName}`)
  return fs.readFileSync(filePath, 'utf8')
}

/** Maps module id → the set of property names that module's entry declares. */
function parseModulePropertiesById(content: string, fileName: string): Map<string, Set<string>> {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  let modulesArray: ts.ArrayLiteralExpression | null = null
  const visit = (node: ts.Node): void => {
    if (
      !modulesArray
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'modules'
      && node.initializer
      && ts.isArrayLiteralExpression(node.initializer)
    ) {
      modulesArray = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!modulesArray) throw new Error(`No exported "modules" array literal found in ${fileName}`)

  const byId = new Map<string, Set<string>>()
  for (const element of (modulesArray as ts.ArrayLiteralExpression).elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`Non-object module entry in ${fileName}`)
    }
    const names = new Set<string>()
    let moduleId: string | null = null
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : null
      if (!name) continue
      names.add(name)
      if (name === 'id' && ts.isStringLiteralLike(property.initializer)) {
        moduleId = property.initializer.text
      }
    }
    if (!moduleId) throw new Error(`Module entry without a literal id in ${fileName}`)
    byId.set(moduleId, names)
  }
  return byId
}

function restrictTo(names: Set<string>, allowed: readonly string[]): string[] {
  return allowed.filter((name) => names.has(name)).sort()
}

describe('module registry variant parity', () => {
  let mainVariant: Map<string, Set<string>>
  let runtimeVariant: Map<string, Set<string>>
  let appVariant: Map<string, Set<string>>

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-parity-'))
    outputDir = path.join(tmpDir, 'app', '.mercato', 'generated')
    fs.mkdirSync(outputDir, { recursive: true })

    const resolver = createMockResolver(scaffoldFixture())
    const mainResult = await generateModuleRegistry({ resolver, quiet: true })
    const appResult = await generateModuleRegistryApp({ resolver, quiet: true })
    expect(mainResult.errors).toEqual([])
    expect(appResult.errors).toEqual([])

    mainVariant = parseModulePropertiesById(readGenerated('modules.generated.ts'), 'modules.generated.ts')
    runtimeVariant = parseModulePropertiesById(
      readGenerated('modules.runtime.generated.ts'),
      'modules.runtime.generated.ts',
    )
    appVariant = parseModulePropertiesById(readGenerated('modules.app.generated.ts'), 'modules.app.generated.ts')
  })

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('discovers the same module ids in every variant', () => {
    const ids = [...mainVariant.keys()].sort()
    expect(ids).toEqual(['bare', 'orders'])
    expect([...runtimeVariant.keys()].sort()).toEqual(ids)
    expect([...appVariant.keys()].sort()).toEqual(ids)
  })

  it.each(['orders', 'bare'])('main and app variants agree on the shared properties of "%s"', (moduleId) => {
    const main = mainVariant.get(moduleId)
    const app = appVariant.get(moduleId)
    expect(main).toBeDefined()
    expect(app).toBeDefined()
    expect(restrictTo(main!, SHARED_PROPERTIES)).toEqual(restrictTo(app!, SHARED_PROPERTIES))
  })

  it.each(['orders', 'bare'])('main and runtime variants agree on the shared properties of "%s"', (moduleId) => {
    const main = mainVariant.get(moduleId)
    const runtime = runtimeVariant.get(moduleId)
    expect(main).toBeDefined()
    expect(runtime).toBeDefined()
    expect(restrictTo(main!, SHARED_PROPERTIES)).toEqual(restrictTo(runtime!, SHARED_PROPERTIES))
  })

  it('carries every optional property for the fully-featured module', () => {
    expect(restrictTo(mainVariant.get('orders')!, SHARED_PROPERTIES)).toEqual([...SHARED_PROPERTIES].sort())
  })

  it('omits every optional property for the bare module', () => {
    expect(restrictTo(mainVariant.get('bare')!, SHARED_PROPERTIES)).toEqual(['customFieldSets', 'id', 'info'])
  })

  describe('known, intentional divergences', () => {
    it('only the main variant carries eager api handlers and the cli entry point', () => {
      expect(mainVariant.get('orders')!.has('apis')).toBe(true)
      expect(mainVariant.get('orders')!.has('cli')).toBe(true)
      expect(appVariant.get('orders')!.has('apis')).toBe(false)
      expect(appVariant.get('orders')!.has('cli')).toBe(false)
    })

    it('the runtime variant carries api handlers but not the cli entry point', () => {
      expect(runtimeVariant.get('orders')!.has('apis')).toBe(true)
      expect(runtimeVariant.get('orders')!.has('cli')).toBe(false)
    })

    it('only the main and app variants carry dashboardWidgets, and only the app variant emits it unconditionally', () => {
      expect(mainVariant.get('bare')!.has('dashboardWidgets')).toBe(false)
      expect(appVariant.get('bare')!.has('dashboardWidgets')).toBe(true)
      expect(runtimeVariant.get('orders')!.has('dashboardWidgets')).toBe(false)
    })
  })
})
