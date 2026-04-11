import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleDi } from '../module-di'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'module-di-test-'))
}

function touchFile(filePath: string, content = 'export function register(container: any) {}\n'): void {
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
  return fs.readFileSync(path.join(tmpRoot, 'app', '.mercato', 'generated', 'di.generated.ts'), 'utf8')
}

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateModuleDi', () => {
  it('prefers app di files over package di files for package-backed modules', async () => {
    const moduleEntry: ModuleEntry = { id: 'orders', from: '@open-mercato/core' }

    touchFile(path.join(tmpDir, 'app', 'src', 'modules', 'orders', 'di.ts'))
    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'di.ts'))

    const result = await generateModuleDi({ resolver: createMockResolver(tmpDir, [moduleEntry]), quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "@/modules/orders/di"')
    expect(output).not.toContain('@open-mercato/core/modules/orders/di')
    expect(output).toContain('D_orders_0.register')
  })

  it('uses relative imports for app-backed modules', async () => {
    const moduleEntry: ModuleEntry = { id: 'custom_app', from: '@app' }

    touchFile(path.join(tmpDir, 'app', 'src', 'modules', 'custom_app', 'di.ts'))

    const result = await generateModuleDi({ resolver: createMockResolver(tmpDir, [moduleEntry]), quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "../../src/modules/custom_app/di"')
    expect(output).not.toContain('@/modules/custom_app/di')
  })

  it('discovers package di files that use non-ts extensions', async () => {
    const moduleEntry: ModuleEntry = { id: 'inventory', from: '@open-mercato/core' }

    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'inventory', 'di.js'))

    const result = await generateModuleDi({ resolver: createMockResolver(tmpDir, [moduleEntry]), quiet: true })
    const output = readGenerated(tmpDir)

    expect(result.errors).toEqual([])
    expect(output).toContain('from "@open-mercato/core/modules/inventory/di"')
    expect(output).toContain('D_inventory_0.register')
  })

  it('marks the generated file as unchanged when the checksum matches', async () => {
    const moduleEntry: ModuleEntry = { id: 'orders', from: '@open-mercato/core' }

    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'di.ts'))

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const outFile = path.join(tmpDir, 'app', '.mercato', 'generated', 'di.generated.ts')
    const checksumFile = path.join(tmpDir, 'app', '.mercato', 'generated', 'di.generated.checksum')

    const firstResult = await generateModuleDi({ resolver, quiet: true })
    const firstStat = fs.statSync(outFile)
    const secondResult = await generateModuleDi({ resolver, quiet: true })
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
