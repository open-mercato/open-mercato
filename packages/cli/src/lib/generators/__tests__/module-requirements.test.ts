import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } from '../module-registry'
import type { ModuleEntry, PackageResolver } from '../../resolver'

describe('canonical module dependencies across registries', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-requires-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks() })

  function fixture(requirement: string): PackageResolver {
    const enabled: ModuleEntry[] = [
      { id: 'dependent', from: '@app' },
      { id: 'consents', from: '@app', locator: 'github:pkarw/marketing-consents', packageName: '@pkarw/marketing_consents' },
    ]
    const moduleBase = (moduleId: string) => path.join(root, 'src', 'modules', moduleId)
    for (const entry of enabled) fs.mkdirSync(moduleBase(entry.id), { recursive: true })
    fs.writeFileSync(path.join(moduleBase('dependent'), 'index.ts'), `exports.metadata = { requires: [${JSON.stringify(requirement)}] }`)
    fs.writeFileSync(path.join(moduleBase('consents'), 'index.ts'), 'exports.metadata = {}')
    return {
      isMonorepo: () => true,
      getRootDir: () => root,
      getAppDir: () => root,
      getOutputDir: () => path.join(root, '.mercato', 'generated'),
      getModulesConfigPath: () => path.join(root, 'src', 'modules.ts'),
      discoverPackages: () => [],
      loadEnabledModules: () => enabled,
      getModulePaths: (entry) => ({ appBase: moduleBase(entry.id), pkgBase: path.join(root, 'empty', entry.id) }),
      getModuleImportBase: (entry) => ({ appBase: `@/modules/${entry.id}`, pkgBase: `@unused/modules/${entry.id}` }),
      getPackageOutputDir: () => path.join(root, '.mercato', 'generated'),
      getPackageRoot: () => root,
    }
  }

  it.each([generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli])('satisfies canonical source dependencies in %p', async (generate) => {
    const resolver = fixture('https://github.com/PKARW/marketing-consents.git#main')
    const result = await generate({ resolver, quiet: true })
    expect(result.errors).toEqual([])
  })

  it.each([generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli])('satisfies npm identity after GitHub module ejection in %p', async (generate) => {
    const resolver = fixture('npm:@pkarw/marketing_consents@next')
    const result = await generate({ resolver, quiet: true })
    expect(result.errors).toEqual([])
  })

  it.each([generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli])('rejects wrong publisher despite matching module name in %p', async (generate) => {
    const resolver = fixture('github:other/marketing-consents')
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('dependency failure') })
    await expect(generate({ resolver, quiet: true })).rejects.toThrow('dependency failure')
    expect(errors).toHaveBeenCalledWith("Fix: npx create-mercato-module install 'github:other/marketing-consents'")
  })
})
