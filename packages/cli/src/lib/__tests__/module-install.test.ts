import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { enableOfficialModule } from '../module-install'

function buildPackageFixture(
  packageRoot: string,
  moduleId: string,
  options?: {
    ejectable?: boolean
    extraSourceFiles?: Array<{ relativePath: string; content: string }>
  },
): void {
  const ejectable = options?.ejectable ?? false
  for (const base of ['src', 'dist']) {
    fs.mkdirSync(path.join(packageRoot, base, 'modules', moduleId), { recursive: true })
  }
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@open-mercato/test-package', version: '0.1.0' }),
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
      "{ id: 'test_package', from: '@app' }",
    )
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
})
