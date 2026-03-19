import { run } from '../mercato'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecSync = jest.fn()
const mockKill = jest.fn()
const mockOn = jest.fn()
const mockSpawn = jest.fn(() => ({
  kill: mockKill,
  on: mockOn,
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
}))

jest.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

const mockPgQuery = jest.fn()
const mockPgConnect = jest.fn()
const mockPgEnd = jest.fn()

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockPgConnect,
    query: mockPgQuery,
    end: mockPgEnd,
  })),
}))

jest.mock('net', () => ({
  createServer: jest.fn(() => ({
    listen: jest.fn((_port: number, cb: () => void) => cb()),
    address: jest.fn(() => ({ port: 4567 })),
    close: jest.fn((cb: () => void) => cb()),
  })),
}))

jest.mock('../lib/resolver', () => ({
  createResolver: () => ({
    getAppDir: () => '/tmp/test-app',
    isMonorepo: () => false,
    getRootDir: () => '/tmp/test-app',
  }),
}))

// Mock ensureEnvLoaded (it tries to load .env files)
jest.mock('dotenv', () => ({ config: jest.fn() }))

// Suppress console output during tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation()
  jest.spyOn(console, 'error').mockImplementation()
  mockExecSync.mockReset()
  mockSpawn.mockClear()
  mockKill.mockReset()
  mockOn.mockReset()
  mockPgQuery.mockReset()
  mockPgConnect.mockReset()
  mockPgEnd.mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
  delete (global as any).fetch
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function argv(...args: string[]) {
  return ['node', 'mercato', ...args]
}

/** Simulate the app process exiting immediately on SIGTERM */
function simulateAppExit() {
  mockOn.mockImplementation((event: string, cb: () => void) => {
    if (event === 'exit') setTimeout(cb, 0)
  })
}

/** Make waitForReady succeed by mocking global fetch */
function mockFetchReady() {
  global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as any
}

/** Make waitForReady fail fast — return 500 (server error, excluded by our fix) then stop */
function mockFetchUnready() {
  global.fetch = jest.fn().mockResolvedValue({ status: 500 }) as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mercato test command', () => {
  describe('I1: database name validation', () => {
    it('rejects DATABASE_URL with unsafe characters in database name', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db"injection'

      const exitCode = await run(argv('test'))

      expect(exitCode).toBe(1)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('unsafe characters'),
      )
      // Should NOT attempt to create the database
      expect(mockPgQuery).not.toHaveBeenCalled()

      delete process.env.DATABASE_URL
    })

    it('accepts DATABASE_URL with safe characters', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/my_app_db'
      mockFetchReady()
      simulateAppExit()

      await run(argv('test'))

      // Should have called CREATE DATABASE
      expect(mockPgQuery).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE DATABASE "my_app_db_test_\d+"/),
      )

      delete process.env.DATABASE_URL
    })

    it('accepts DATABASE_URL with hyphens in database name', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/b2b-prm-example'
      mockFetchReady()
      simulateAppExit()

      await run(argv('test'))

      expect(mockPgQuery).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE DATABASE "b2b-prm-example_test_\d+"/),
      )

      delete process.env.DATABASE_URL
    })
  })

  describe('argument parsing', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb'
      mockFetchReady()
      simulateAppExit()
    })

    afterEach(() => {
      delete process.env.DATABASE_URL
    })

    it('passes file filter to Playwright', async () => {
      await run(argv('test', 'TC-PRM-001'))

      const playwrightCall = mockExecSync.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('playwright'),
      )
      expect(playwrightCall).toBeDefined()
      expect(playwrightCall![0]).toContain('TC-PRM-001')
    })

    it('runs all tests when no file filter provided', async () => {
      await run(argv('test'))

      const playwrightCall = mockExecSync.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('playwright'),
      )
      expect(playwrightCall).toBeDefined()
      expect(playwrightCall![0]).toBe('npx playwright test')
    })

    it('keeps database when --keep flag is passed', async () => {
      await run(argv('test', '--keep'))

      // Should NOT call DROP DATABASE
      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(0)
    })

    it('drops database when --keep flag is not passed', async () => {
      await run(argv('test'))

      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(1)
    })
  })

  describe('C1/C2: cleanup guarantees', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb'
      simulateAppExit()
    })

    afterEach(() => {
      delete process.env.DATABASE_URL
    })

    it('drops ephemeral DB when migration fails', async () => {
      // Make migration throw
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('db migrate')) throw new Error('Migration failed')
      })

      const exitCode = await run(argv('test'))

      expect(exitCode).toBe(1)
      // DB should still be cleaned up despite migration failure
      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(1)
    })

    it('drops ephemeral DB when seed/init fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('init')) throw new Error('Seed failed')
      })

      const exitCode = await run(argv('test'))

      expect(exitCode).toBe(1)
      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(1)
    })

    it('drops ephemeral DB and kills app when readiness check fails', async () => {
      jest.useFakeTimers()
      mockFetchUnready()

      const runPromise = run(argv('test'))

      // Advance past the 60s readiness timeout + poll intervals
      for (let i = 0; i < 65; i++) {
        await jest.advanceTimersByTimeAsync(1000)
      }
      // Advance past the 5s SIGKILL timeout in cleanup
      await jest.advanceTimersByTimeAsync(6000)

      const exitCode = await runPromise

      jest.useRealTimers()

      expect(exitCode).toBe(1)
      // App process should be killed
      expect(mockKill).toHaveBeenCalled()
      // DB should be cleaned up
      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(1)
    })

    it('drops ephemeral DB when Playwright tests fail', async () => {
      mockFetchReady()
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('playwright')) {
          throw new Error('Tests failed')
        }
      })

      const exitCode = await run(argv('test'))

      expect(exitCode).toBe(1)
      const dropCalls = mockPgQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DROP DATABASE'),
      )
      expect(dropCalls).toHaveLength(1)
    })
  })

  describe('missing DATABASE_URL', () => {
    it('returns 1 when DATABASE_URL is not set', async () => {
      delete process.env.DATABASE_URL

      const exitCode = await run(argv('test'))

      expect(exitCode).toBe(1)
      expect(console.error).toHaveBeenCalledWith('DATABASE_URL is not set')
    })
  })
})
