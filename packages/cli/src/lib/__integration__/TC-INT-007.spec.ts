import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
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

function runCommand(command: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv = {}): string {
  const yarnCacheFolder = path.join(cwd, '.yarn', 'cache')
  try {
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
        ...environment,
      },
    })
  } catch (error) {
    if (!error || typeof error !== 'object') throw error
    const errorRecord = error as Record<string, unknown>
    const outputs = ['stdout', 'stderr'].flatMap((streamName) => {
      const output = errorRecord[streamName]
      return typeof output === 'string' || Buffer.isBuffer(output) ? [output.toString().trim()] : []
    }).filter(Boolean)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(outputs.length > 0 ? `${message}\n${outputs.join('\n')}` : message)
  }
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
  writeFile(path.join(rootDir, 'yarn.lock'), '')
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
  writeFile(path.join(rootDir, 'yarn.lock'), '')
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

      expect(modulesSource).toMatch(/id: 'test_package', from: '@open-mercato\/test-package'/)
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

      expect(modulesSource).toMatch(/id: 'test_package', from: '@app'/)
      expect(modulesSource).toContain("locator: 'npm:@open-mercato/test-package'")
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(true)
      expect(cssSource).toBe('')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('module add reports dependencies that must be enabled before registration', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-standalone-dependencies-'))

    try {
      createStandaloneFixture(appDir)
      const packageDir = path.join(appDir, 'fixture-module-package')
      fs.cpSync(fixtureModulePackage, packageDir, { recursive: true })
      writeFile(
        path.join(packageDir, 'src', 'modules', 'test_package', 'index.ts'),
        "export const metadata = { id: 'test_package', requires: ['customers'], ejectable: true }\n",
      )
      runCommand(yarnBinary(), ['install'], appDir)

      expect(() => runMercato(
        ['module', 'add', '@open-mercato/test-package@file:./fixture-module-package'],
        appDir,
      )).toThrow(/requires module\(s\) that are not enabled: customers/)

      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toBe('export const enabledModules = []\n')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('module add resolves canonical requirements from retained ejected origins', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-canonical-requires-'))

    try {
      createStandaloneFixture(appDir)
      const packageDir = path.join(appDir, 'fixture-module-package')
      fs.cpSync(fixtureModulePackage, packageDir, { recursive: true })
      const requirements = [
        '@pkarw/marketing_consents@preview',
        'npm:@pkarw/marketing_consents@1.0.0',
        'github:pkarw/marketing-consents',
        'npm:consent-helper@next',
        'github:pkarw/consent-tools#main',
        'pkarw/consent-tools',
        'https://github.com/pkarw/consent-tools.git#release',
        'ssh://git@github.com/pkarw/consent-tools.git#main',
        'git@github.com:pkarw/consent-tools.git',
        'github:pkarw/installed-tools',
        'npm:@open-mercato/core@preview',
      ]
      writeFile(
        path.join(packageDir, 'src', 'modules', 'test_package', 'index.ts'),
        `export const metadata = { id: 'test_package', requires: ${JSON.stringify(requirements)}, ejectable: true }\n`,
      )
      const entries = [
        { id: 'marketing_consents', from: '@app', locator: 'github:pkarw/marketing-consents', packageName: '@pkarw/marketing_consents' },
        { id: 'npm_consents', from: '@app', locator: 'npm:@pkarw/marketing_consents', packageName: '@pkarw/marketing_consents' },
        { id: 'npm_core', from: '@app', locator: 'npm:@open-mercato/core', packageName: '@open-mercato/core' },
        { id: 'consent_helper', from: '@app', locator: 'npm:consent-helper' },
        { id: 'consent_tools', from: '@app', locator: 'github:pkarw/consent-tools' },
      ]
      for (const entry of entries) {
        writeFile(
          path.join(appDir, 'src', 'modules', entry.id, 'index.ts'),
          `export const metadata = { id: '${entry.id}' }\n`,
        )
      }
      const corePackageDir = path.join(appDir, 'vendor', 'core')
      writeFile(
        path.join(corePackageDir, 'package.json'),
        JSON.stringify({ name: '@open-mercato/core', version: '0.4.7', type: 'module', repository: { type: 'git', url: 'https://github.com/pkarw/installed-tools.git' } }),
      )
      writeFile(
        path.join(corePackageDir, 'src', 'modules', 'repository_tools', 'index.ts'),
        "export const metadata = { id: 'repository_tools' }\n",
      )
      writeFile(
        path.join(corePackageDir, 'dist', 'modules', 'repository_tools', 'index.js'),
        "export const metadata = { id: 'repository_tools' }\n",
      )
      const enabledEntries = [...entries, { id: 'repository_tools', from: '@open-mercato/core', locator: 'github:pkarw/installed-tools' }]
      writeFile(path.join(appDir, 'src', 'modules.ts'), `export const enabledModules = ${JSON.stringify(enabledEntries)}\n`)
      runCommand(yarnBinary(), ['install'], appDir)

      runMercato(['module', 'add', 'npm:@open-mercato/test-package@file:./fixture-module-package'], appDir)

      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("id: 'test_package'")
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('same-name modules from different origins do not satisfy canonical requirements', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-wrong-origin-'))

    try {
      createStandaloneFixture(appDir)
      const packageDir = path.join(appDir, 'fixture-module-package')
      fs.cpSync(fixtureModulePackage, packageDir, { recursive: true })
      writeFile(
        path.join(packageDir, 'src', 'modules', 'test_package', 'index.ts'),
        "export const metadata = { id: 'test_package', requires: ['@pkarw/marketing_consents', 'github:pkarw/consent-tools'], ejectable: true }\n",
      )
      const modulesSource = `export const enabledModules = [
        { id: 'marketing_consents', from: '@app', locator: 'npm:@open-mercato/marketing_consents' },
        { id: 'consent_tools', from: '@app', locator: 'github:another-owner/consent-tools' },
      ]\n`
      writeFile(path.join(appDir, 'src', 'modules.ts'), modulesSource)
      runCommand(yarnBinary(), ['install'], appDir)

      expect(() => runMercato(
        ['module', 'add', '@open-mercato/test-package@file:./fixture-module-package', '--eject'],
        appDir,
      )).toThrow(/@pkarw\/marketing_consents[\s\S]*github:pkarw\/consent-tools[\s\S]*npx create-mercato-module install/)

      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toBe(modulesSource)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package'))).toBe(false)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('module add rejects a same-ID source collision before ejecting', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-module-collision-'))

    try {
      createStandaloneFixture(appDir)
      const modulesSource = "export const enabledModules = [{ id: 'test_package', from: '@app', locator: 'github:another-owner/test-package' }]\n"
      const localSource = "export const metadata = { id: 'test_package', locator: 'github:another-owner/test-package' }\n"
      writeFile(path.join(appDir, 'src', 'modules.ts'), modulesSource)
      writeFile(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'), localSource)
      runCommand(yarnBinary(), ['install'], appDir)

      expect(() => runMercato(
        ['module', 'add', `@open-mercato/test-package@file:${fixtureModulePackage}`, '--eject'],
        appDir,
      )).toThrow(/(?=[\s\S]*test_package)(?=[\s\S]*(?:collision|already|conflict))(?=[\s\S]*another-owner)(?=[\s\S]*@open-mercato\/test-package)/i)

      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toBe(modulesSource)
      expect(readFile(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(localSource)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('GitHub locators detect a runtime ID collision before invoking Yarn', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-github-collision-'))
    try {
      createStandaloneFixture(appDir)
      const modulesSource = "export const enabledModules = [{ id: 'test_package', from: '@app', locator: 'github:other/test-package' }]\n"
      writeFile(path.join(appDir, 'src', 'modules.ts'), modulesSource)
      const originalManifest = readFile(path.join(appDir, 'package.json'))
      const executableDir = path.join(appDir, 'bin')
      const packageManifest = Buffer.from(JSON.stringify({ name: '@pkarw/test-package' })).toString('base64')
      const ghPath = path.join(executableDir, 'gh')
      writeFile(ghPath, `#!/usr/bin/env node
const endpoint = process.argv[3]
const sha = 'a'.repeat(40)
const value = endpoint === 'user' ? { login: 'pkarw' }
  : endpoint.includes('/commits/') ? { sha }
  : endpoint.includes('/contents/') ? { encoding: 'base64', content: ${JSON.stringify(packageManifest)} }
  : endpoint.includes('/git/trees/') ? { tree: [{ path: 'src/modules/test_package/index.ts' }] }
  : { default_branch: 'main' }
process.stdout.write(JSON.stringify(value))
`)
      const yarnPath = path.join(executableDir, 'yarn')
      const marker = path.join(appDir, 'yarn-invoked')
      writeFile(yarnPath, "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.COLLISION_YARN_MARKER, 'invoked')\nprocess.exit(1)\n")
      fs.chmodSync(ghPath, 0o755)
      fs.chmodSync(yarnPath, 0o755)
      for (const locator of ['github:pkarw/test-package', 'https://github.com/pkarw/test-package.git', 'git@github.com:pkarw/test-package.git', 'github:test-package']) {
        expect(() => runCommand(process.execPath, [cliBin, 'module', 'add', locator, '--allow-third-party'], appDir, {
          PATH: executableDir + path.delimiter + process.env.PATH,
          COLLISION_YARN_MARKER: marker,
        })).toThrow(/Module name collision[\s\S]*test_package[\s\S]*github:other\/test-package[\s\S]*github:pkarw\/test-package/)
      }
      expect(fs.existsSync(marker)).toBe(false)
      expect(readFile(path.join(appDir, 'package.json'))).toBe(originalManifest)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toBe(modulesSource)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package'))).toBe(false)
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
        "id: 'test_package', from: '@open-mercato/test-package'",
      )

      writeFile(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['module', 'enable', '@open-mercato/test-package', '--eject'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("id: 'test_package', from: '@app'")
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'test_package', 'index.ts'))).toBe(true)
      expect(readFile(path.join(appDir, '.mercato', 'generated', 'module-package-sources.css'))).toBe('')

      writeFile(path.join(appDir, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n")
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['module', 'eject', 'test_package'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("packageName: '@open-mercato/test-package'")
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).not.toContain("locator: 'npm:@open-mercato/test-package'")
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("id: 'test_package', from: '@app'")

      writeFile(path.join(appDir, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'test_package', from: '@open-mercato/test-package' }]\n")
      fs.rmSync(path.join(appDir, 'src', 'modules', 'test_package'), { recursive: true, force: true })
      runMercato(['eject', 'test_package'], appDir)
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("packageName: '@open-mercato/test-package'")
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).not.toContain("locator: 'npm:@open-mercato/test-package'")
      expect(readFile(path.join(appDir, 'src', 'modules.ts'))).toContain("id: 'test_package', from: '@app'")
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })
})
