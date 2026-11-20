import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listAppOwnedIntegrationSpecCandidates,
  listPlaywrightConfigSelectedSpecPaths,
  listPlaywrightSelectedSpecPaths,
  resolveAppOnlySuiteRun,
} from '../integration'
import type { PlaywrightListTarget } from '../integration'

const RUNTIME_REGISTERED_SPEC = 'src/modules/orders/__integration__/TC-APP-001.spec.ts'
const RUNTIME_IMPORTED_SPEC = 'src/modules/orders/__integration__/TC-APP-002.spec.ts'
const CONFIG_PATH = '.ai/qa/tests/playwright.config.ts'
const CUSTOM_CONFIG_PATH = '.ai/qa/tests/custom.config.ts'
const REPOSITORY_NODE_MODULES = path.resolve(path.dirname(require.resolve('@playwright/test/package.json')), '..', '..')
const DISCOVERY_MODULE_PATH = path.resolve(__dirname, '..', 'integration-discovery.ts')
const RUNTIME_BASE_URL = 'http://127.0.0.1:5001'

function withoutJestEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('JEST_')))
}

function writeProjectFile(projectRoot: string, relativePath: string, contents: string): void {
  const absolutePath = path.join(projectRoot, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents)
}

function createStandaloneProject(): string {
  const projectRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'om-app-only-')))
  symlinkSync(REPOSITORY_NODE_MODULES, path.join(projectRoot, 'node_modules'), 'dir')
  writeProjectFile(projectRoot, 'package.json', JSON.stringify({ name: 'app-only-fixture', private: true }))
  writeProjectFile(
    projectRoot,
    CONFIG_PATH,
    [
      "import { defineConfig } from '@playwright/test'",
      "import path from 'node:path'",
      `import { discoverIntegrationSpecFiles } from ${JSON.stringify(DISCOVERY_MODULE_PATH)}`,
      "const projectRoot = path.resolve(__dirname, '..', '..', '..')",
      "const legacyRoot = path.join(projectRoot, '.ai', 'qa', 'tests', '__legacy_disabled__')",
      'const specPaths = discoverIntegrationSpecFiles(projectRoot, legacyRoot).map((entry) => entry.path)',
      'export default defineConfig({',
      '  testDir: projectRoot,',
      "  testMatch: specPaths.length > 0 ? specPaths : ['.ai/qa/tests/__no_tests__/*.spec.ts'],",
      "  testIgnore: [`${projectRoot}/node_modules/**`],",
      '})',
      '',
    ].join('\n'),
  )
  writeProjectFile(
    projectRoot,
    CUSTOM_CONFIG_PATH,
    [
      "import { defineConfig } from '@playwright/test'",
      "import path from 'node:path'",
      "const projectRoot = path.resolve(__dirname, '..', '..', '..')",
      "export default defineConfig({ testDir: path.join(projectRoot, 'src'), testMatch: ['**/__integration__/*.spec.ts'] })",
      '',
    ].join('\n'),
  )
  writeProjectFile(
    projectRoot,
    RUNTIME_REGISTERED_SPEC,
    [
      "import { test } from '@playwright/test'",
      'if (process.env.BASE_URL) {',
      "  test('registers only once the runtime supplies BASE_URL', async () => {})",
      '}',
      '',
    ].join('\n'),
  )
  writeProjectFile(
    projectRoot,
    RUNTIME_IMPORTED_SPEC,
    [
      "import { test } from '@playwright/test'",
      "if (!process.env.BASE_URL) throw new Error('BASE_URL is required while this spec module loads')",
      "test('imports only once the runtime supplies BASE_URL', async () => {})",
      '',
    ].join('\n'),
  )
  return projectRoot
}

describe('test:integration --app-only against a real Playwright config', () => {
  const originalBaseUrl = process.env.BASE_URL
  let projectRoot: string
  let target: PlaywrightListTarget
  const listRegisteredTests = (environment: NodeJS.ProcessEnv, fileFilters: readonly string[]) =>
    listPlaywrightSelectedSpecPaths(withoutJestEnvironment(environment), fileFilters, target)
  const listConfigSelection = (environment: NodeJS.ProcessEnv) =>
    listPlaywrightConfigSelectedSpecPaths(withoutJestEnvironment(environment), target)

  beforeAll(() => {
    delete process.env.BASE_URL
    projectRoot = createStandaloneProject()
    target = { projectRoot, configPath: CONFIG_PATH }
  })

  afterAll(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.BASE_URL
    } else {
      process.env.BASE_URL = originalBaseUrl
    }
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('cannot import the specs before the runtime supplies BASE_URL', async () => {
    await expect(listRegisteredTests({ ...process.env }, [])).rejects.toThrow('BASE_URL is required')
  }, 60_000)

  it('resolves both runtime-dependent specs from the config file selection without importing them', async () => {
    const candidates = await listAppOwnedIntegrationSpecCandidates(listConfigSelection)
    expect(candidates).toEqual([{ path: RUNTIME_REGISTERED_SPEC }, { path: RUNTIME_IMPORTED_SPEC }])
  }, 60_000)

  it('collects both specs once the runtime environment supplies BASE_URL', async () => {
    const run = await resolveAppOnlySuiteRun(
      [RUNTIME_REGISTERED_SPEC, RUNTIME_IMPORTED_SPEC],
      { commandEnvironment: { ...process.env, BASE_URL: RUNTIME_BASE_URL } },
      listRegisteredTests,
    )
    expect(run?.fileFilters).toHaveLength(2)
    expect(run?.commandEnvironment.BASE_URL).toBe(RUNTIME_BASE_URL)
  }, 60_000)

  it('reports no selection for a custom config that does not use discovery, deferring to the runtime list', async () => {
    const customTarget = { projectRoot, configPath: CUSTOM_CONFIG_PATH }
    await expect(
      listPlaywrightConfigSelectedSpecPaths(withoutJestEnvironment({ ...process.env }), customTarget),
    ).resolves.toBeNull()
    const run = await resolveAppOnlySuiteRun(
      null,
      { commandEnvironment: { ...process.env, BASE_URL: RUNTIME_BASE_URL } },
      (environment, fileFilters) =>
        listPlaywrightSelectedSpecPaths(withoutJestEnvironment(environment), fileFilters, customTarget),
    )
    expect(run?.fileFilters).toHaveLength(2)
  }, 60_000)
})
