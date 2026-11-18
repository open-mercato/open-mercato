import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  parseModuleMetadata,
  copyDirRecursive,
  rewriteCrossModuleImports,
  updateModulesTs,
  listEjectableModules,
  ejectModule,
} from '../eject'
import { readEnabledModulesFromConfig, type PackageResolver } from '../resolver'
import { getModuleLocators } from '../module-identity'
import { resolveModuleRequirement } from '@open-mercato/shared/modules/module-locators'

describe('eject', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eject-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('parseModuleMetadata', () => {
    it('returns empty object for missing file', () => {
      expect(parseModuleMetadata('/nonexistent/index.ts')).toEqual({})
    })

    it('parses ejectable: true', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const metadata = { ejectable: true }`)
      expect(parseModuleMetadata(filePath)).toMatchObject({ ejectable: true })
    })

    it('parses ejectable: false', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const metadata = { ejectable: false }`)
      expect(parseModuleMetadata(filePath)).toMatchObject({ ejectable: false })
    })

    it('parses title and description', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(
        filePath,
        `export const metadata = { title: 'Currencies', description: 'Currency management', ejectable: true }`,
      )
      const result = parseModuleMetadata(filePath)
      expect(result).toEqual({
        ejectable: true,
        title: 'Currencies',
        description: 'Currency management',
      })
    })

    it('returns empty object when no metadata fields present', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const foo = 42`)
      expect(parseModuleMetadata(filePath)).toEqual({})
    })
  })

  describe('copyDirRecursive', () => {
    it('copies files and directories', () => {
      const src = path.join(tmpDir, 'src')
      const dest = path.join(tmpDir, 'dest')
      fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(src, 'a.ts'), 'export const a = 1')
      fs.writeFileSync(path.join(src, 'sub', 'b.ts'), 'export const b = 2')

      copyDirRecursive(src, dest)

      expect(fs.readFileSync(path.join(dest, 'a.ts'), 'utf8')).toBe('export const a = 1')
      expect(fs.readFileSync(path.join(dest, 'sub', 'b.ts'), 'utf8')).toBe('export const b = 2')
    })

    it('skips __tests__, __mocks__, and node_modules directories', () => {
      const src = path.join(tmpDir, 'src')
      const dest = path.join(tmpDir, 'dest')
      fs.mkdirSync(path.join(src, '__tests__'), { recursive: true })
      fs.mkdirSync(path.join(src, '__mocks__'), { recursive: true })
      fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true })
      fs.writeFileSync(path.join(src, '__tests__', 'test.ts'), 'test')
      fs.writeFileSync(path.join(src, '__mocks__', 'mock.ts'), 'mock')
      fs.writeFileSync(path.join(src, 'node_modules', 'dep.js'), 'dep')
      fs.writeFileSync(path.join(src, 'keep.ts'), 'keep')

      copyDirRecursive(src, dest)

      expect(fs.existsSync(path.join(dest, '__tests__'))).toBe(false)
      expect(fs.existsSync(path.join(dest, '__mocks__'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'keep.ts'))).toBe(true)
    })

    it('skips AppleDouble and Finder metadata files', () => {
      const src = path.join(tmpDir, 'src')
      const dest = path.join(tmpDir, 'dest')
      fs.mkdirSync(path.join(src, 'nested'), { recursive: true })
      fs.writeFileSync(path.join(src, '._setup.ts'), 'junk')
      fs.writeFileSync(path.join(src, '.DS_Store'), 'junk')
      fs.writeFileSync(path.join(src, 'nested', '._page.tsx'), 'junk')
      fs.writeFileSync(path.join(src, 'setup.ts'), 'export const setup = true')

      copyDirRecursive(src, dest)

      expect(fs.existsSync(path.join(dest, '._setup.ts'))).toBe(false)
      expect(fs.existsSync(path.join(dest, '.DS_Store'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'nested', '._page.tsx'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'setup.ts'))).toBe(true)
    })
  })

  describe('updateModulesTs', () => {
    it('replaces single-quoted from value with @app', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'currencies', from: '@open-mercato/core' },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("{ id: 'currencies', from: '@app' }")
    })

    it('replaces double-quoted from value with @app', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: "currencies", from: "@open-mercato/core" },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain('{ id: "currencies", from: "@app" }')
    })

    it('inserts from: @app when entry has no from field', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'currencies' },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("from: '@app'")
      expect(result).toContain("id: 'currencies'")
    })

    it('does not modify other modules', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          `export const enabledModules = [`,
          `  { id: 'auth', from: '@open-mercato/core' },`,
          `  { id: 'currencies', from: '@open-mercato/core' },`,
          `  { id: 'catalog', from: '@open-mercato/core' },`,
          `]`,
        ].join('\n'),
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("{ id: 'auth', from: '@open-mercato/core' }")
      expect(result).toContain("{ id: 'currencies', from: '@app' }")
      expect(result).toContain("{ id: 'catalog', from: '@open-mercato/core' }")
    })

    it('throws when modules.ts does not exist', () => {
      expect(() => updateModulesTs('/nonexistent/modules.ts', 'currencies')).toThrow(
        'modules.ts not found',
      )
    })

    it('throws when module entry is not found', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'auth', from: '@open-mercato/core' },\n]`,
      )

      expect(() => updateModulesTs(filePath, 'currencies')).toThrow(
        'Could not find module entry for "currencies"',
      )
    })

    it('does not treat moduleId as regex pattern', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          `export const enabledModules = [`,
          `  { id: 'auth', from: '@open-mercato/core' },`,
          `  { id: 'catalog', from: '@open-mercato/core' },`,
          `]`,
        ].join('\n'),
      )

      expect(() => updateModulesTs(filePath, '.*')).toThrow(
        'Could not find module entry for ".*"',
      )

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("{ id: 'auth', from: '@open-mercato/core' }")
      expect(result).toContain("{ id: 'catalog', from: '@open-mercato/core' }")
    })
  })

  describe('rewriteCrossModuleImports', () => {
    it('rewrites cross-module relative imports to package imports', () => {
      const pkgModulesRoot = path.join(tmpDir, 'pkg', 'src', 'modules')
      const appModulesRoot = path.join(tmpDir, 'app', 'src', 'modules')
      const pkgSalesRoot = path.join(pkgModulesRoot, 'sales')
      const appSalesRoot = path.join(appModulesRoot, 'sales')

      fs.mkdirSync(path.join(pkgModulesRoot, 'customers', 'data'), { recursive: true })
      fs.mkdirSync(path.join(pkgModulesRoot, 'notifications', 'lib'), { recursive: true })
      fs.mkdirSync(path.join(pkgSalesRoot, 'commands'), { recursive: true })
      fs.mkdirSync(path.join(pkgSalesRoot, 'subscribers'), { recursive: true })
      fs.mkdirSync(path.join(appSalesRoot, 'commands'), { recursive: true })
      fs.mkdirSync(path.join(appSalesRoot, 'subscribers'), { recursive: true })

      fs.writeFileSync(path.join(pkgModulesRoot, 'customers', 'data', 'entities.ts'), 'export const entities = []')
      fs.writeFileSync(path.join(pkgModulesRoot, 'notifications', 'lib', 'notificationService.ts'), 'export const service = {}')
      fs.writeFileSync(path.join(pkgModulesRoot, 'notifications', 'lib', 'notificationBuilder.ts'), 'export const builder = {}')

      fs.writeFileSync(
        path.join(pkgSalesRoot, 'commands', 'documents.ts'),
        [
          "import { resolveNotificationService } from '../../notifications/lib/notificationService'",
          "import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'",
          "import { Customer } from '../../customers/data/entities'",
          "import { localFn } from '../helpers'",
        ].join('\n'),
      )
      fs.writeFileSync(path.join(pkgSalesRoot, 'helpers.ts'), 'export const localFn = () => null')

      fs.writeFileSync(
        path.join(appSalesRoot, 'commands', 'documents.ts'),
        fs.readFileSync(path.join(pkgSalesRoot, 'commands', 'documents.ts'), 'utf8'),
      )
      fs.writeFileSync(path.join(appSalesRoot, 'helpers.ts'), 'export const localFn = () => null')

      rewriteCrossModuleImports(pkgSalesRoot, appSalesRoot, 'sales', '@open-mercato/core')

      const rewritten = fs.readFileSync(path.join(appSalesRoot, 'commands', 'documents.ts'), 'utf8')
      expect(rewritten).toContain("from '@open-mercato/core/modules/notifications/lib/notificationService'")
      expect(rewritten).toContain("from '@open-mercato/core/modules/notifications/lib/notificationBuilder'")
      expect(rewritten).toContain("from '@open-mercato/core/modules/customers/data/entities'")
      expect(rewritten).toContain("from '../helpers'")
    })

    it('keeps unresolved relative imports unchanged', () => {
      const pkgModulesRoot = path.join(tmpDir, 'pkg', 'src', 'modules')
      const appModulesRoot = path.join(tmpDir, 'app', 'src', 'modules')
      const pkgSalesRoot = path.join(pkgModulesRoot, 'sales')
      const appSalesRoot = path.join(appModulesRoot, 'sales')

      fs.mkdirSync(path.join(pkgSalesRoot, 'commands'), { recursive: true })
      fs.mkdirSync(path.join(appSalesRoot, 'commands'), { recursive: true })

      fs.writeFileSync(
        path.join(pkgSalesRoot, 'commands', 'dynamic.ts'),
        "export const x = () => import('../../unknown/missing')",
      )
      fs.writeFileSync(
        path.join(appSalesRoot, 'commands', 'dynamic.ts'),
        "export const x = () => import('../../unknown/missing')",
      )

      rewriteCrossModuleImports(pkgSalesRoot, appSalesRoot, 'sales', '@open-mercato/core')

      const rewritten = fs.readFileSync(path.join(appSalesRoot, 'commands', 'dynamic.ts'), 'utf8')
      expect(rewritten).toContain("import('../../unknown/missing')")
    })
  })

  describe('official module packages', () => {
    function createOfficialModuleResolver(baseDir: string): PackageResolver {
      const appDir = path.join(baseDir, 'apps', 'mercato')
      const modulesTsPath = path.join(appDir, 'src', 'modules.ts')
      const installedPackageRoot = path.join(baseDir, 'node_modules', '@open-mercato', 'test-package')

      fs.mkdirSync(path.join(appDir, 'src'), { recursive: true })
      fs.mkdirSync(path.join(installedPackageRoot, 'src', 'modules', 'test_package'), { recursive: true })
      fs.mkdirSync(path.join(installedPackageRoot, 'dist', 'modules', 'test_package'), { recursive: true })

      fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ dependencies: { '@open-mercato/test-package': '^0.1.0' } }))
      fs.writeFileSync(
        path.join(appDir, 'src', 'modules.ts'),
        "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
      )
      fs.writeFileSync(
        path.join(installedPackageRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@open-mercato/test-package',
            version: '0.1.0',
            peerDependencies: {
              '@open-mercato/core': '>=0.4.7 <0.5.0',
            },
          },
          null,
          2,
        ),
      )
      fs.writeFileSync(
        path.join(installedPackageRoot, 'src', 'modules', 'test_package', 'index.ts'),
        "export const metadata = { title: 'Test Package', description: 'Fixture package', ejectable: true }\n",
      )
      fs.writeFileSync(
        path.join(installedPackageRoot, 'src', 'modules', 'test_package', 'widget.ts'),
        'export const widget = true\n',
      )
      fs.writeFileSync(
        path.join(installedPackageRoot, 'dist', 'modules', 'test_package', 'index.js'),
        'export const metadata = {};\n',
      )

      return {
        getAppDir: () => appDir,
        getModulesConfigPath: () => modulesTsPath,
        loadEnabledModules: () => [{ id: 'test_package', from: '@open-mercato/test-package' }],
        getModulePaths: () => ({
          appBase: path.join(appDir, 'src', 'modules', 'test_package'),
          pkgBase: path.join(baseDir, 'packages', 'test-package', 'src', 'modules', 'test_package'),
        }),
        getPackageRoot: () => installedPackageRoot,
      } as unknown as PackageResolver
    }

    it('lists module packages as ejectable from module index.ts metadata', () => {
      const resolver = createOfficialModuleResolver(tmpDir)

      expect(listEjectableModules(resolver)).toEqual([
        {
          id: 'test_package',
          title: 'Test Package',
          description: 'Fixture package',
          from: '@open-mercato/test-package',
        },
      ])
    })

    it('rejects duplicate module registrations before copying source', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const duplicates = [
        { id: 'test_package', from: '@open-mercato/test-package' },
        { id: 'test_package', from: '@other/test-package' },
      ]
      fs.writeFileSync(resolver.getModulesConfigPath(), `export const enabledModules = ${JSON.stringify(duplicates)}`)
      const sourceBefore = fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')
      expect(() => ejectModule({ ...resolver, loadEnabledModules: () => duplicates }, 'test_package')).toThrow("Duplicate enabled module ID 'test_package'")
      expect(fs.existsSync(resolver.getModulePaths(duplicates[0]).appBase)).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(sourceBefore)
    })

    it('rejects duplicate registrations elsewhere in the effective set before copying', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const entries = [...resolver.loadEnabledModules(), { id: 'customers' }, { id: 'customers', from: '@other/customers' }]
      const before = fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')

      expect(() => ejectModule({ ...resolver, loadEnabledModules: () => entries }, 'test_package')).toThrow("Duplicate enabled module ID 'customers'")
      expect(fs.existsSync(resolver.getModulePaths(entries[0]).appBase)).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(before)
    })

    it('checks the config mutation before copying when effective entries cannot be edited', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const before = "const entries = [{ id: 'test_package', from: '@open-mercato/test-package' }]; export const enabledModules = entries;\n"
      fs.writeFileSync(resolver.getModulesConfigPath(), before)

      expect(() => ejectModule(resolver, 'test_package')).toThrow('Could not find enabledModules array')
      expect(fs.existsSync(resolver.getModulePaths(resolver.loadEnabledModules()[0]).appBase)).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(before)
    })

    it('rejects contradictory observed provenance before copying source', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const entry = { id: 'test_package', from: '@open-mercato/test-package', locator: 'github:unexpected/provider' }
      const before = "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package', locator: 'github:unexpected/provider' }]\n"
      fs.writeFileSync(resolver.getModulesConfigPath(), before)

      expect(() => ejectModule({ ...resolver, loadEnabledModules: () => [entry] }, 'test_package')).toThrow('disagrees with observed origin')
      expect(fs.existsSync(resolver.getModulePaths(entry).appBase)).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(before)
    })

    it('preserves an existing local overlay and gives a recovery without deleting source', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const appBase = resolver.getModulePaths(resolver.loadEnabledModules()[0]).appBase
      fs.mkdirSync(appBase, { recursive: true })
      fs.writeFileSync(path.join(appBase, 'local.ts'), 'export const local = true\n')
      const before = fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')

      expect(() => ejectModule(resolver, 'test_package')).toThrow('Keep the existing local source')
      expect(fs.readFileSync(path.join(appBase, 'local.ts'), 'utf8')).toBe('export const local = true\n')
      expect(fs.existsSync(path.join(appBase, 'index.ts'))).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(before)
    })

    it('keeps canonical provenance and rewrites sibling imports using the installed alias', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const packageRoot = resolver.getPackageRoot('@open-mercato/test-package')
      const aliasRoot = path.join(resolver.getAppDir(), 'node_modules', 'candidate_consents')
      fs.mkdirSync(path.dirname(aliasRoot), { recursive: true })
      fs.symlinkSync(packageRoot, aliasRoot, 'dir')
      fs.writeFileSync(path.join(resolver.getAppDir(), 'package.json'), JSON.stringify({ dependencies: { candidate_consents: 'npm:@open-mercato/test-package@1.0.0' } }))
      const entry = { id: 'test_package', from: 'candidate_consents' }
      fs.writeFileSync(resolver.getModulesConfigPath(), `export const enabledModules = [${JSON.stringify(entry)}]\n`)
      fs.mkdirSync(path.join(packageRoot, 'src', 'modules', 'sibling'), { recursive: true })
      fs.writeFileSync(path.join(packageRoot, 'src', 'modules', 'sibling', 'index.ts'), 'export const sibling = true\n')
      fs.writeFileSync(path.join(packageRoot, 'src', 'modules', 'test_package', 'widget.ts'), "export { sibling } from '../sibling'\n")
      const aliasResolver = { ...resolver, loadEnabledModules: () => [entry], getPackageRoot: () => aliasRoot }

      ejectModule(aliasResolver, 'test_package')

      expect(readEnabledModulesFromConfig(resolver.getModulesConfigPath())[0]).toEqual({ id: 'test_package', from: '@app', packageName: '@open-mercato/test-package', locator: 'npm:@open-mercato/test-package' })
      const appBase = resolver.getModulePaths(entry).appBase
      expect(fs.readFileSync(path.join(appBase, 'widget.ts'), 'utf8')).toContain("from 'candidate_consents/modules/sibling'")
    })

    it('preserves GitHub origin and canonical package attribution through legacy eject', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      fs.writeFileSync(path.join(resolver.getAppDir(), 'package.json'), JSON.stringify({ dependencies: { '@open-mercato/test-package': 'github:pkarw/test-package#main' } }))
      ejectModule(resolver, 'test_package')
      const entry = readEnabledModulesFromConfig(resolver.getModulesConfigPath())[0]
      expect(entry).toEqual({ id: 'test_package', from: '@app', packageName: '@open-mercato/test-package', locator: 'github:pkarw/test-package' })
      const identities = [{ id: entry.id, locators: getModuleLocators(entry, resolver) }]
      expect(resolveModuleRequirement('npm:@open-mercato/test-package', identities)).toBeUndefined()
      expect(resolveModuleRequirement('github:pkarw/test-package', identities)).toBe('test_package')
    })

    it('ejects module packages using module index.ts ejectable flag', () => {
      const resolver = createOfficialModuleResolver(tmpDir)
      const appModuleDir = path.join(tmpDir, 'apps', 'mercato', 'src', 'modules', 'test_package')
      const modulesTsPath = path.join(tmpDir, 'apps', 'mercato', 'src', 'modules.ts')

      ejectModule(resolver, 'test_package')

      expect(fs.existsSync(path.join(appModuleDir, 'index.ts'))).toBe(true)
      expect(fs.existsSync(path.join(appModuleDir, 'widget.ts'))).toBe(true)
      expect(fs.readFileSync(modulesTsPath, 'utf8')).toContain(
        "{ id: 'test_package', from: '@app', locator: 'npm:@open-mercato/test-package', packageName: '@open-mercato/test-package' }",
      )
    })
  })

  // Regression guards for #4272: standalone installs resolve getModulePaths'
  // pkgBase to node_modules/<pkg>/dist/modules (compiled JS, no index.ts), so
  // eject reported every module as "not marked as ejectable" and --list came up
  // (nearly) empty. Ejection must prefer the shipped src/modules TypeScript.
  describe('standalone installs (#4272)', () => {
    function createStandaloneResolver(baseDir: string, options: { shipSrc: boolean }): PackageResolver {
      const appDir = path.join(baseDir, 'app')
      const modulesTsPath = path.join(appDir, 'src', 'modules.ts')
      const packageRoot = path.join(baseDir, 'node_modules', '@open-mercato', 'core')
      const distModuleDir = path.join(packageRoot, 'dist', 'modules', 'customers')
      const srcModuleDir = path.join(packageRoot, 'src', 'modules', 'customers')

      fs.mkdirSync(path.join(appDir, 'src'), { recursive: true })
      fs.mkdirSync(distModuleDir, { recursive: true })
      fs.writeFileSync(
        path.join(appDir, 'src', 'modules.ts'),
        "export const enabledModules = [{ id: 'customers', from: '@open-mercato/core' }]\n",
      )
      fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@open-mercato/core' }))
      fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ dependencies: { '@open-mercato/core': '^0.1.0' } }))
      fs.writeFileSync(
        path.join(distModuleDir, 'index.js'),
        'var metadata = { title: "Customers", description: "Compiled", ejectable: true };\nexport { metadata };\n',
      )
      fs.writeFileSync(path.join(distModuleDir, 'index.js.map'), '{}\n')

      if (options.shipSrc) {
        fs.mkdirSync(srcModuleDir, { recursive: true })
        fs.writeFileSync(
          path.join(srcModuleDir, 'index.ts'),
          "export const metadata = { title: 'Customers', description: 'Source', ejectable: true }\n",
        )
        fs.writeFileSync(path.join(srcModuleDir, 'acl.ts'), 'export const features = []\n')
      }

      return {
        getAppDir: () => appDir,
        getModulesConfigPath: () => modulesTsPath,
        loadEnabledModules: () => [{ id: 'customers', from: '@open-mercato/core' }],
        getModulePaths: () => ({
          appBase: path.join(appDir, 'src', 'modules', 'customers'),
          pkgBase: distModuleDir,
        }),
        getPackageRoot: () => packageRoot,
      } as unknown as PackageResolver
    }

    it('lists core modules as ejectable when pkgBase points at dist/modules', () => {
      const resolver = createStandaloneResolver(tmpDir, { shipSrc: true })

      expect(listEjectableModules(resolver)).toEqual([
        {
          id: 'customers',
          title: 'Customers',
          description: 'Source',
          from: '@open-mercato/core',
        },
      ])
    })

    it('ejects the shipped TypeScript sources, not the compiled dist output', () => {
      const resolver = createStandaloneResolver(tmpDir, { shipSrc: true })
      const appModuleDir = path.join(tmpDir, 'app', 'src', 'modules', 'customers')
      const modulesTsPath = path.join(tmpDir, 'app', 'src', 'modules.ts')

      ejectModule(resolver, 'customers')

      expect(fs.existsSync(path.join(appModuleDir, 'index.ts'))).toBe(true)
      expect(fs.existsSync(path.join(appModuleDir, 'acl.ts'))).toBe(true)
      expect(fs.existsSync(path.join(appModuleDir, 'index.js'))).toBe(false)
      expect(fs.readFileSync(modulesTsPath, 'utf8')).toContain("{ id: 'customers', from: '@app', locator: 'npm:@open-mercato/core', packageName: '@open-mercato/core' }")
    })

    it('falls back to compiled index.js metadata for dist-only packages', () => {
      const resolver = createStandaloneResolver(tmpDir, { shipSrc: false })

      expect(listEjectableModules(resolver)).toEqual([
        {
          id: 'customers',
          title: 'Customers',
          description: 'Compiled',
          from: '@open-mercato/core',
        },
      ])
    })
  })
})
