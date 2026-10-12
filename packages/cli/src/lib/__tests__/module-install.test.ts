import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readEnabledModulesFromConfig, type PackageResolver } from '../resolver'
import { addOfficialModule, enableOfficialModule } from '../module-install'
import * as github from '../module-github'

function buildPackageFixture(
  packageRoot: string,
  moduleId: string,
  options?: {
    ejectable?: boolean
    extraSourceFiles?: Array<{ relativePath: string; content: string }>
    packageName?: string
    requires?: string[]
  },
): void {
  const ejectable = options?.ejectable ?? false
  const packageName = options?.packageName ?? '@open-mercato/test-package'
  const requires = options?.requires ?? []
  for (const base of ['src', 'dist']) {
    fs.mkdirSync(path.join(packageRoot, base, 'modules', moduleId), { recursive: true })
  }
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: packageName, version: '0.1.0' }),
  )
  fs.writeFileSync(
    path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts'),
    `export const metadata = { title: 'Test', ejectable: ${ejectable ? 'true' : 'false'}, requires: ${JSON.stringify(requires)} }\n`,
  )
  fs.writeFileSync(
    path.join(packageRoot, 'dist', 'modules', moduleId, 'index.js'),
    `exports.metadata = {};\n`,
  )

  for (const file of options?.extraSourceFiles ?? []) {
    const targetPath = path.join(packageRoot, 'src', 'modules', moduleId, file.relativePath)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, file.content)
  }
}

function buildResolver(
  appDir: string,
  packageRoot: string,
  modulesTsContent: string,
): PackageResolver {
  const modulesTsPath = path.join(appDir, 'src', 'modules.ts')
  fs.mkdirSync(path.join(appDir, 'src'), { recursive: true })
  fs.writeFileSync(modulesTsPath, modulesTsContent)
  const initiallyEnabledModules = readEnabledModulesFromConfig(modulesTsPath)

  return {
    getAppDir: () => appDir,
    getModulesConfigPath: () => modulesTsPath,
    getPackageRoot: () => packageRoot,
    isMonorepo: () => false,
    getRootDir: () => appDir,
    discoverPackages: () => [],
    loadEnabledModules: () => initiallyEnabledModules,
    getModulePaths: (entry) => ({
      appBase: path.join(appDir, 'src', 'modules', entry.id),
      pkgBase: path.join(packageRoot, 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `${entry.from ?? '@open-mercato/core'}/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => path.join(packageRoot, 'generated'),
    getOutputDir: () => path.join(appDir, '.mercato', 'generated'),
  } as unknown as PackageResolver
}

describe('enableOfficialModule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-install-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws when module is already enabled in modules.ts with the same source', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).rejects.toThrow('already enabled in modules.ts')
  })

  it('throws when module is already enabled with different casing in the source field', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    // registered without explicit from (defaults to @open-mercato/core internally) — different from what enable would write
    // This triggers the "already registered from different source" error from ensureModuleRegistration
    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/other' }]\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).rejects.toThrow('already registered from')
  })

  it('error message includes the module id and package name', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).rejects.toThrow('"test_package"')

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).rejects.toThrow('"@open-mercato/test-package"')
  })

  it('throws when the specific module is already enabled in a multi-module package', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'multi')
    const appDir = path.join(tmpDir, 'app')

    // package with two modules
    for (const moduleId of ['alpha', 'beta']) {
      fs.mkdirSync(path.join(packageRoot, 'src', 'modules', moduleId), { recursive: true })
      fs.mkdirSync(path.join(packageRoot, 'dist', 'modules', moduleId), { recursive: true })
      fs.writeFileSync(
        path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts'),
        `export const metadata = { ejectable: false }\n`,
      )
      fs.writeFileSync(
        path.join(packageRoot, 'dist', 'modules', moduleId, 'index.js'),
        `exports.metadata = {};\n`,
      )
    }
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/multi', version: '0.1.0' }),
    )

    // alpha is already enabled, beta is not
    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'alpha', from: '@open-mercato/multi' }]\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/multi', 'alpha'),
    ).rejects.toThrow('already enabled in modules.ts')

    // beta is not yet enabled — must not throw "already enabled", even if generators fail afterwards
    try {
      await enableOfficialModule(resolver, '@open-mercato/multi', 'beta')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain('already enabled in modules.ts')
    }
  })

  it('copies module source into the app when enabling with --eject', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package', {
      ejectable: true,
      extraSourceFiles: [
        {
          relativePath: path.join('backend', 'page.tsx'),
          content: 'export default function TestPage() { return null }\n',
        },
      ],
    })

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = []\n",
    )

    await expect(
      enableOfficialModule(
        resolver,
        '@open-mercato/test-package',
        undefined,
        true,
      ),
    ).resolves.toEqual({
      moduleId: 'test_package',
      packageName: '@open-mercato/test-package',
      from: '@app',
      registrationChanged: true,
    })

    expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(true)
    expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'backend', 'page.tsx'))).toBe(true)
    expect(fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')).toContain(
      "{ id: 'test_package', from: '@app', locator: 'npm:@open-mercato/test-package', packageName: '@open-mercato/test-package' }",
    )
  })

  it('rejects missing descriptor dependencies before registration or ejection', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    const initialModulesSource = "export const enabledModules = [{ id: 'customers' }]\n"
    buildPackageFixture(packageRoot, 'test_package', {
      ejectable: true,
      requires: ['customers', 'catalog'],
    })
    const resolver = buildResolver(appDir, packageRoot, initialModulesSource)

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package', undefined, true),
    ).rejects.toThrow(
      'Module "test_package" requires module(s) that are not enabled: catalog.\n'
      + 'Enable the missing module(s) in src/modules.ts first, then rerun this command.',
    )

    expect(fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')).toBe(initialModulesSource)
    expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package'))).toBe(false)
  })

  it('allows registration when every descriptor dependency is enabled', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package', {
      requires: ['customers', 'catalog'],
    })
    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'customers' }, { id: 'catalog' }]\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).resolves.toMatchObject({ moduleId: 'test_package', registrationChanged: true })
  })

  it('rejects enabling with --eject when the package is not ejectable', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = []\n",
    )

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package', undefined, true),
    ).rejects.toThrow('--eject requires open-mercato.ejectable === true')
  })

  it('rejects unsupported package specs before invoking the package manager', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = []\n",
    )

    await expect(
      addOfficialModule(resolver, '@open-mercato/test-package@npm:evil', false),
    ).rejects.toThrow('Unsupported package spec suffix')
  })
})

describe('third-party module packages', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-install-3p-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects adding a non-@open-mercato package without --allow-third-party', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@fast-white-cat', 'integration-ksef-direct')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'ksef_direct', {
      packageName: '@fast-white-cat/integration-ksef-direct',
    })

    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')

    await expect(
      addOfficialModule(resolver, '@fast-white-cat/integration-ksef-direct@0.1.0', false),
    ).rejects.toThrow('Re-run with --allow-third-party')
  })

  it('rejects enabling a non-@open-mercato package without --allow-third-party', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@fast-white-cat', 'integration-ksef-direct')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'ksef_direct', {
      packageName: '@fast-white-cat/integration-ksef-direct',
    })

    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')

    await expect(
      enableOfficialModule(resolver, '@fast-white-cat/integration-ksef-direct'),
    ).rejects.toThrow('Re-run with --allow-third-party')
  })

  it('enables a non-@open-mercato package when --allow-third-party is set', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@fast-white-cat', 'integration-ksef-direct')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'ksef_direct', {
      packageName: '@fast-white-cat/integration-ksef-direct',
    })

    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')

    await expect(
      enableOfficialModule(resolver, '@fast-white-cat/integration-ksef-direct', undefined, false, true),
    ).resolves.toEqual({
      moduleId: 'ksef_direct',
      packageName: '@fast-white-cat/integration-ksef-direct',
      from: '@fast-white-cat/integration-ksef-direct',
      registrationChanged: true,
    })

    expect(fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')).toContain(
      "{ id: 'ksef_direct', from: '@fast-white-cat/integration-ksef-direct' }",
    )
  })
})


describe('canonical module preflight', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-canonical-')) })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('does not satisfy a required scoped package with a same-name module from another scope', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    const source = "export const enabledModules = [{ id: 'marketing_consents', from: '@other/marketing_consents' }]\n"
    buildPackageFixture(packageRoot, 'test_package', { requires: ['@pkarw/marketing_consents@latest'] })
    const resolver = buildResolver(appDir, packageRoot, source)
    await expect(enableOfficialModule(resolver, '@open-mercato/test-package')).rejects.toThrow("npx create-mercato-module install '@pkarw/marketing_consents@latest'")
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(source)
  })

  it('matches canonical npm requirements to the enabled package source', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    buildPackageFixture(packageRoot, 'test_package', { requires: ['npm:@pkarw/marketing_consents@1.2.0'] })
    for (const base of ['src', 'dist']) {
      fs.mkdirSync(path.join(packageRoot, base, 'modules', 'marketing_consents'), { recursive: true })
      fs.writeFileSync(path.join(packageRoot, base, 'modules', 'marketing_consents', base === 'src' ? 'index.ts' : 'index.js'), 'export const metadata = {}')
    }
    const resolver = buildResolver(appDir, packageRoot, "export const enabledModules = [{ id: 'marketing_consents', from: '@pkarw/marketing_consents' }]\n")
    await expect(enableOfficialModule(resolver, '@open-mercato/test-package', 'test_package')).resolves.toMatchObject({ moduleId: 'test_package' })
  })

  it('rejects name collisions before copying ejected sources', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    buildPackageFixture(packageRoot, 'marketing_consents', { ejectable: true })
    const source = "export const enabledModules = [{ id: 'marketing_consents', from: '@other/marketing_consents' }]\n"
    const resolver = buildResolver(appDir, packageRoot, source)
    await expect(enableOfficialModule(resolver, '@open-mercato/test-package', undefined, true)).rejects.toThrow('Module name collision')
    expect(fs.existsSync(path.join(appDir, 'src/modules/marketing_consents'))).toBe(false)
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(source)
  })

  it('rejects a GitHub same-name collision before package installation', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    const source = "export const enabledModules = [{ id: 'marketing_consents', from: '@other/marketing_consents' }]\n"
    const resolver = buildResolver(appDir, packageRoot, source)
    const lookup = jest.spyOn(github, 'resolveGithubModuleTarget').mockReturnValue({
      packageName: '@pkarw/marketing_consents', moduleIds: ['marketing_consents'],
      packageSpec: '@pkarw/marketing_consents@github:pkarw/consents#' + 'a'.repeat(40), locator: 'github:pkarw/consents',
    })
    try {
      await expect(addOfficialModule(resolver, 'github:pkarw/consents', false, undefined, true)).rejects.toThrow('Module name collision')
      expect(fs.existsSync(path.join(appDir, 'package.json'))).toBe(false)
      expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(source)
    } finally {
      lookup.mockRestore()
    }
  })

  it('rejects replacing the same npm name from a different GitHub origin', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    const resolver = buildResolver(appDir, packageRoot, "export const enabledModules = [{ id: 'marketing_consents', from: '@pkarw/consents', locator: 'github:pkarw/original' }]\n")
    const lookup = jest.spyOn(github, 'resolveGithubModuleTarget').mockReturnValue({
      packageName: '@pkarw/consents', moduleIds: ['marketing_consents'],
      packageSpec: '@pkarw/consents@github:pkarw/replacement#' + 'a'.repeat(40), locator: 'github:pkarw/replacement',
    })
    try {
      await expect(addOfficialModule(resolver, 'github:pkarw/replacement', false, undefined, true)).rejects.toThrow('github:pkarw/original')
    } finally {
      lookup.mockRestore()
    }
  })


  it('requires explicit trust for GitHub sources even if they declare an official npm namespace', async () => {
    const resolver = buildResolver(path.join(root, 'app'), path.join(root, 'package'), 'export const enabledModules = []\n')
    const lookup = jest.spyOn(github, 'resolveGithubModuleTarget').mockReturnValue({
      packageName: '@open-mercato/consents', moduleIds: ['marketing_consents'],
      packageSpec: '@open-mercato/consents@github:attacker/consents#' + 'a'.repeat(40), locator: 'github:attacker/consents',
    })
    try {
      await expect(addOfficialModule(resolver, 'github:attacker/consents', false)).rejects.toThrow('--allow-third-party')
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      lookup.mockRestore()
    }
  })


  it('rejects duplicate existing registrations before eject source writes', async () => {
    const packageRoot = path.join(root, 'package')
    const appDir = path.join(root, 'app')
    buildPackageFixture(packageRoot, 'marketing_consents', { ejectable: true })
    const source = "export const enabledModules = [{ id: 'marketing_consents', from: '@open-mercato/test-package' }, { id: 'marketing_consents', from: '@other/consents' }]\n"
    const resolver = buildResolver(appDir, packageRoot, source)
    await expect(enableOfficialModule(resolver, '@open-mercato/test-package', undefined, true)).rejects.toThrow('registered multiple times')
    expect(fs.existsSync(path.join(appDir, 'src/modules/marketing_consents'))).toBe(false)
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(source)
  })

})
