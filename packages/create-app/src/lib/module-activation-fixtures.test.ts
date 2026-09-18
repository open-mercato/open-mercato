import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DESIGN_SYSTEM_ACTIVATION_ENTRY,
  EXAMPLE_ACTIVATION_ENTRY,
  EXAMPLE_INTEGRATION_ACTIVATION_ENTRY,
  assertDesignSystemActivation,
  assertExampleActivation,
  assertModulesUnregistered,
  enableModuleEntry,
  runActivationFixture,
  type ModuleActivationEntry,
} from '../../../../scripts/lib/module-activation-fixtures.ts'

// Disabled-by-default delivery contract, activation half: every preset ships the
// `example` and `design_system` sources without registering them, so both must
// still work when a developer explicitly enables one — and neither may drag the
// other in. `starter-preset-example-delivery.test.ts` owns the disabled half.
//
// This fixture drives the real scaffolder and the real generator suite against a
// generated app. It stages `node_modules/@open-mercato/*` from the workspace
// build output instead of installing from a registry: the resolver only needs a
// non-symlinked package directory exposing `dist/modules`, which is exactly what
// a published install produces. `scripts/test-create-app.ts` runs the same two
// fixtures end to end against a real Verdaccio install and `yarn generate`.
//
// Both fixtures share one scaffolded app, which additionally proves each fixture
// restores the shipped module set instead of leaking it into the next one.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const CLI_ENTRY = path.join(PACKAGE_ROOT, 'src', 'index.ts')
const CLI_SCAFFOLD_TIMEOUT_MS = 120_000
const DISABLED_BY_DEFAULT_MODULE_IDS = ['example', 'example_customers_sync', 'design_system']

type ActivationFixtureApp = {
  targetRoot: string
  appDir: string
  generate: () => Promise<void>
}

let fixtureApp: ActivationFixtureApp | null = null

function stageInstalledPackages(appDir: string): void {
  const scopeDir = path.join(appDir, 'node_modules', '@open-mercato')
  fs.mkdirSync(scopeDir, { recursive: true })

  const packagesDir = path.join(REPO_ROOT, 'packages')
  let staged = 0
  for (const dirent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const packageDir = path.join(packagesDir, dirent.name)
    const manifestPath = path.join(packageDir, 'package.json')
    const distDir = path.join(packageDir, 'dist')
    if (!fs.existsSync(manifestPath) || !fs.existsSync(distDir)) continue

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      name?: string
      version?: string
      main?: string
    }
    if (!manifest.name?.startsWith('@open-mercato/')) continue

    const installedDir = path.join(scopeDir, manifest.name.slice('@open-mercato/'.length))
    fs.mkdirSync(installedDir, { recursive: true })
    fs.writeFileSync(
      path.join(installedDir, 'package.json'),
      `${JSON.stringify({ name: manifest.name, version: manifest.version, main: manifest.main }, null, 2)}\n`,
    )
    fs.symlinkSync(distDir, path.join(installedDir, 'dist'), 'dir')
    staged += 1
  }

  assert.ok(
    staged > 0,
    'No built @open-mercato packages found; run `yarn build:packages` before the activation fixtures',
  )
}

function scaffoldApp(): { targetRoot: string; appDir: string } {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-activation-'))
  const appDir = path.join(targetRoot, 'activation-app')
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', CLI_ENTRY, appDir, '--skip-agentic-setup', '--preset', 'classic'],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: CLI_SCAFFOLD_TIMEOUT_MS,
    },
  )
  assert.equal(
    result.status,
    0,
    `expected CLI scaffold to succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )

  stageInstalledPackages(appDir)
  return { targetRoot, appDir }
}

async function createGenerator(appDir: string): Promise<() => Promise<void>> {
  const { createResolver } = await import(path.join(REPO_ROOT, 'packages', 'cli', 'src', 'lib', 'resolver.ts'))
  const generators = await import(
    path.join(REPO_ROOT, 'packages', 'cli', 'src', 'lib', 'generators', 'index.ts')
  )

  return async () => {
    const resolver = createResolver(appDir)
    assert.equal(
      resolver.isMonorepo(),
      false,
      'The scaffolded fixture app must resolve in standalone mode',
    )
    await generators.generateEntityIds({ resolver, quiet: true })
    await generators.generateModuleRegistries({ resolver, quiet: true })
    await generators.generateModuleEntities({ resolver, quiet: true })
    await generators.generateModuleDi({ resolver, quiet: true })
    await generators.generateModulePackageSources({ resolver, quiet: true })
    await generators.generateOpenApi({ resolver, quiet: true })
  }
}

async function prepareFixtureApp(): Promise<ActivationFixtureApp> {
  if (fixtureApp) return fixtureApp

  const { targetRoot, appDir } = scaffoldApp()
  const generate = await createGenerator(appDir)
  await generate()
  await assertModulesUnregistered(appDir, DISABLED_BY_DEFAULT_MODULE_IDS)

  fixtureApp = { targetRoot, appDir, generate }
  return fixtureApp
}

async function runFixture(
  entry: ModuleActivationEntry,
  assertActivation: (appDir: string) => Promise<void>,
): Promise<void> {
  const { appDir, generate } = await prepareFixtureApp()
  await runActivationFixture({ appDir, entry, generate, assertActivation })
  await assertModulesUnregistered(appDir, DISABLED_BY_DEFAULT_MODULE_IDS)
}

after(() => {
  if (!fixtureApp) return
  fs.rmSync(fixtureApp.targetRoot, { recursive: true, force: true })
  fixtureApp = null
})

test('enabling the example module in a generated app registers the Todo surface only', async () => {
  await runFixture(EXAMPLE_ACTIVATION_ENTRY, assertExampleActivation)
})

test('enabling the design_system module in a generated app registers the gallery only', async () => {
  await runFixture(DESIGN_SYSTEM_ACTIVATION_ENTRY, assertDesignSystemActivation)
})

test('standalone integration activation preserves the app-level example override contracts', () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-integration-entry-'))
  const modulesPath = path.join(targetRoot, 'modules.ts')
  fs.writeFileSync(modulesPath, 'const enabledModules: ModuleEntry[] = [\n]\n')

  try {
    enableModuleEntry(modulesPath, EXAMPLE_INTEGRATION_ACTIVATION_ENTRY)
    const source = fs.readFileSync(modulesPath, 'utf8')
    assert.match(source, /features: \{ 'example\.manage': null \}/)
    assert.match(source, /groupOrder: \['example\.nav\.group'\]/)
    assert.match(source, /'GET \/api\/example\/override-probe'/)
    assert.match(source, /source: 'modules\.ts override'/)
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true })
  }
})
