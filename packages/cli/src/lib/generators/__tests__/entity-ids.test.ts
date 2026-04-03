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

function createStandaloneMockResolver(tmpRoot: string, enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(tmpRoot, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })

  return {
    isMonorepo: () => false,
    getRootDir: () => tmpRoot,
    getAppDir: () => tmpRoot,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpRoot, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpRoot, 'src', 'modules', entry.id),
      pkgBase: path.join(tmpRoot, 'node_modules', '@open-mercato', 'core', 'dist', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: (packageName: string) =>
      packageName === '@app'
        ? outputDir
        : path.join(tmpRoot, 'node_modules', '@open-mercato', 'core', 'generated'),
    getPackageRoot: (from?: string) =>
      from === '@app'
        ? tmpRoot
        : path.join(tmpRoot, 'node_modules', '@open-mercato', 'core'),
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

  it('reuses package generated entity metadata in standalone mode', async () => {
    const moduleEntry: ModuleEntry = { id: 'directory', from: '@open-mercato/core' }
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'core')
    const generatedRoot = path.join(packageRoot, 'dist', 'generated')
    const idsFile = path.join(generatedRoot, 'entities.ids.generated.js')
    const organizationFieldsFile = path.join(generatedRoot, 'entities', 'organization', 'index.js')
    const tenantFieldsFile = path.join(generatedRoot, 'entities', 'tenant', 'index.js')

    fs.mkdirSync(path.dirname(idsFile), { recursive: true })
    fs.mkdirSync(path.dirname(organizationFieldsFile), { recursive: true })
    fs.mkdirSync(path.dirname(tenantFieldsFile), { recursive: true })

    fs.writeFileSync(
      idsFile,
      `export const M = { "directory": "directory" }
export const E = {
  "directory": {
    "organization": "directory:organization",
    "tenant": "directory:tenant"
  }
}
`
    )
    fs.writeFileSync(
      organizationFieldsFile,
      `export const id = 'id'
export const name = 'name'
export const tenant = 'tenant'
`
    )
    fs.writeFileSync(
      tenantFieldsFile,
      `export const id = 'id'
export const name = 'name'
`
    )

    const distEntitiesFile = path.join(packageRoot, 'dist', 'modules', 'directory', 'data', 'entities.js')
    fs.mkdirSync(path.dirname(distEntitiesFile), { recursive: true })
    fs.writeFileSync(
      distEntitiesFile,
      `class Organization {}
class Tenant {}
export { Organization, Tenant }
`
    )

    const resolver = createStandaloneMockResolver(tmpDir, [moduleEntry])
    const result = await generateEntityIds({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    const rootIdsPath = path.join(tmpDir, '.mercato', 'generated', 'entities.ids.generated.ts')
    const organizationPath = path.join(tmpDir, '.mercato', 'generated', 'entities', 'organization', 'index.ts')
    const packageOrganizationPath = path.join(generatedRoot, 'entities', 'organization', 'index.js')

    expect(fs.readFileSync(rootIdsPath, 'utf8')).toContain('"organization": "directory:organization"')
    expect(fs.readFileSync(organizationPath, 'utf8')).toContain("export const name = 'name'")
    expect(fs.readFileSync(organizationPath, 'utf8')).toContain("export const tenant = 'tenant'")
    expect(fs.readFileSync(packageOrganizationPath, 'utf8')).toContain("export const tenant = 'tenant'")
  })
})
