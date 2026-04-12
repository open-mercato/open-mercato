import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const builtCliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
let didBuildPackages = false

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
      YARN_ENABLE_IMMUTABLE_INSTALLS: '0',
      YARN_NODE_LINKER: 'node-modules',
    },
  })
}

function ensureBuiltCliArtifacts(): void {
  if (fs.existsSync(builtCliBin)) {
    return
  }

  runCommand(yarnBinary(), ['build:packages'], repoRoot)
  didBuildPackages = true
}

function isMissingBuiltArtifactError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('ERR_MODULE_NOT_FOUND')
    && error.message.includes('/dist/')
}

function runMercato(args: string[], cwd: string): string {
  ensureBuiltCliArtifacts()

  try {
    return runCommand(process.execPath, [builtCliBin, ...args], cwd)
  } catch (error) {
    if (didBuildPackages || !isMissingBuiltArtifactError(error)) {
      throw error
    }

    runCommand(yarnBinary(), ['build:packages'], repoRoot)
    didBuildPackages = true
    return runCommand(process.execPath, [builtCliBin, ...args], cwd)
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

function createCoreWorkspacePackage(rootDir: string, relativeDir: string): string {
  const coreDir = path.join(rootDir, relativeDir)
  writeFile(
    path.join(coreDir, 'package.json'),
    JSON.stringify(
      {
        name: '@open-mercato/core',
        version: '0.4.10',
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
        name: 'cli-module-entities-monorepo-fixture',
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
        name: 'cli-module-entities-standalone-fixture',
        private: true,
        dependencies: {
          '@open-mercato/core': 'file:./vendor/core',
        },
      },
      null,
      2,
    ),
  )
  return rootDir
}

function generatedEntitiesPath(appDir: string): string {
  return path.join(appDir, '.mercato', 'generated', 'entities.generated.ts')
}

test.describe('TC-INT-008: CLI module entities generation', () => {
  test('prefers app data entities over package override files for package-backed modules', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-entities-monorepo-'))

    try {
      const appDir = createMonorepoFixture(rootDir)
      writeFile(
        path.join(appDir, 'src', 'modules.ts'),
        "export const enabledModules = [{ id: 'orders', from: '@open-mercato/core' }]\n",
      )
      writeFile(
        path.join(appDir, 'src', 'modules', 'orders', 'data', 'entities.ts'),
        'export class AppOrder {}\n',
      )
      writeFile(
        path.join(rootDir, 'packages', 'core', 'src', 'modules', 'orders', 'data', 'entities.override.ts'),
        'export class PackageOverrideOrder {}\n',
      )

      runCommand(yarnBinary(), ['install'], rootDir)
      runMercato(['generate', 'entities', '--quiet'], rootDir)

      const output = readFile(generatedEntitiesPath(appDir))
      expect(output).toContain('from "@/modules/orders/data/entities"')
      expect(output).not.toContain('@open-mercato/core/modules/orders/data/entities.override')
      expect(output).toContain('...enhanceEntities(E_orders_0, "orders")')
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('uses relative imports for standalone app modules', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-entities-standalone-'))

    try {
      createStandaloneFixture(appDir)
      writeFile(
        path.join(appDir, 'src', 'modules.ts'),
        "export const enabledModules = [{ id: 'custom_app', from: '@app' }]\n",
      )
      writeFile(
        path.join(appDir, 'src', 'modules', 'custom_app', 'data', 'entities.ts'),
        'export class CustomRecord {}\n',
      )

      runCommand(yarnBinary(), ['install'], appDir)
      runMercato(['generate', 'entities', '--quiet'], appDir)

      const output = readFile(generatedEntitiesPath(appDir))
      expect(output).toContain('from "../../src/modules/custom_app/data/entities"')
      expect(output).not.toContain('@/modules/custom_app/data/entities')
      expect(output).toContain('...enhanceEntities(E_custom_app_0, "custom_app")')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('falls back to legacy db schema files when data entities are missing', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-entities-legacy-'))

    try {
      const appDir = createMonorepoFixture(rootDir)
      writeFile(
        path.join(appDir, 'src', 'modules.ts'),
        "export const enabledModules = [{ id: 'legacy_orders', from: '@open-mercato/core' }]\n",
      )
      writeFile(
        path.join(rootDir, 'packages', 'core', 'src', 'modules', 'legacy_orders', 'db', 'schema.js'),
        'export class LegacyOrder {}\n',
      )

      runCommand(yarnBinary(), ['install'], rootDir)
      runMercato(['generate', 'entities', '--quiet'], rootDir)

      const output = readFile(generatedEntitiesPath(appDir))
      expect(output).toContain('from "@open-mercato/core/modules/legacy_orders/db/schema"')
      expect(output).toContain('...enhanceEntities(E_legacy_orders_0, "legacy_orders")')
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
