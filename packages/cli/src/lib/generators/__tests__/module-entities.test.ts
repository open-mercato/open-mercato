import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleEntities } from '../module-entities'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'module-entities-test-'))
}

function touchFile(filePath: string, content = 'export {}\n'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createMockResolver(tmpRoot: string, enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(tmpRoot, 'app', '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })

  return {
    isMonorepo: () => true,
    getRootDir: () => tmpRoot,
    getAppDir: () => path.join(tmpRoot, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpRoot, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpRoot, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(tmpRoot, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpRoot, 'packages', 'core'),
  }
}

function readGenerated(tmpRoot: string): string {
  return fs.readFileSync(path.join(tmpRoot, 'app', '.mercato', 'generated', 'entities.generated.ts'), 'utf8')
}

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateModuleEntities', () => {
  it('prefers app data entities over package override files for package-backed modules', async () => {
    const moduleEntry: ModuleEntry = { id: 'orders', from: '@open-mercato/core' }

    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'orders', 'data', 'entities.ts'),
      'export class AppOrder {}\n',
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'data', 'entities.override.ts'),
      'export class PackageOverrideOrder {}\n',
    )

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const result = await generateModuleEntities({ resolver, quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "@/modules/orders/data/entities"')
    expect(output).not.toContain('@open-mercato/core/modules/orders/data/entities.override')
    expect(output).toContain('...enhanceEntities(E_orders_0, "orders")')
  })

  it('uses relative imports for app-backed modules', async () => {
    const moduleEntry: ModuleEntry = { id: 'custom_app', from: '@app' }

    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'custom_app', 'data', 'entities.ts'),
      'export class CustomRecord {}\n',
    )

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const result = await generateModuleEntities({ resolver, quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "../../src/modules/custom_app/data/entities"')
    expect(output).not.toContain('@/modules/custom_app/data/entities')
  })

  it('falls back to legacy db schema files when data entities are missing', async () => {
    const moduleEntry: ModuleEntry = { id: 'legacy_orders', from: '@open-mercato/core' }

    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'legacy_orders', 'db', 'schema.js'),
      'export class LegacyOrder {}\n',
    )

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const result = await generateModuleEntities({ resolver, quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "@open-mercato/core/modules/legacy_orders/db/schema"')
    expect(output).toContain('...enhanceEntities(E_legacy_orders_0, "legacy_orders")')
  })

  it('marks the generated file as unchanged when the checksum matches', async () => {
    const moduleEntry: ModuleEntry = { id: 'orders', from: '@open-mercato/core' }

    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'data', 'entities.ts'),
      'export class SalesOrder {}\n',
    )

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const outFile = path.join(tmpDir, 'app', '.mercato', 'generated', 'entities.generated.ts')
    const checksumFile = path.join(tmpDir, 'app', '.mercato', 'generated', 'entities.generated.checksum')

    const firstResult = await generateModuleEntities({ resolver, quiet: true })
    const firstStat = fs.statSync(outFile)
    const secondResult = await generateModuleEntities({ resolver, quiet: true })
    const secondStat = fs.statSync(outFile)

    expect(firstResult.errors).toEqual([])
    expect(firstResult.filesWritten).toEqual([outFile])
    expect(fs.existsSync(checksumFile)).toBe(true)
    expect(secondResult.errors).toEqual([])
    expect(secondResult.filesWritten).toEqual([])
    expect(secondResult.filesUnchanged).toEqual([outFile])
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
  })
})

describe('generateModuleEntities duplicate entity class names', () => {
  const entitySource = (className: string, tableName: string) =>
    `import { Entity } from '@mikro-orm/decorators/legacy'\n\n@Entity({ tableName: '${tableName}' })\nexport class ${className} {}\n`

  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function moduleWithEntities(id: string, content: string): ModuleEntry {
    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', id, 'data', 'entities.ts'), content)
    return { id, from: '@open-mercato/core' }
  }

  it('warns when two modules declare the same entity class name, and still generates', async () => {
    const modules = [
      moduleWithEntities('billing', entitySource('Invoice', 'billing_invoices')),
      moduleWithEntities('subscriptions', entitySource('Invoice', 'subscription_invoices')),
    ]

    const result = await generateModuleEntities({ resolver: createMockResolver(tmpDir, modules), quiet: true })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0][0] as string
    expect(message).toContain('[Entities Warning]')
    expect(message).toContain('Invoice')
    expect(message).toContain('billing')
    expect(message).toContain('subscriptions')
    // Warning-only by design: generation still succeeds.
    expect(result.errors).toEqual([])
    expect(readGenerated(tmpDir)).toContain('enhanceEntities')
  })

  it('stays silent when entity class names are unique', async () => {
    const modules = [
      moduleWithEntities('billing', entitySource('Invoice', 'billing_invoices')),
      moduleWithEntities('subscriptions', entitySource('Subscription', 'subscriptions')),
    ]

    await generateModuleEntities({ resolver: createMockResolver(tmpDir, modules), quiet: true })

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays silent when only one of the colliding classes is an entity', async () => {
    const modules = [
      moduleWithEntities('billing', entitySource('Invoice', 'billing_invoices')),
      moduleWithEntities('subscriptions', 'export class Invoice {}\n'),
    ]

    await generateModuleEntities({ resolver: createMockResolver(tmpDir, modules), quiet: true })

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('generateModuleEntities duplicate detection in standalone installs', () => {
  // A standalone install resolves a package module to its compiled dist tree, where a
  // decorated class is no longer a class declaration. Published packages ship
  // src/modules too, so parsing prefers that mirror and falls back to the compiled file.
  const PACKAGE = '@open-mercato/core'

  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function packageRoot(): string {
    return path.join(tmpDir, 'app', 'node_modules', PACKAGE)
  }

  function createStandaloneResolver(enabled: ModuleEntry[]): PackageResolver {
    const outputDir = path.join(tmpDir, 'app', '.mercato', 'generated')
    fs.mkdirSync(outputDir, { recursive: true })

    return {
      isMonorepo: () => false,
      getRootDir: () => path.join(tmpDir, 'app'),
      getAppDir: () => path.join(tmpDir, 'app'),
      getOutputDir: () => outputDir,
      getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
      discoverPackages: () => [],
      loadEnabledModules: () => enabled,
      getModulePaths: (entry: ModuleEntry) => ({
        appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
        pkgBase: path.join(packageRoot(), 'dist', 'modules', entry.id),
      }),
      getModuleImportBase: (entry: ModuleEntry) => ({
        appBase: `@/modules/${entry.id}`,
        pkgBase: `${PACKAGE}/modules/${entry.id}`,
      }),
      getPackageOutputDir: () => outputDir,
      getPackageRoot: () => packageRoot(),
    }
  }

  const compiledEntity = (className: string, tableName: string) => `
import { Entity } from "@mikro-orm/decorators/legacy";
let ${className} = class {
};
${className} = __decorateClass([
  Entity({ tableName: "${tableName}" })
], ${className});
export {
  ${className}
};
`

  const sourceEntity = (className: string, tableName: string) =>
    `import { Entity } from '@mikro-orm/decorators/legacy'\n\n@Entity({ tableName: '${tableName}' })\nexport class ${className} {}\n`

  function distModule(id: string, className: string, tableName: string): ModuleEntry {
    touchFile(path.join(packageRoot(), 'dist', 'modules', id, 'data', 'entities.js'), compiledEntity(className, tableName))
    return { id, from: PACKAGE }
  }

  function withSourceMirror(id: string, className: string, tableName: string): void {
    touchFile(path.join(packageRoot(), 'src', 'modules', id, 'data', 'entities.ts'), sourceEntity(className, tableName))
  }

  it('detects a package-to-package collision through the shipped source mirror', async () => {
    const modules = [
      distModule('billing', 'Invoice', 'billing_invoices'),
      distModule('subscriptions', 'Invoice', 'subscription_invoices'),
    ]
    withSourceMirror('billing', 'Invoice', 'billing_invoices')
    withSourceMirror('subscriptions', 'Invoice', 'subscription_invoices')

    const result = await generateModuleEntities({ resolver: createStandaloneResolver(modules), quiet: true })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0][0] as string
    expect(message).toContain('Invoice')
    expect(message).toContain(path.join('src', 'modules', 'billing', 'data', 'entities.ts'))
    expect(result.errors).toEqual([])
    // The runtime import still points at the compiled package entry.
    expect(readGenerated(tmpDir)).toContain(`from "${PACKAGE}/modules/billing/data/entities"`)
  })

  it('detects the collision from compiled output when a package ships dist only', async () => {
    const modules = [
      distModule('billing', 'Invoice', 'billing_invoices'),
      distModule('subscriptions', 'Invoice', 'subscription_invoices'),
    ]

    await generateModuleEntities({ resolver: createStandaloneResolver(modules), quiet: true })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0][0] as string
    expect(message).toContain('Invoice')
    expect(message).toContain(path.join('dist', 'modules', 'subscriptions', 'data', 'entities.js'))
  })

  it('detects a package-to-app collision', async () => {
    const modules = [
      distModule('billing', 'Invoice', 'billing_invoices'),
      { id: 'reporting', from: '@app' } as ModuleEntry,
    ]
    withSourceMirror('billing', 'Invoice', 'billing_invoices')
    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'reporting', 'data', 'entities.ts'),
      sourceEntity('Invoice', 'reporting_invoices'),
    )

    await generateModuleEntities({ resolver: createStandaloneResolver(modules), quiet: true })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0] as string).toContain('reporting')
  })

  it('stays silent when compiled package entity class names are unique', async () => {
    const modules = [
      distModule('billing', 'Invoice', 'billing_invoices'),
      distModule('subscriptions', 'Subscription', 'subscriptions'),
    ]

    await generateModuleEntities({ resolver: createStandaloneResolver(modules), quiet: true })

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
