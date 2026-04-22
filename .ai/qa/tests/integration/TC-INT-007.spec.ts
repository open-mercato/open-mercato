import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
const fixtureModulePackage = path.join(
  repoRoot,
  'packages',
  'cli',
  'src',
  'lib',
  '__fixtures__',
  'official-module-package',
)

function yarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}

function runCommand(command: string, args: string[], cwd: string): string {
  const yarnCacheFolder = path.join(cwd, '.yarn', 'cache')
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
      YARN_CACHE_FOLDER: yarnCacheFolder,
      YARN_ENABLE_GLOBAL_CACHE: '0',
      YARN_NODE_LINKER: 'node-modules',
    },
  })
}

function runMercato(args: string[], cwd: string): string {
  return runCommand(process.execPath, [cliBin, ...args], cwd)
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createCoreWorkspacePackage(rootDir: string, relativeDir: string): string {
  const coreDir = path.join(rootDir, relativeDir)
  writeFile(
    path.join(coreDir, 'package.json'),
    JSON.stringify(
      {
        name: '@open-mercato/core',
        version: '0.4.7',
        type: 'module',
      },
      null,
      2,
    ),
  )
  return coreDir
}

function createMonorepoFixture(rootDir: string): string {
  writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'cli-module-monorepo-fixture',
        private: true,
        workspaces: ['apps/*', 'packages/*'],
      },
      null,
      2,
    ),
  )
  writeFile(
    path.join(rootDir, '.yarnrc.yml'),
    ['nodeLinker: node-modules', 'enableGlobalCache: false', 'cacheFolder: ./.yarn/cache', ''].join('\n'),
  )
  createCoreWorkspacePackage(rootDir, path.join('packages', 'core'))

  const appDir = path.join(rootDir, 'apps', 'mercato')
  writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: '@open-mercato/app',
        version: '0.0.0',
        private: true,
      },
      null,
      2,
    ),
  )
  writeFile(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
  return appDir
}

function createStandaloneFixture(rootDir: string): string {
  writeFile(
    path.join(rootDir, '.yarnrc.yml'),
    ['nodeLinker: node-modules', 'enableGlobalCache: false', 'cacheFolder: ./.yarn/cache', ''].join('\n'),
  )
  createCoreWorkspacePackage(rootDir, path.join('vendor', 'core'))
  writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'cli-module-standalone-fixture',
        private: true,
        dependencies: {
          '@open-mercato/core': 'file:./vendor/core',
        },
      },
      null,
      2,
    ),
  )
  writeFile(path.join(rootDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
  return rootDir
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

test.describe('TC-INT-007: CLI official module install and eject flows', () => {
  test('module add installs and registers a package-backed module in a monorepo app', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-monorepo-'))

    try {
      const appDir = createMonorepoFixture(rootDir)
      runCommand(yarnBinary(), ['install'], rootDir)

      runMercato(
        [
          'module',
          'add',
          `@open-mercato/test-package@file:${fixtureModulePackage}`,
        ],
        rootDir,
      )

      const modulesSource = readFile(path.join(appDir, 'src', 'modules.ts'))
      const cssSource = readFile(path.join(appDir, '.mercato', 'generated', 'module-package-sources.css'))
      const appPackageJson = JSON.parse(readFile(path.join(appDir, 'package.json'))) as {
        dependencies?: Record<string, string>
      }

      expect(modulesSource).toContain("{ id: 'test_package', from: '@open-mercato/test-package' }")
      expect(cssSource).toContain('node_modules/@open-mercato/test-package/src/**/*.{ts,tsx}')
      expect(appPackageJson.dependencies?.['@open-mercato/test-package']).toBeTruthy()
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('module add --eject copies module source and omits package CSS entries', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-standalone-source-'))

    try {
      createStandaloneFixture(appDir)
      runCommand(yarnBinary(), ['install'], appDir)

      runMercato(
        [
          'module',
          'add',
          `@open-mercato/test-package@file:${fixtureModulePackage}`,
          '--eject',
        ],
        appDir,
      )

      const modulesSource = readFile(path.join(appDir, 'src', 'modules.ts'))
      const cssSource = readFile(path.join(appDir, '.mercato', 'generated', 'module-package-sources.css'))

      expect(modulesSource).toContain("{ id: 'test_package', from: '@app' }")
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(true)
      expect(cssSource).toBe('')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('module enable supports package-backed and ejected flows plus both eject entrypoints', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-standalone-eject-'))

    try {
      createStandaloneFixture(appDir)
      runCommand(yarnBinary(), ['install'], appDir)
      runCommand(
        yarnBinary(),
        ['add', `@open-mercato/test-package@file:${fixtureModulePackage}`],
        appDir,
      )

      runMercato(['module', 'enable', '@open-mercato/test-package'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain(
        "{ id: 'test_package', from: '@open-mercato/test-package' }",
      )

      writeFile(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['module', 'enable', '@open-mercato/test-package', '--eject'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("{ id: 'test_package', from: '@app' }")
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(true)
      expect(readFile(path.join(appDir, '.mercato', 'generated', 'module-package-sources.css'))).toBe('')

      writeFile(path.join(appDir, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n")
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['module', 'eject', 'test_package'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("{ id: 'test_package', from: '@app' }")

      writeFile(path.join(appDir, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n")
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['eject', 'test_package'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("{ id: 'test_package', from: '@app' }")
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })
})
