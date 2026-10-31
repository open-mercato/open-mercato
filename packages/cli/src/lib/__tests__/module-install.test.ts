import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { addOfficialModule, enableOfficialModule } from '../module-install'
import * as modulesConfig from '../modules-config'
import spawn from 'cross-spawn'

jest.mock('cross-spawn', () => ({ __esModule: true, default: jest.fn() }))

const mockedSpawn = spawn as unknown as jest.Mock

function buildPackageFixture(
  packageRoot: string,
  moduleId: string,
  options?: {
    ejectable?: boolean
    extraSourceFiles?: Array<{ relativePath: string; content: string }>
    packageName?: string
  },
): void {
  const ejectable = options?.ejectable ?? false
  const packageName = options?.packageName ?? '@open-mercato/test-package'
  for (const base of ['src', 'dist']) {
    fs.mkdirSync(path.join(packageRoot, base, 'modules', moduleId), { recursive: true })
  }
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: packageName, version: '0.1.0' }),
  )
  fs.writeFileSync(
    path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts'),
    `export const metadata = { title: 'Test', ejectable: ${ejectable ? 'true' : 'false'} }\n`,
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

  return {
    getAppDir: () => appDir,
    getModulesConfigPath: () => modulesTsPath,
    getPackageRoot: () => packageRoot,
    isMonorepo: () => false,
    getRootDir: () => appDir,
    loadEnabledModules: () => [],
    getModulePaths: () => ({ appBase: '', pkgBase: '' }),
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

  it('succeeds without changes when the module is already enabled with the same source', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
    )

    const modulesTsBefore = fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')

    await expect(
      enableOfficialModule(resolver, '@open-mercato/test-package'),
    ).resolves.toEqual({
      moduleId: 'test_package',
      packageName: '@open-mercato/test-package',
      from: '@open-mercato/test-package',
      registrationChanged: false,
    })
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(modulesTsBefore)
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

  it('stays a no-op success when enable runs again for an enabled module', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')

    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
    )

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        enableOfficialModule(resolver, '@open-mercato/test-package'),
      ).resolves.toMatchObject({ moduleId: 'test_package', registrationChanged: false })
    }
  })

  it('succeeds without changes when the specific module is already enabled in a multi-module package', async () => {
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
    ).resolves.toMatchObject({ moduleId: 'alpha', registrationChanged: false })

    try {
      await enableOfficialModule(resolver, '@open-mercato/multi', 'beta')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain('Module "beta" is enabled')
    }
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toContain("id: 'beta'")
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
      "{ id: 'test_package', from: '@app' }",
    )
  })

  it('rejects --eject for a module gated behind a disabled env flag before copying any source', async () => {
    const originalFlag = process.env.OM_ENABLE_TEST_PACKAGE
    delete process.env.OM_ENABLE_TEST_PACKAGE
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package', { ejectable: true })

    const resolver = buildResolver(
      appDir,
      packageRoot,
      [
        'export const enabledModules = []',
        "if (process.env.OM_ENABLE_TEST_PACKAGE === 'true') {",
        "  enabledModules.push({ id: 'test_package', from: '@open-mercato/test-package' })",
        '}',
      ].join('\n'),
    )

    try {
      await expect(
        enableOfficialModule(resolver, '@open-mercato/test-package', undefined, true),
      ).rejects.toThrow('behind a condition that is currently off')
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package'))).toBe(false)
    } finally {
      if (originalFlag === undefined) delete process.env.OM_ENABLE_TEST_PACKAGE
      else process.env.OM_ENABLE_TEST_PACKAGE = originalFlag
    }
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

describe('addOfficialModule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-install-add-test-'))
    mockedSpawn.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function simulateYarnAdd(appDir: string, packageName: string): void {
    mockedSpawn.mockImplementation(() => {
      const child = new EventEmitter()
      const packageJsonPath = path.join(appDir, 'package.json')
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>
      }
      packageJson.dependencies = { ...packageJson.dependencies, [packageName]: '0.1.0' }
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson))
      setImmediate(() => child.emit('exit', 0))
      return child
    })
  }

  function writeAppPackageJson(appDir: string, dependencies: Record<string, string> = {}): void {
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'test-app', dependencies }))
  }

  it('succeeds without changes when the module is already enabled', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')
    writeAppPackageJson(appDir, { '@open-mercato/test-package': '0.1.0' })
    const resolver = buildResolver(
      appDir,
      packageRoot,
      "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n",
    )
    simulateYarnAdd(appDir, '@open-mercato/test-package')
    const modulesTsBefore = fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')

    await expect(
      addOfficialModule(resolver, '@open-mercato/test-package@0.1.0', false),
    ).resolves.toEqual({
      moduleId: 'test_package',
      packageName: '@open-mercato/test-package',
      from: '@open-mercato/test-package',
      registrationChanged: false,
    })
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(resolver.getModulesConfigPath(), 'utf8')).toBe(modulesTsBefore)
  })

  it('tells the user how to remove a newly added package that has no modules', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'no-modules')
    const appDir = path.join(tmpDir, 'app')
    fs.mkdirSync(packageRoot, { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/no-modules', version: '0.1.0' }),
    )
    writeAppPackageJson(appDir)
    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')
    simulateYarnAdd(appDir, '@open-mercato/no-modules')

    const failure = addOfficialModule(resolver, '@open-mercato/no-modules', false)
    await expect(failure).rejects.toThrow('has no modules in src/modules/ or dist/modules/.')
    await expect(failure).rejects.toThrow(
      'The package "@open-mercato/no-modules" stayed in package.json. To remove it, run: yarn remove @open-mercato/no-modules',
    )
  })

  it('names the app workspace in the remove command inside a monorepo', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'no-modules')
    const appDir = path.join(tmpDir, 'apps', 'mercato')
    fs.mkdirSync(packageRoot, { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/no-modules', version: '0.1.0' }),
    )
    writeAppPackageJson(appDir)
    const resolver = {
      ...buildResolver(appDir, packageRoot, 'export const enabledModules = []\n'),
      isMonorepo: () => true,
      getRootDir: () => tmpDir,
    } as PackageResolver
    simulateYarnAdd(appDir, '@open-mercato/no-modules')

    await expect(addOfficialModule(resolver, '@open-mercato/no-modules', false)).rejects.toThrow(
      'To remove it, run: yarn workspace test-app remove @open-mercato/no-modules',
    )
  })

  it('does not suggest removing a package the app already depended on', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'no-modules')
    const appDir = path.join(tmpDir, 'app')
    fs.mkdirSync(packageRoot, { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/no-modules', version: '0.1.0' }),
    )
    writeAppPackageJson(appDir, { '@open-mercato/no-modules': '0.0.9' })
    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')
    simulateYarnAdd(appDir, '@open-mercato/no-modules')

    const failure = addOfficialModule(resolver, '@open-mercato/no-modules', false)
    await expect(failure).rejects.toThrow('has no modules')
    await expect(failure).rejects.not.toThrow('yarn remove')
  })

  it('rethrows a gated-off registration error without the leftover-package hint', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')
    writeAppPackageJson(appDir)
    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')
    simulateYarnAdd(appDir, '@open-mercato/test-package')
    const gatedOffError = Object.assign(
      new Error('Module "test_package" is gated off. Enable it by setting OM_ENABLE_TEST_PACKAGE=true, then run `yarn generate`.'),
      { code: 'MODULE_GATED_OFF' },
    )
    const registrationSpy = jest
      .spyOn(modulesConfig, 'ensureModuleRegistration')
      .mockImplementation(() => {
        throw gatedOffError
      })

    try {
      const failure = addOfficialModule(resolver, '@open-mercato/test-package', false)
      await expect(failure).rejects.toBe(gatedOffError)
      await expect(failure).rejects.not.toThrow('stayed in package.json')
    } finally {
      registrationSpy.mockRestore()
    }
  })

  it('keeps the leftover-package hint for a plain registration error on a newly added package', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    const appDir = path.join(tmpDir, 'app')
    buildPackageFixture(packageRoot, 'test_package')
    writeAppPackageJson(appDir)
    const resolver = buildResolver(appDir, packageRoot, 'export const enabledModules = []\n')
    simulateYarnAdd(appDir, '@open-mercato/test-package')
    const registrationSpy = jest
      .spyOn(modulesConfig, 'ensureModuleRegistration')
      .mockImplementation(() => {
        throw new Error('Could not update modules.ts.')
      })

    try {
      const failure = addOfficialModule(resolver, '@open-mercato/test-package', false)
      await expect(failure).rejects.toThrow('Could not update modules.ts.')
      await expect(failure).rejects.toThrow(
        'The package "@open-mercato/test-package" stayed in package.json. To remove it, run: yarn remove @open-mercato/test-package',
      )
    } finally {
      registrationSpy.mockRestore()
    }
  })
})
