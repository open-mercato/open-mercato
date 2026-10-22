import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver, type ModuleEntry, type PackageResolver } from '../../resolver'
import { generateEntityIds } from '../entity-ids'
import { generateModuleDi } from '../module-di'
import { generateModuleEntities } from '../module-entities'
import { generateModulePackageSources } from '../module-package-sources'
import { generateModuleRegistries, generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } from '../module-registry'
import { generateOpenApi } from '../openapi'

const generators = [
  generateEntityIds,
  generateModuleDi,
  generateModuleEntities,
  generateModulePackageSources,
  generateModuleRegistry,
  generateModuleRegistryApp,
  generateModuleRegistryCli,
  generateModuleRegistries,
  generateOpenApi,
]

describe('effective module ID preflight', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-id-collisions-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function resolverFor(entries: ModuleEntry[]): PackageResolver {
    const outputDir = path.join(root, '.mercato', 'generated')
    return {
      isMonorepo: () => true,
      getRootDir: () => root,
      getAppDir: () => root,
      getOutputDir: () => outputDir,
      getModulesConfigPath: () => path.join(root, 'src', 'modules.ts'),
      discoverPackages: () => [],
      loadEnabledModules: () => entries,
      getModulePaths: (entry) => ({ appBase: path.join(root, 'src', 'modules', entry.id), pkgBase: path.join(root, 'packages', 'core', 'src', 'modules', entry.id) }),
      getModuleImportBase: (entry) => ({ appBase: `@/modules/${entry.id}`, pkgBase: `@open-mercato/core/modules/${entry.id}` }),
      getPackageRoot: () => path.join(root, 'packages', 'core'),
      getPackageOutputDir: () => path.join(root, 'packages', 'core', 'generated'),
    }
  }

  it.each(generators)('rejects separate providers before any output write in %p', async (generate) => {
    const resolver = resolverFor([
      { id: 'consents', from: '@publisher/consents', locator: 'npm:@publisher/consents' },
      { id: 'consents', from: '@alias/consents', locator: 'github:other/consents' },
    ])
    fs.mkdirSync(resolver.getOutputDir(), { recursive: true })
    const sentinel = path.join(resolver.getOutputDir(), 'existing.generated.ts')
    fs.writeFileSync(sentinel, 'existing output\n')
    const timestamp = fs.statSync(sentinel).mtimeMs
    await expect(generate({ resolver, quiet: true })).rejects.toThrow(/Duplicate enabled module ID 'consents'.*@publisher\/consents.*@alias\/consents/)
    expect(fs.readdirSync(resolver.getOutputDir())).toEqual(['existing.generated.ts'])
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('existing output\n')
    expect(fs.statSync(sentinel).mtimeMs).toBe(timestamp)
    expect(fs.existsSync(resolver.getPackageOutputDir('@open-mercato/core'))).toBe(false)
  })

  it.each(generators)('rejects exact repeated registrations without creating output directories in %p', async (generate) => {
    const resolver = resolverFor([{ id: 'consents', from: '@app' }, { id: 'consents', from: '@app' }])
    await expect(generate({ resolver, quiet: true })).rejects.toThrow(/Duplicate enabled module ID 'consents'.*@app/)
    expect(fs.existsSync(resolver.getOutputDir())).toBe(false)
  })

  it.each(generators)('rejects contradictory retained origin before any output write in %p', async (generate) => {
    const resolver = resolverFor([{ id: 'consents', from: '@publisher/consents', locator: 'github:publisher/consents' }])
    fs.mkdirSync(resolver.getPackageRoot('@publisher/consents'), { recursive: true })
    fs.writeFileSync(path.join(resolver.getPackageRoot('@publisher/consents'), 'package.json'), JSON.stringify({ name: '@publisher/consents' }))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@publisher/consents': '1.0.0' } }))
    await expect(generate({ resolver, quiet: true })).rejects.toThrow(/declared origin.*disagrees with observed origin/)
    expect(fs.existsSync(resolver.getOutputDir())).toBe(false)
  })

  it('preserves one registration with local entity and DI overlays', async () => {
    const resolver = resolverFor([{ id: 'customers', from: '@open-mercato/core' }])
    const roots = resolver.getModulePaths(resolver.loadEnabledModules()[0])
    for (const base of [roots.appBase, roots.pkgBase]) fs.mkdirSync(path.join(base, 'data'), { recursive: true })
    fs.writeFileSync(path.join(roots.appBase, 'data', 'entities.ts'), 'export class LocalCustomer {}')
    fs.writeFileSync(path.join(roots.pkgBase, 'data', 'entities.ts'), 'export class PackageCustomer {}')
    fs.writeFileSync(path.join(roots.appBase, 'di.ts'), 'export function register() {}')
    fs.writeFileSync(path.join(roots.pkgBase, 'di.ts'), 'export function register() {}')
    await generateModuleEntities({ resolver, quiet: true })
    await generateModuleDi({ resolver, quiet: true })
    expect(fs.readFileSync(path.join(resolver.getOutputDir(), 'entities.generated.ts'), 'utf8')).toContain('@/modules/customers/data/entities')
    const di = fs.readFileSync(path.join(resolver.getOutputDir(), 'di.generated.ts'), 'utf8')
    expect(di).toContain('@/modules/customers/di')
    expect(di).not.toContain('@open-mercato/core/modules/customers/di')
  })

  it.each(['npm', 'github'])('validates only the effective %s provider in mutually exclusive branches', async (provider) => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"module-fixture"}')
    fs.writeFileSync(path.join(root, 'src', 'modules.ts'), `
export const enabledModules = []
if (process.env.MODULE_PROVIDER === 'npm') {
  enabledModules.push({ id: 'consents', from: '@app', locator: 'npm:@publisher/consents' })
} else {
  enabledModules.push({ id: 'consents', from: '@app', locator: 'github:publisher/consents' })
}
`)
    const previousProvider = process.env.MODULE_PROVIDER
    process.env.MODULE_PROVIDER = provider
    try {
      const resolver = createResolver(root)
      expect(resolver.loadEnabledModules()).toEqual([{ id: 'consents', from: '@app', locator: provider === 'npm' ? 'npm:@publisher/consents' : 'github:publisher/consents' }])
      await expect(generateModulePackageSources({ resolver, quiet: true })).resolves.toMatchObject({ errors: [] })
    } finally {
      if (previousProvider === undefined) delete process.env.MODULE_PROVIDER
      else process.env.MODULE_PROVIDER = previousProvider
    }
  })

  it('keeps explicitly disabled local modules out of an empty effective configuration', async () => {
    fs.mkdirSync(path.join(root, 'src', 'modules', 'parked'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"module-fixture"}')
    fs.writeFileSync(path.join(root, 'src', 'modules.ts'), 'export const enabledModules = []')
    const resolver = createResolver(root)
    expect(resolver.loadEnabledModules()).toEqual([])
    await generateModuleDi({ resolver, quiet: true })
    expect(fs.readFileSync(path.join(resolver.getOutputDir(), 'di.generated.ts'), 'utf8')).not.toContain('parked')
  })
})
