import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import {
  discoverModulesInPackage,
  parsePackageNameFromSpec,
  readOfficialModulePackageFromRoot,
  resolveInstalledOfficialModulePackage,
  validateEjectBoundaries,
} from '../module-package'

const fixturePackageRoot = path.resolve(
  __dirname,
  '..',
  '__fixtures__',
  'official-module-package',
)

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

describe('module-package', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-package-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses official package names from package specs', () => {
    expect(parsePackageNameFromSpec('@open-mercato/test-package')).toBe('@open-mercato/test-package')
    expect(parsePackageNameFromSpec('@open-mercato/test-package@preview')).toBe('@open-mercato/test-package')
    expect(parsePackageNameFromSpec('@open-mercato/test-package@file:/tmp/pkg')).toBe('@open-mercato/test-package')
  })

  it('reads and validates an official module package manifest', () => {
    const modulePackage = readOfficialModulePackageFromRoot(fixturePackageRoot, '@open-mercato/test-package')

    expect(modulePackage.packageName).toBe('@open-mercato/test-package')
    expect(modulePackage.metadata.moduleId).toBe('test_package')
    expect(modulePackage.metadata.ejectable).toBe(true)
    expect(modulePackage.sourceModuleDir).toContain(path.join('src', 'modules', 'test_package'))
    expect(modulePackage.distModuleDir).toContain(path.join('dist', 'modules', 'test_package'))
  })

  it('resolves a hoisted installed module package from a monorepo app', () => {
    const appDir = path.join(tmpDir, 'apps', 'mercato')
    const installedPackageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    fs.mkdirSync(appDir, { recursive: true })
    copyDir(fixturePackageRoot, installedPackageRoot)

    const resolver = {
      getAppDir: () => appDir,
      getPackageRoot: () => installedPackageRoot,
    } as unknown as PackageResolver

    const modulePackage = resolveInstalledOfficialModulePackage(
      resolver,
      '@open-mercato/test-package',
    )

    expect(fs.realpathSync(modulePackage.packageRoot)).toBe(fs.realpathSync(installedPackageRoot))
    expect(modulePackage.metadata.moduleId).toBe('test_package')
  })

  it('discovers all modules in a multi-module package', () => {
    const packageRoot = path.join(tmpDir, 'multi-module-package')
    fs.mkdirSync(path.join(packageRoot, 'src', 'modules', 'alpha'), { recursive: true })
    fs.mkdirSync(path.join(packageRoot, 'src', 'modules', 'beta'), { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'alpha', 'index.ts'),
      "export const metadata = { ejectable: true }\n",
    )
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'beta', 'index.ts'),
      "export const metadata = { ejectable: false }\n",
    )

    const modules = discoverModulesInPackage(packageRoot)
    expect(modules).toHaveLength(2)
    expect(modules.find((m) => m.moduleId === 'alpha')?.ejectable).toBe(true)
    expect(modules.find((m) => m.moduleId === 'beta')?.ejectable).toBe(false)
  })

  it('selects a specific module from a multi-module package via targetModuleId', () => {
    const packageRoot = path.join(tmpDir, 'multi-module-pkg')
    for (const moduleId of ['customers', 'sales']) {
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
      JSON.stringify({ name: '@open-mercato/core' }),
    )

    const result = readOfficialModulePackageFromRoot(packageRoot, undefined, 'sales')
    expect(result.metadata.moduleId).toBe('sales')
    expect(result.sourceModuleDir).toContain(path.join('modules', 'sales'))
  })

  it('throws when targetModuleId is not found in package', () => {
    const packageRoot = path.join(tmpDir, 'single-module-pkg')
    fs.mkdirSync(path.join(packageRoot, 'src', 'modules', 'customers'), { recursive: true })
    fs.mkdirSync(path.join(packageRoot, 'dist', 'modules', 'customers'), { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'customers', 'index.ts'),
      `export const metadata = { ejectable: false }\n`,
    )
    fs.writeFileSync(
      path.join(packageRoot, 'dist', 'modules', 'customers', 'index.js'),
      `exports.metadata = {};\n`,
    )
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/core' }),
    )

    expect(() =>
      readOfficialModulePackageFromRoot(packageRoot, undefined, 'nonexistent'),
    ).toThrow('does not contain module "nonexistent"')
  })

  it('throws when a multi-module package is used without specifying a module', () => {
    const packageRoot = path.join(tmpDir, 'ambiguous-pkg')
    for (const moduleId of ['alpha', 'beta']) {
      fs.mkdirSync(path.join(packageRoot, 'src', 'modules', moduleId), { recursive: true })
      fs.mkdirSync(path.join(packageRoot, 'dist', 'modules', moduleId), { recursive: true })
      fs.writeFileSync(
        path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts'),
        `export const metadata = {}\n`,
      )
      fs.writeFileSync(
        path.join(packageRoot, 'dist', 'modules', moduleId, 'index.js'),
        `exports.metadata = {};\n`,
      )
    }
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@open-mercato/multi' }),
    )

    expect(() =>
      readOfficialModulePackageFromRoot(packageRoot),
    ).toThrow('contains multiple modules')
  })

  it('rejects --eject when a module imports files outside its module directory', () => {
    const invalidPackageRoot = path.join(tmpDir, 'invalid-package')
    copyDir(fixturePackageRoot, invalidPackageRoot)

    fs.mkdirSync(path.join(invalidPackageRoot, 'src', 'lib'), { recursive: true })
    fs.writeFileSync(
      path.join(invalidPackageRoot, 'src', 'lib', 'shared.ts'),
      'export const sharedValue = 1\n',
    )
    fs.mkdirSync(path.join(invalidPackageRoot, 'src', 'modules', 'test_package', 'lib'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(invalidPackageRoot, 'src', 'modules', 'test_package', 'lib', 'broken.ts'),
      "import { sharedValue } from '../../../lib/shared'\nexport const brokenValue = sharedValue\n",
    )

    expect(() =>
      validateEjectBoundaries(
        readOfficialModulePackageFromRoot(invalidPackageRoot, '@open-mercato/test-package'),
      ),
    ).toThrow('cannot be added with --eject')
  })

  it('ignores AppleDouble metadata files when validating --eject boundaries', () => {
    const packageRoot = path.join(tmpDir, 'package-with-sidecars')
    copyDir(fixturePackageRoot, packageRoot)

    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'test_package', '._setup.ts'),
      "import { sharedValue } from '../../../lib/shared'\n",
    )
    fs.mkdirSync(path.join(packageRoot, 'src', 'modules', 'test_package', 'backend', 'test-packag'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'test_package', 'backend', 'test-packag', '._page.tsx'),
      "import { sharedValue } from '../../../../lib/shared'\n",
    )

    expect(() =>
      validateEjectBoundaries(
        readOfficialModulePackageFromRoot(packageRoot, '@open-mercato/test-package'),
      ),
    ).not.toThrow()
  })
})
