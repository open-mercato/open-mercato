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

const RUNTIME_ONLY_SPEC = 'src/modules/orders/__integration__/TC-APP-001.spec.ts'
const CONFIG_PATH = '.ai/qa/tests/playwright.config.ts'
const REPOSITORY_NODE_MODULES = path.resolve(path.dirname(require.resolve('@playwright/test/package.json')), '..', '..')
const DISCOVERY_MODULE_PATH = path.resolve(__dirname, '..', 'integration-discovery.ts')

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
    RUNTIME_ONLY_SPEC,
    [
      "import { test } from '@playwright/test'",
      'if (process.env.BASE_URL) {',
      "  test('runs only once the runtime supplies BASE_URL', async () => {})",
      '}',
      '',
    ].join('\n'),
  )
  return projectRoot
}

describe('test:integration --app-only against a real Playwright config', () => {
  const originalBaseUrl = process.env.BASE_URL
  let projectRoot: string
  let target: PlaywrightListTarget
  const listRegisteredTests = (environment: NodeJS.ProcessEnv) =>
    listPlaywrightSelectedSpecPaths(withoutJestEnvironment(environment), target)
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

  it('registers no test for the lone spec before the runtime supplies BASE_URL', async () => {
    await expect(listRegisteredTests({ ...process.env })).resolves.toEqual([])
  }, 60_000)

  it('keeps the lone runtime-dependent spec as an early-exit candidate from the config file selection', async () => {
    const candidates = await listAppOwnedIntegrationSpecCandidates(listConfigSelection)
    expect(candidates).toEqual([{ path: RUNTIME_ONLY_SPEC }])
  }, 60_000)

  it('collects the spec once the runtime environment supplies BASE_URL', async () => {
    const run = await resolveAppOnlySuiteRun(
      [RUNTIME_ONLY_SPEC],
      { commandEnvironment: { ...process.env, BASE_URL: 'http://127.0.0.1:5001' } },
      listRegisteredTests,
    )
    expect(run?.fileFilters).toHaveLength(1)
    expect(run?.commandEnvironment.BASE_URL).toBe('http://127.0.0.1:5001')
  }, 60_000)
})
