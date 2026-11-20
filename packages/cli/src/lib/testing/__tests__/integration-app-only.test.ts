import {
  INTEGRATION_TEST_USAGE,
  NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE,
  buildAppOnlyPlaywrightFileFilters,
  listAppOwnedIntegrationSpecCandidates,
  parseOptions,
  parsePlaywrightListedSpecPaths,
  resolveAppOnlySuiteRun,
  resolveAppOwnedIntegrationSpecPaths,
  runIntegrationTestsInEphemeralEnvironment,
} from '../integration'
import type { EphemeralEnvironmentHandle, IntegrationTestRunDependencies } from '../integration'

type RunSuiteWithRecovery = NonNullable<IntegrationTestRunDependencies['runSuiteWithRecovery']>

const APP_SPEC = 'src/modules/orders/__integration__/TC-APP-001.spec.ts'
const SECOND_APP_SPEC = 'src/modules/orders/__integration__/admin/TC-APP-002.spec.ts'
const PLATFORM_SPEC = 'node_modules/@open-mercato/webhooks/src/modules/webhooks/__integration__/TC-WH-001.spec.ts'

function createRunSuiteMock() {
  const stop = jest.fn(async () => {})
  const environment = {
    baseUrl: 'http://127.0.0.1:5001',
    port: 5001,
    databaseUrl: 'postgres://localhost/test',
    commandEnvironment: { PW_CAPTURE_SCREENSHOTS: '0' },
    ownedByCurrentProcess: true,
    stop,
  } satisfies EphemeralEnvironmentHandle
  const runSuite = jest.fn<ReturnType<RunSuiteWithRecovery>, Parameters<RunSuiteWithRecovery>>(async () => ({
    environment,
    testRunResult: { retried: false, error: null },
  }))
  return { runSuite, stop }
}

describe('mercato test:integration --app-only', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  describe('parseOptions', () => {
    it('leaves app-only and help disabled by default', () => {
      expect(parseOptions([])).toMatchObject({ appOnly: false, help: false, filter: null })
      expect(parseOptions(['customers'])).toMatchObject({ appOnly: false, filter: 'customers' })
    })

    it('parses --app-only alongside a filter in any position', () => {
      expect(parseOptions(['--app-only'])).toMatchObject({ appOnly: true, filter: null })
      expect(parseOptions(['--app-only', 'orders'])).toMatchObject({ appOnly: true, filter: 'orders' })
      expect(parseOptions(['--filter', 'orders', '--app-only', '--no-reuse-env'])).toMatchObject({
        appOnly: true,
        filter: 'orders',
        reuseExisting: false,
      })
    })

    it('parses --help and -h', () => {
      expect(parseOptions(['--help'])).toMatchObject({ help: true })
      expect(parseOptions(['-h'])).toMatchObject({ help: true, filter: null })
    })

    it('still rejects unknown options', () => {
      expect(() => parseOptions(['--app-only=true'])).toThrow('Unknown option: --app-only=true')
    })
  })

  describe('resolveAppOwnedIntegrationSpecPaths', () => {
    it('drops specs installed under node_modules', () => {
      expect(
        resolveAppOwnedIntegrationSpecPaths([{ path: APP_SPEC }, { path: PLATFORM_SPEC }, { path: SECOND_APP_SPEC }], null),
      ).toEqual([APP_SPEC, SECOND_APP_SPEC])
    })

    it('returns an empty list when only platform specs are discovered', () => {
      expect(resolveAppOwnedIntegrationSpecPaths([{ path: PLATFORM_SPEC }], null)).toEqual([])
      expect(resolveAppOwnedIntegrationSpecPaths([], 'orders')).toEqual([])
    })

    it('narrows app-owned specs by a case-insensitive filter', () => {
      expect(resolveAppOwnedIntegrationSpecPaths([{ path: APP_SPEC }, { path: SECOND_APP_SPEC }], 'admin/')).toEqual([
        SECOND_APP_SPEC,
      ])
      expect(resolveAppOwnedIntegrationSpecPaths([{ path: APP_SPEC }, { path: PLATFORM_SPEC }], 'tc-app')).toEqual([APP_SPEC])
    })

    it('fails loudly when a filter matches none of the existing app-owned specs', () => {
      expect(() => resolveAppOwnedIntegrationSpecPaths([{ path: APP_SPEC }, { path: PLATFORM_SPEC }], 'webhooks')).toThrow(
        'No app-owned integration specs match filter "webhooks"',
      )
    })
  })

  describe('parsePlaywrightListedSpecPaths', () => {
    it('returns the listed spec files relative to the project root', () => {
      const report = {
        config: { rootDir: '/repo' },
        suites: [
          { file: SECOND_APP_SPEC, specs: [] },
          { file: APP_SPEC, specs: [] },
          { file: APP_SPEC, specs: [] },
          { title: 'no file' },
        ],
      }
      expect(parsePlaywrightListedSpecPaths(report, '/repo')).toEqual([SECOND_APP_SPEC, APP_SPEC])
    })

    it('reads the file list from a report shaped like real Playwright 1.62 --list output', () => {
      const report = {
        config: { configFile: '/repo/.ai/qa/tests/playwright.config.ts', rootDir: '/repo' },
        suites: [
          {
            title: APP_SPEC,
            file: APP_SPEC,
            column: 0,
            line: 0,
            specs: [],
            suites: [
              {
                title: 'TC-APP-001: orders',
                file: APP_SPEC,
                line: 4,
                column: 6,
                specs: [
                  {
                    title: 'creates an order',
                    ok: true,
                    tags: [],
                    tests: [{ timeout: 20000, annotations: [], expectedStatus: 'passed', projectId: '', projectName: '', results: [], status: 'skipped' }],
                    id: 'a623f8b76ba3e0f24645-22392273f45316c64329',
                    file: APP_SPEC,
                    line: 5,
                    column: 3,
                  },
                ],
              },
            ],
          },
        ],
        errors: [],
        stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
      }
      expect(parsePlaywrightListedSpecPaths(report, '/repo')).toEqual([APP_SPEC])
    })

    it('resolves files against the report rootDir when it differs from the project root', () => {
      const report = { config: { rootDir: '/repo/src' }, suites: [{ file: 'modules/orders/__integration__/TC-APP-001.spec.ts' }] }
      expect(parsePlaywrightListedSpecPaths(report, '/repo')).toEqual([APP_SPEC])
    })

    it('rejects output that is not a Playwright report', () => {
      expect(() => parsePlaywrightListedSpecPaths({ errors: [] }, '/repo')).toThrow('Playwright --list report has no suites')
    })
  })

  describe('listAppOwnedIntegrationSpecCandidates', () => {
    it('asks the Playwright config for app-only specs with metadata filters skipped', async () => {
      const listSpecs = jest.fn(async () => [APP_SPEC])

      await expect(listAppOwnedIntegrationSpecCandidates(listSpecs)).resolves.toEqual([{ path: APP_SPEC }])

      expect(listSpecs).toHaveBeenCalledTimes(1)
      expect(listSpecs.mock.calls[0][0]).toMatchObject({
        OM_INTEGRATION_APP_ONLY: '1',
        OM_INTEGRATION_SKIP_METADATA_FILTERS: '1',
      })
    })
  })

  describe('listAppOwnedIntegrationSpecCandidates without a config report', () => {
    it('returns null so the empty-suite decision waits for the runtime', async () => {
      await expect(listAppOwnedIntegrationSpecCandidates(async () => null)).resolves.toBeNull()
    })
  })

  describe('resolveAppOnlySuiteRun', () => {
    const listSpecsNeedingBaseUrl = jest.fn(async (environment: NodeJS.ProcessEnv) =>
      environment.BASE_URL ? [APP_SPEC] : [],
    )

    beforeEach(() => {
      listSpecsNeedingBaseUrl.mockClear()
    })

    it('runs a lone spec that requires a variable the runtime environment provides', async () => {
      const run = await resolveAppOnlySuiteRun(
        [APP_SPEC],
        { commandEnvironment: { BASE_URL: 'http://127.0.0.1:5001' } },
        listSpecsNeedingBaseUrl,
      )

      expect(run).toEqual({
        fileFilters: buildAppOnlyPlaywrightFileFilters([APP_SPEC]),
        commandEnvironment: { BASE_URL: 'http://127.0.0.1:5001', OM_INTEGRATION_APP_ONLY: '1' },
      })
      expect(listSpecsNeedingBaseUrl.mock.calls[0][0]).not.toHaveProperty('OM_INTEGRATION_SKIP_METADATA_FILTERS')
    })

    it('returns null when the runtime environment still skips every app spec', async () => {
      await expect(resolveAppOnlySuiteRun([APP_SPEC], { commandEnvironment: {} }, listSpecsNeedingBaseUrl)).resolves.toBeNull()
    })

    it('lists only the preflight spec files so excluded specs are never imported', async () => {
      const listSpecs = jest.fn(async () => [APP_SPEC])
      await resolveAppOnlySuiteRun([APP_SPEC], { commandEnvironment: {} }, listSpecs)
      expect(listSpecs.mock.calls[0][1]).toEqual(buildAppOnlyPlaywrightFileFilters([APP_SPEC]))
    })

    it('resolves app-owned specs from the runtime list when the config reported no selection', async () => {
      const listSpecs = jest.fn(async () => [PLATFORM_SPEC, APP_SPEC, SECOND_APP_SPEC])
      const run = await resolveAppOnlySuiteRun(null, { commandEnvironment: {} }, listSpecs, 'admin')
      expect(listSpecs.mock.calls[0][1]).toEqual([])
      expect(run?.fileFilters).toEqual(buildAppOnlyPlaywrightFileFilters([SECOND_APP_SPEC]))
    })

    it('returns null when the runtime list has no app-owned spec and the config reported no selection', async () => {
      const listSpecs = jest.fn(async () => [PLATFORM_SPEC])
      await expect(resolveAppOnlySuiteRun(null, { commandEnvironment: {} }, listSpecs)).resolves.toBeNull()
    })

    it('keeps only the preflight specs that Playwright selects', async () => {
      const listSpecs = jest.fn(async () => [SECOND_APP_SPEC, PLATFORM_SPEC])
      const run = await resolveAppOnlySuiteRun([APP_SPEC, SECOND_APP_SPEC], { commandEnvironment: {} }, listSpecs)
      expect(run?.fileFilters).toEqual(buildAppOnlyPlaywrightFileFilters([SECOND_APP_SPEC]))
    })
  })

  describe('buildAppOnlyPlaywrightFileFilters', () => {
    it('builds escaped, end-anchored file filters that match only the listed spec', () => {
      const [filter] = buildAppOnlyPlaywrightFileFilters(['src/modules/orders/[id]/__integration__/TC-APP-001.spec.ts'])
      const pattern = new RegExp(filter, 'gi')
      expect(pattern.test('/repo/src/modules/orders/[id]/__integration__/TC-APP-001.spec.ts')).toBe(true)
      pattern.lastIndex = 0
      expect(pattern.test('/repo/src/modules/orders/[id]/__integration__/TC-APP-001.spec.tsx')).toBe(false)
      pattern.lastIndex = 0
      expect(pattern.test('/repo/xsrc/modules/orders/[id]/__integration__/TC-APP-001.spec.ts')).toBe(false)
    })
  })

  describe('runIntegrationTestsInEphemeralEnvironment', () => {
    it('exits cleanly before starting any environment when the app owns no specs', async () => {
      const { runSuite } = createRunSuiteMock()
      const discoverSpecs = jest.fn(async () => [{ path: PLATFORM_SPEC }])

      await expect(
        runIntegrationTestsInEphemeralEnvironment(['--app-only'], { discoverSpecs, runSuiteWithRecovery: runSuite }),
      ).resolves.toBeUndefined()

      expect(discoverSpecs).toHaveBeenCalledTimes(1)
      expect(runSuite).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE)
      expect(NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE).toBe('No app-owned integration specs found')
    })

    it('passes only the app-owned spec list to the suite run', async () => {
      const { runSuite, stop } = createRunSuiteMock()
      const discoverSpecs = jest.fn(async () => [{ path: PLATFORM_SPEC }, { path: APP_SPEC }])

      await runIntegrationTestsInEphemeralEnvironment(['--app-only'], { discoverSpecs, runSuiteWithRecovery: runSuite })

      expect(runSuite).toHaveBeenCalledTimes(1)
      expect(runSuite.mock.calls[0][1]).toMatchObject({ appOnly: true, appOnlySpecPaths: [APP_SPEC] })
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it('defers the empty-suite decision to the runtime when the config reports no selection', async () => {
      const { runSuite } = createRunSuiteMock()
      const discoverSpecs = jest.fn(async () => null)

      await runIntegrationTestsInEphemeralEnvironment(['--app-only'], { discoverSpecs, runSuiteWithRecovery: runSuite })

      expect(logSpy).not.toHaveBeenCalledWith(NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE)
      expect(runSuite).toHaveBeenCalledTimes(1)
      expect(runSuite.mock.calls[0][1]).toMatchObject({ appOnly: true, appOnlySpecPaths: null })
    })

    it('keeps the default run unchanged without the flag', async () => {
      const { runSuite } = createRunSuiteMock()
      const discoverSpecs = jest.fn(async () => [])

      await runIntegrationTestsInEphemeralEnvironment(['orders'], { discoverSpecs, runSuiteWithRecovery: runSuite })

      expect(discoverSpecs).not.toHaveBeenCalled()
      expect(logSpy).not.toHaveBeenCalledWith(NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE)
      expect(runSuite).toHaveBeenCalledTimes(1)
      expect(runSuite.mock.calls[0][1]).toMatchObject({ appOnly: false, filter: 'orders', appOnlySpecPaths: null })
    })

    it('prints usage that documents --app-only without starting anything', async () => {
      const { runSuite } = createRunSuiteMock()

      await runIntegrationTestsInEphemeralEnvironment(['--help'], { runSuiteWithRecovery: runSuite })

      expect(runSuite).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(INTEGRATION_TEST_USAGE)
      expect(INTEGRATION_TEST_USAGE).toContain('--app-only')
    })
  })
})
