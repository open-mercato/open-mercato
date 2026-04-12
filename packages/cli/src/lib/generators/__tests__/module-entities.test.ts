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
