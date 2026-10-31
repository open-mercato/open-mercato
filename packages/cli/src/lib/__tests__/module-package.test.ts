import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import {
  assertModulePackageExports,
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

  it('reads static dependency ids from the module descriptor', () => {
    const packageRoot = path.join(tmpDir, 'package-with-dependencies')
    copyDir(fixturePackageRoot, packageRoot)
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'test_package', 'index.ts'),
      [
        'export const metadata = {',
        "  title: 'Test Package',",
        "  requires: ['customers', 'catalog'],",
        '  ejectable: true,',
        '} as const',
        '',
      ].join('\n'),
    )

    const modulePackage = readOfficialModulePackageFromRoot(packageRoot)

    expect(modulePackage.moduleInfo.requires).toEqual(['customers', 'catalog'])
  })

  it('rejects a dynamic dependency declaration that cannot be checked safely', () => {
    const packageRoot = path.join(tmpDir, 'package-with-dynamic-dependencies')
    copyDir(fixturePackageRoot, packageRoot)
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'test_package', 'index.ts'),
      "const dependencies = ['customers']\nexport const metadata = { requires: dependencies }\n",
    )

    expect(() => readOfficialModulePackageFromRoot(packageRoot)).toThrow(
      'must declare "requires" as a static string array',
    )
  })

  it('validates a third-party (non-@open-mercato) module package by structure', () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@fast-white-cat', 'integration-ksef-direct')
    for (const base of ['src', 'dist']) {
      fs.mkdirSync(path.join(packageRoot, base, 'modules', 'ksef_direct'), { recursive: true })
    }
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@fast-white-cat/integration-ksef-direct', version: '0.1.0' }),
    )
    fs.writeFileSync(
      path.join(packageRoot, 'src', 'modules', 'ksef_direct', 'index.ts'),
      "export const metadata = { title: 'KSeF Direct', ejectable: false }\n",
    )
    fs.writeFileSync(
      path.join(packageRoot, 'dist', 'modules', 'ksef_direct', 'index.js'),
      'exports.metadata = {};\n',
    )

    const modulePackage = readOfficialModulePackageFromRoot(
      packageRoot,
      '@fast-white-cat/integration-ksef-direct',
    )

    expect(modulePackage.packageName).toBe('@fast-white-cat/integration-ksef-direct')
    expect(modulePackage.metadata.moduleId).toBe('ksef_direct')
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

  it('resolves an installed alias while retaining the canonical manifest name', () => {
    const appDir = path.join(tmpDir, 'app')
    const packageRoot = path.join(appDir, 'node_modules', 'candidate_consents')
    fs.mkdirSync(appDir, { recursive: true })
    copyDir(fixturePackageRoot, packageRoot)
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ dependencies: { candidate_consents: 'npm:@open-mercato/test-package@1.0.0' } }))
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@open-mercato/test-package', exports: { '.': './dist/modules/test_package/index.js', './modules/*': { import: './dist/modules/*.js' } } }))
    const resolver = { getAppDir: () => appDir, getPackageRoot: () => packageRoot } as unknown as PackageResolver

    const result = resolveInstalledOfficialModulePackage(resolver, 'candidate_consents')

    expect(result.packageName).toBe('@open-mercato/test-package')
    expect(fs.realpathSync(result.packageRoot)).toBe(fs.realpathSync(packageRoot))
    expect(result.metadata.moduleId).toBe('test_package')
  })

  it('rejects an unrelated package root returned for an unobserved binding', () => {
    const packageRoot = path.join(tmpDir, 'unrelated-package')
    copyDir(fixturePackageRoot, packageRoot)
    const resolver = { getAppDir: () => tmpDir, getPackageRoot: () => packageRoot } as unknown as PackageResolver

    expect(() => resolveInstalledOfficialModulePackage(resolver, 'uninstalled_binding')).toThrow('does not match requested package binding')
    expect(() => readOfficialModulePackageFromRoot(packageRoot, 'uninstalled_binding')).toThrow('does not match requested package')
  })

  it('rejects module subpaths hidden by package exports before enabling an alias', () => {
    const appDir = path.join(tmpDir, 'app')
    const packageRoot = path.join(appDir, 'node_modules', 'candidate_consents')
    copyDir(fixturePackageRoot, packageRoot)
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@open-mercato/test-package', exports: { '.': './dist/modules/test_package/index.js' } }))
    const resolver = { getAppDir: () => appDir, getPackageRoot: () => packageRoot } as unknown as PackageResolver

    expect(() => resolveInstalledOfficialModulePackage(resolver, 'candidate_consents')).toThrow('candidate_consents/modules/test_package/index')
  })

  it('accepts ESM import-only and nested node conditions without requiring CommonJS exports', () => {
    const files = ['dist/modules/consents/index.js', 'dist/modules/consents/di.js', 'esm/consents/index.mjs', 'esm/consents/di.mjs']
    const manifest = { exports: { './modules/consents/*': { types: './types/*.d.ts', node: { import: './esm/consents/*.mjs', require: null }, default: './dist/modules/consents/*.js' } } }

    expect(() => assertModulePackageExports(manifest, 'consents_candidate', 'consents', files)).not.toThrow()
  })

  it('honors an explicit blocked subpath over a wildcard and rejects missing mapped targets', () => {
    const files = ['dist/modules/consents/index.js', 'dist/modules/consents/di.js']
    const blocked = { exports: { './modules/*': './dist/modules/*.js', './modules/consents/di': null } }
    const missing = { exports: { './modules/*': { import: './missing/*.js' } } }

    expect(() => assertModulePackageExports(blocked, 'consents_candidate', 'consents', files)).toThrow('consents_candidate/modules/consents/di')
    expect(() => assertModulePackageExports(missing, 'consents_candidate', 'consents', files)).toThrow('consents_candidate/modules/consents/index')
  })

  it('keeps private helper files private while validating generated convention imports', () => {
    const files = ['dist/modules/consents/index.js', 'dist/modules/consents/lib/private.js']
    const manifest = { exports: { './modules/consents/index': './dist/modules/consents/index.js' } }

    expect(() => assertModulePackageExports(manifest, 'consents_candidate', 'consents', files)).not.toThrow()
  })

  it('validates selective exports only for discovered entry points and leaves their private helpers private', () => {
    const publicFiles = ['index', 'backend/tasks/page', 'frontend/consents/page', 'widgets/injection/consents/widget', 'commands/create']
    const privateFiles = ['backend/tasks/TaskForm', 'backend/tasks/helpers', 'frontend/consents/ConsentForm', 'widgets/injection/consents/ConsentField', 'commands/index', 'commands/shared', 'commands/factory', 'commands/create.test', 'backend/__tests__/page', 'widgets/__mocks__/injection/consents/widget', 'workers/__tests__/handler', 'subscribers/__mocks__/handler']
    const files = [...publicFiles, ...privateFiles].flatMap((file) => [
      `src/modules/consents/${file}${file.endsWith('/page') || /TaskForm|ConsentForm|ConsentField/.test(file) ? '.tsx' : '.ts'}`,
      `dist/modules/consents/${file}.js`,
    ])
    const exports = Object.fromEntries(publicFiles.map((file) => [`./modules/consents/${file}`, `./dist/modules/consents/${file}.js`]))

    expect(() => assertModulePackageExports({ exports }, 'consents_candidate', 'consents', files)).not.toThrow()
    const missingPageExport = { ...exports, './modules/consents/backend/tasks/page': null }
    expect(() => assertModulePackageExports({ exports: missingPageExport }, 'consents_candidate', 'consents', files, () => 'export default function Page() {}')).toThrow('consents_candidate/modules/consents/backend/tasks/page')
  })

  it('uses source exports to distinguish private lowercase helpers from generated pages and HTTP handlers', () => {
    const source = {
      'index.ts': 'export const metadata = {}',
      'backend/tasks/page.tsx': 'export default function Page() {}',
      'backend/tasks/form-utils.tsx': 'export function renderLabel() {}',
      'backend/tasks/form-utils.meta.ts': 'export const metadata = {}',
      'api/helpers.ts': 'export function parseInput() {}',
      'api/orders.ts': 'export { listOrders as GET }',
    }
    const files = Object.keys(source).flatMap((file) => [`src/modules/consents/${file}`, `dist/modules/consents/${file.replace(/\.tsx?$/, '.js')}`])
    const exports = Object.fromEntries(['index', 'backend/tasks/page', 'api/orders'].map((file) => [`./modules/consents/${file}`, `./dist/modules/consents/${file}.js`]))
    const readSource = jest.fn((file: string) => source[file.replace('src/modules/consents/', '') as keyof typeof source])
    expect(() => assertModulePackageExports({ exports }, 'candidate', 'consents', files, readSource)).not.toThrow()
    expect(() => assertModulePackageExports({ exports: { ...exports, './modules/consents/backend/tasks/page': null } }, 'candidate', 'consents', files, readSource)).toThrow('backend/tasks/page')
    expect(() => assertModulePackageExports({ exports: { ...exports, './modules/consents/api/orders': null } }, 'candidate', 'consents', files, readSource)).toThrow('api/orders')
    expect(() => assertModulePackageExports({ exports: { './modules/consents/index': './dist/modules/consents/index.js' } }, 'candidate', 'consents', files)).not.toThrow()
  })

  it('rejects invalid manifest names instead of attributing them to an import binding', () => {
    const packageRoot = path.join(tmpDir, 'invalid-name')
    copyDir(fixturePackageRoot, packageRoot)
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'invalid package' }))

    expect(() => readOfficialModulePackageFromRoot(packageRoot)).toThrow('invalid "name" field')
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
