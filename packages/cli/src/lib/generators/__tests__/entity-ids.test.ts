import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateEntityIds } from '../entity-ids'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'entity-ids-test-'))
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

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateEntityIds', () => {
  it('writes an inline entity fields registry without generated entity imports', async () => {
    const moduleEntry: ModuleEntry = { id: 'orders', from: '@open-mercato/core' }
    const entitiesFile = path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'data', 'entities.ts')
    fs.mkdirSync(path.dirname(entitiesFile), { recursive: true })
    fs.writeFileSync(
      entitiesFile,
      `export class SalesOrder {
  id!: string
  tenantId!: string
  totalGross!: number
}
`
    )

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const result = await generateEntityIds({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    const registryPath = path.join(tmpDir, 'app', '.mercato', 'generated', 'entity-fields-registry.ts')
    const registry = fs.readFileSync(registryPath, 'utf8')

    expect(registry).toContain('sales_order: {')
    expect(registry).toContain("id: 'id'")
    expect(registry).toContain("tenant_id: 'tenant_id'")
    expect(registry).toContain("total_gross: 'total_gross'")
    expect(registry).not.toContain("import * as sales_order from './entities/sales_order/index'")
  })
})
