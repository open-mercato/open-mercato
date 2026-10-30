import {
  INTEGRATION_TEST_USAGE,
  NO_APP_OWNED_INTEGRATION_SPECS_MESSAGE,
  buildAppOnlyPlaywrightFileFilters,
  parseOptions,
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
