import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateEntityIds } from '../entity-ids'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'entity-ids-test-'))
}

function countMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0
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

    expect(registry).toContain('"sales_order": {')
    expect(registry).toContain('"id": "id"')
    expect(registry).toContain('"tenant_id": "tenant_id"')
    expect(registry).toContain('"total_gross": "total_gross"')
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
    expect(fs.readFileSync(organizationPath, 'utf8')).toContain('export const name = "name"')
    expect(fs.readFileSync(organizationPath, 'utf8')).toContain('export const tenant = "tenant"')
    expect(fs.readFileSync(packageOrganizationPath, 'utf8')).toContain("export const tenant = 'tenant'")
  })

  it('prefers package generated TypeScript metadata from generated/ in standalone mode', async () => {
    const moduleEntry: ModuleEntry = { id: 'catalog', from: '@open-mercato/core' }
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'core')
    const generatedRoot = path.join(packageRoot, 'generated')
    const idsFile = path.join(generatedRoot, 'entities.ids.generated.ts')
    const variantFieldsFile = path.join(generatedRoot, 'entities', 'product_variant', 'index.ts')

    fs.mkdirSync(path.dirname(idsFile), { recursive: true })
    fs.mkdirSync(path.dirname(variantFieldsFile), { recursive: true })

    fs.writeFileSync(
      idsFile,
      `export const E = ({
  catalog: ({
    product_variant: 'catalog:product_variant'
  } as const)
} as const)
`
    )
    fs.writeFileSync(
      variantFieldsFile,
      `export const id = 'id'
export const sku = 'sku'
export const duplicateSku = 'sku'
`
    )

    const distEntitiesFile = path.join(packageRoot, 'dist', 'modules', 'catalog', 'data', 'entities.js')
    fs.mkdirSync(path.dirname(distEntitiesFile), { recursive: true })
    fs.writeFileSync(
      distEntitiesFile,
      `class ProductVariant {}
export { ProductVariant }
`
    )

    const resolver = createStandaloneMockResolver(tmpDir, [moduleEntry])
    const result = await generateEntityIds({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    const rootIdsPath = path.join(tmpDir, '.mercato', 'generated', 'entities.ids.generated.ts')
    const variantPath = path.join(tmpDir, '.mercato', 'generated', 'entities', 'product_variant', 'index.ts')
    const registryPath = path.join(tmpDir, '.mercato', 'generated', 'entity-fields-registry.ts')
    const variantContent = fs.readFileSync(variantPath, 'utf8')

    expect(fs.readFileSync(rootIdsPath, 'utf8')).toContain('"product_variant": "catalog:product_variant"')
    expect(variantContent).toContain('export const sku = "sku"')
    expect(countMatches(variantContent, /export const sku = "sku"/g)).toBe(1)
    expect(fs.readFileSync(registryPath, 'utf8')).toContain('"product_variant": {')
  })

  it('parses override entity fields, honors decorator names, and removes stale generated entities', async () => {
    const moduleEntry: ModuleEntry = { id: 'inventory', from: '@open-mercato/core' }
    const entitiesFile = path.join(tmpDir, 'app', 'src', 'modules', 'inventory', 'data', 'entities.override.ts')
    fs.mkdirSync(path.dirname(entitiesFile), { recursive: true })
    fs.writeFileSync(
      entitiesFile,
      `export class WarehouseLocation {
  @Property({ name: 'warehouse_code' })
  code!: string
  displayName!: string
  'legacyTag'!: string
  static ignored = 'ignored'
}
`
    )

    const staleDir = path.join(tmpDir, 'app', '.mercato', 'generated', 'entities', 'obsolete_entity')
    fs.mkdirSync(staleDir, { recursive: true })
    fs.writeFileSync(path.join(staleDir, 'index.ts'), 'export const old_field = "old_field"\n')

    const resolver = createMockResolver(tmpDir, [moduleEntry])
    const result = await generateEntityIds({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    const warehousePath = path.join(tmpDir, 'app', '.mercato', 'generated', 'entities', 'warehouse_location', 'index.ts')
    const registryPath = path.join(tmpDir, 'app', '.mercato', 'generated', 'entity-fields-registry.ts')
    const warehouseContent = fs.readFileSync(warehousePath, 'utf8')
    const registryContent = fs.readFileSync(registryPath, 'utf8')

    expect(warehouseContent).toContain('export const warehouse_code = "warehouse_code"')
    expect(warehouseContent).toContain('export const display_name = "display_name"')
    expect(warehouseContent).toContain('export const legacy_tag = "legacy_tag"')
    expect(warehouseContent).not.toContain('ignored')
    expect(registryContent).toContain('"warehouse_code": "warehouse_code"')
    expect(registryContent).toContain('"display_name": "display_name"')
    expect(fs.existsSync(staleDir)).toBe(false)
  })

  it('keeps modules without entities in M and marks the ids file unchanged on identical reruns', async () => {
    const moduleEntry: ModuleEntry = { id: 'empty_module', from: '@open-mercato/core' }
    const resolver = createMockResolver(tmpDir, [moduleEntry])

    const first = await generateEntityIds({ resolver, quiet: true })
    const second = await generateEntityIds({ resolver, quiet: true })

    const idsPath = path.join(tmpDir, 'app', '.mercato', 'generated', 'entities.ids.generated.ts')
    const content = fs.readFileSync(idsPath, 'utf8')

    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(content).toContain('"empty_module": "empty_module"')
    expect(content).not.toContain('"empty_module": {')
    expect(second.filesUnchanged).toContain(idsPath)
  })
})
