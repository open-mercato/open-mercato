import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createResolver } from '../../resolver'
import {
  parseEphemeralAppOptions,
  parseIntegrationCoverageOptions,
  parseInteractiveIntegrationOptions,
  parseOptions,
  shouldUseIsolatedPortForFreshEnvironment,
  tryReuseExistingEnvironment,
  writeEphemeralEnvironmentState,
  readEphemeralEnvironmentState,
  clearEphemeralEnvironmentState,
  resolveBuildCacheTtlSeconds,
  resolveAppReadyTimeoutMs,
  resolveEphemeralPostgresImage,
  ephemeralPostgresInitSql,
  shouldReuseBuildArtifacts,
  acquireEphemeralRuntimeLock,
  waitForApplicationReadiness,
} from '../integration'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

const CACHE_TTL_ENV_VAR = 'OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS'
const APP_READY_TIMEOUT_ENV_VAR = 'OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS'
const CHECKOUT_TEST_INJECTION_FLAG = 'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED'
const PRIVATE_ATTACHMENTS_PARTITION_ENV_KEY = 'ATTACHMENTS_PARTITION_PRIVATE_ATTACHMENTS_ROOT'
const resolver = createResolver()
const projectRootDirectory = resolver.getRootDir()
const appDirectory = path.join(projectRootDirectory, 'apps', 'mercato')
const defaultPrivateAttachmentsRoot = path.join(appDirectory, 'storage', 'attachments', 'privateAttachments')

const mockHealthyReadinessFetch = (
  overrides: {
    loginPageResponse?: { status: number; text?: string }
  } = {},
) => jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
  const url = typeof input === 'string' ? input : String(input)
  if (url.endsWith('/api/auth/login')) {
    const body = typeof init?.body === 'string' ? init.body : ''
    if (body.includes('email=admin%40acme.com')) {
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ token: 'test-admin-token' }),
      } as unknown as Response
    }
    return { status: 401, ok: false, text: async () => '' } as unknown as Response
  }
  if (url.includes('/api/customers/people?pageSize=1')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
  }
  if (url.endsWith('/login')) {
    const response = overrides.loginPageResponse
    if (response) {
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        text: async () => response.text ?? '',
      } as unknown as Response
    }
    return {
      status: 200,
      ok: true,
      text: async () => '<!doctype html><script src="/_next/static/chunks/app-healthcheck.js"></script>',
    } as unknown as Response
  }
  if (url.includes('/_next/static/chunks/app-healthcheck.js')) {
    return { status: 200, ok: true, text: async () => '' } as unknown as Response
  }
  return { status: 200, ok: true, text: async () => '' } as unknown as Response
})

const resolveBuildCacheFingerprint = async (
  projectRoot: string,
  inputPath: string,
): Promise<string> => {
  const file = path.join(projectRoot, path.relative(projectRoot, inputPath))
  const stats = await stat(file)
  const relativePath = path.relative(projectRoot, file).split(path.sep).join('/')
  const source = `${relativePath}:${stats.size}:${Math.floor(stats.mtimeMs)}`
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

describe('integration cache and options', () => {
  const REUSE_ENV_TEST_TIMEOUT_MS = 60000
  const ephemeralEnvFilePath = path.join(projectRootDirectory, '.ai', 'qa', 'ephemeral-env.json')
  const ephemeralLegacyEnvFilePath = path.join(projectRootDirectory, '.ai', 'qa', 'ephemeral-env.md')
  const originalCacheTtl = process.env[CACHE_TTL_ENV_VAR]
  const originalAppReadyTimeout = process.env[APP_READY_TIMEOUT_ENV_VAR]
  const originalCheckoutTestInjectionFlag = process.env[CHECKOUT_TEST_INJECTION_FLAG]
  let originalEphemeralEnvState: string | null = null
  let originalEphemeralLegacyEnvState: string | null = null

  const restoreEphemeralStateFiles = async (originalStateText: string | null, originalLegacyStateText: string | null) => {
    await clearEphemeralEnvironmentState()
    if (originalStateText !== null) {
      await writeFile(ephemeralEnvFilePath, originalStateText, 'utf8')
    }
    if (originalLegacyStateText !== null) {
      await writeFile(ephemeralLegacyEnvFilePath, originalLegacyStateText, 'utf8')
    }
  }

  beforeEach(async () => {
    originalEphemeralEnvState = await readFile(ephemeralEnvFilePath, 'utf8').catch(() => null)
    originalEphemeralLegacyEnvState = await readFile(ephemeralLegacyEnvFilePath, 'utf8').catch(() => null)
    await clearEphemeralEnvironmentState()
  })

  afterEach(async () => {
    if (originalCacheTtl === undefined) {
      delete process.env[CACHE_TTL_ENV_VAR]
    } else {
      process.env[CACHE_TTL_ENV_VAR] = originalCacheTtl
    }
    if (originalAppReadyTimeout === undefined) {
      delete process.env[APP_READY_TIMEOUT_ENV_VAR]
    } else {
      process.env[APP_READY_TIMEOUT_ENV_VAR] = originalAppReadyTimeout
    }
    if (originalCheckoutTestInjectionFlag === undefined) {
      delete process.env[CHECKOUT_TEST_INJECTION_FLAG]
    } else {
      process.env[CHECKOUT_TEST_INJECTION_FLAG] = originalCheckoutTestInjectionFlag
    }
    await restoreEphemeralStateFiles(originalEphemeralEnvState, originalEphemeralLegacyEnvState)
  })

  it('reuses an existing reachable ephemeral environment state', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    delete process.env[CHECKOUT_TEST_INJECTION_FLAG]
    const fetchSpy = mockHealthyReadinessFetch()

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const state = await readEphemeralEnvironmentState()
      expect(state).toMatchObject({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        captureScreenshots: true,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: true,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).not.toBeNull()
      expect(environment).toMatchObject({
        baseUrl,
        port: 5001,
        ownedByCurrentProcess: false,
      })
      expect(environment?.commandEnvironment.OM_INTEGRATION_TEST).toBe('true')
      expect(environment?.commandEnvironment.DATABASE_URL).toBe(
        'postgres://integration:integration@127.0.0.1:5432/open_mercato',
      )
      expect(environment?.commandEnvironment.QUEUE_BASE_DIR).toBe('/tmp/open-mercato-queue')
      expect(environment?.commandEnvironment[PRIVATE_ATTACHMENTS_PARTITION_ENV_KEY]).toBe(defaultPrivateAttachmentsRoot)
      expect(environment?.commandEnvironment.PW_CAPTURE_SCREENSHOTS).toBe('1')
      expect(environment?.commandEnvironment.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('reuses an existing environment with checkout wrapper injections only when explicitly enabled', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    process.env[CHECKOUT_TEST_INJECTION_FLAG] = 'true'
    const fetchSpy = mockHealthyReadinessFetch()

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: true,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).not.toBeNull()
      expect(environment?.commandEnvironment.OM_INTEGRATION_TEST).toBe('true')
      expect(environment?.commandEnvironment.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED).toBe('true')
    } finally {
      fetchSpy.mockRestore()
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('reuses app-local private attachment storage when queue state points at an app root', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const appRoot = await mkdtemp(path.join(os.tmpdir(), 'om-integration-app-root-'))
    const queueBaseDir = path.join(appRoot, '.mercato', 'queue')
    const fetchSpy = mockHealthyReadinessFetch()

    try {
      await mkdir(path.join(appRoot, 'src'), { recursive: true })
      await writeFile(path.join(appRoot, 'package.json'), '{"name":"integration-test-app"}\n', 'utf8')
      await writeFile(path.join(appRoot, 'src', 'modules.ts'), 'export const enabledModules = []\n', 'utf8')

      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir,
        logPrefix: 'integration',
        captureScreenshots: false,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: false,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).not.toBeNull()
      expect(environment?.commandEnvironment[PRIVATE_ATTACHMENTS_PARTITION_ENV_KEY]).toBe(
        path.join(appRoot, 'storage', 'attachments', 'privateAttachments'),
      )
    } finally {
      fetchSpy.mockRestore()
      await rm(appRoot, { recursive: true, force: true })
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('reuses an existing environment when /login returns a redirect status other than 302', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = mockHealthyReadinessFetch({
      loginPageResponse: { status: 308, text: '' },
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: true,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).not.toBeNull()
      expect(environment).toMatchObject({
        baseUrl,
        port: 5001,
        ownedByCurrentProcess: false,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('reuses an existing environment when /login returns healthy HTML without static asset references', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = mockHealthyReadinessFetch({
      loginPageResponse: {
        status: 200,
        text: '<!doctype html><html><body><form data-auth-ready="0"></form></body></html>',
      },
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: false,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: false,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).not.toBeNull()
      expect(environment).toMatchObject({
        baseUrl,
        port: 5001,
        ownedByCurrentProcess: false,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('falls back to rebuilding when the ephemeral environment state is unreachable', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as unknown as Response)

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: false,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: false,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment).toBeNull()

      const remainingState = await readEphemeralEnvironmentState()
      expect(remainingState).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('does not reuse an existing ephemeral environment when source requirement does not match', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as unknown as Response)

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: true,
        logPrefix: 'coverage',
        forceRebuild: false,
        requiredExistingSource: 'coverage',
      })

      expect(environment).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('parses --force-rebuild and --no-reuse-env for integration test commands', () => {
    expect(parseOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
    expect(parseOptions(['--no-reuse-env'])).toMatchObject({ reuseExisting: false })
    expect(parseEphemeralAppOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
    expect(parseEphemeralAppOptions(['--no-reuse-env'])).toMatchObject({ reuseExisting: false })
    expect(parseInteractiveIntegrationOptions(['--no-reuse-env'])).toMatchObject({ reuseExisting: false })
    expect(parseIntegrationCoverageOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
    expect(parseIntegrationCoverageOptions(['--no-reuse-env'])).toMatchObject({ reuseExisting: false })
  })

  it('uses isolated port for fresh environment when reuse is disabled or stale state exists', () => {
    const existingState = {
      status: 'running' as const,
      baseUrl: 'http://127.0.0.1:5001',
      port: 5001,
      source: 'integration',
      captureScreenshots: true,
      startedAt: new Date().toISOString(),
    }

    expect(
      shouldUseIsolatedPortForFreshEnvironment({
        reuseExisting: false,
        existingStateBeforeReuseAttempt: null,
      }),
    ).toBe(true)

    expect(
      shouldUseIsolatedPortForFreshEnvironment({
        reuseExisting: true,
        existingStateBeforeReuseAttempt: existingState,
      }),
    ).toBe(true)

    expect(
      shouldUseIsolatedPortForFreshEnvironment({
        reuseExisting: true,
        existingStateBeforeReuseAttempt: null,
      }),
    ).toBe(false)
  })

  it('resolves build cache TTL from env variable', () => {
    delete process.env[CACHE_TTL_ENV_VAR]
    expect(resolveBuildCacheTtlSeconds('integration')).toBe(600)

    process.env[CACHE_TTL_ENV_VAR] = '180'
    expect(resolveBuildCacheTtlSeconds('integration')).toBe(180)

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env[CACHE_TTL_ENV_VAR] = 'invalid'
    expect(resolveBuildCacheTtlSeconds('integration')).toBe(600)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid'))
    warn.mockRestore()
  })

  it('resolves app readiness timeout from env variable', () => {
    delete process.env[APP_READY_TIMEOUT_ENV_VAR]
    expect(resolveAppReadyTimeoutMs('integration')).toBe(90_000)

    process.env[APP_READY_TIMEOUT_ENV_VAR] = '180'
    expect(resolveAppReadyTimeoutMs('integration')).toBe(180_000)

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env[APP_READY_TIMEOUT_ENV_VAR] = '0'
    expect(resolveAppReadyTimeoutMs('integration')).toBe(90_000)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid'))
    warn.mockRestore()
  })

  it('defaults the ephemeral Postgres image to a pgvector-enabled build', () => {
    expect(resolveEphemeralPostgresImage({})).toBe('pgvector/pgvector:pg16')
    expect(resolveEphemeralPostgresImage({ OM_INTEGRATION_POSTGRES_IMAGE: '   ' })).toBe(
      'pgvector/pgvector:pg16',
    )
  })

  it('honors an OM_INTEGRATION_POSTGRES_IMAGE override for the ephemeral Postgres image', () => {
    expect(
      resolveEphemeralPostgresImage({ OM_INTEGRATION_POSTGRES_IMAGE: 'pgvector/pgvector:pg17' }),
    ).toBe('pgvector/pgvector:pg17')
  })

  it('creates the vector and pgcrypto extensions in the ephemeral init SQL', () => {
    const sql = ephemeralPostgresInitSql()
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector')
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    // Extensions are also seeded into template1 so future databases inherit them.
    expect(sql).toContain('\\connect template1')
  })

  it('reuses build artifacts only with matching source fingerprint and fresh cache state', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-int-cache-test-'))
    try {
      const sourceDir = path.join(tempRoot, 'src')
      const sourceFile = path.join(sourceDir, 'index.ts')
      const artifactPath = path.join(tempRoot, 'artifact.txt')
      const cacheStatePath = path.join(tempRoot, 'cache.json')

      await mkdir(sourceDir, { recursive: true })
      await writeFile(sourceFile, 'const value = 1')
      await writeFile(artifactPath, 'artifact output')

      const initialFingerprint = await resolveBuildCacheFingerprint(tempRoot, sourceFile)
      await writeFile(
        cacheStatePath,
        `${JSON.stringify({
          version: 2,
          builtAt: Date.now(),
          sourceFingerprint: initialFingerprint,
          environmentFingerprint: 'enterprise=off',
          artifactPaths: [artifactPath],
          projectRoot: tempRoot,
        }, null, 2)}\n`,
        'utf8',
      )

      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          environmentFingerprint: 'enterprise=off',
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(true)

      await rm(sourceFile, { force: true })
      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          environmentFingerprint: 'enterprise=off',
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)

      await writeFile(sourceFile, 'const value = 1')
      await writeFile(sourceFile, 'const value = 2')
      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          environmentFingerprint: 'enterprise=off',
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)

      await writeFile(sourceFile, 'const value = 1')
      const refreshedFingerprint = await resolveBuildCacheFingerprint(tempRoot, sourceFile)
      await writeFile(
        cacheStatePath,
        `${JSON.stringify({
          version: 2,
          builtAt: Date.now() - 240_000,
          sourceFingerprint: refreshedFingerprint,
          environmentFingerprint: 'enterprise=off',
          artifactPaths: [artifactPath],
          projectRoot: tempRoot,
        }, null, 2)}\n`,
        'utf8',
      )
      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          environmentFingerprint: 'enterprise=off',
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)

      await writeFile(
        cacheStatePath,
        `${JSON.stringify({
          version: 2,
          builtAt: Date.now(),
          sourceFingerprint: refreshedFingerprint,
          environmentFingerprint: 'enterprise=off',
          artifactPaths: [artifactPath],
          projectRoot: tempRoot,
        }, null, 2)}\n`,
        'utf8',
      )
      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          environmentFingerprint: 'enterprise=on',
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('prevents a second owned ephemeral run from acquiring the workspace runtime lock', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-int-runtime-lock-'))
    const lockPath = path.join(tempRoot, 'ephemeral-runtime.lock')

    try {
      const firstLock = await acquireEphemeralRuntimeLock('integration', {
        lockPath,
      })

      await expect(
        acquireEphemeralRuntimeLock('ephemeral', {
          lockPath,
        }),
      ).rejects.toThrow(/Another ephemeral environment is already active/)

      await firstLock.release()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('clears stale runtime locks owned by exited processes before reacquiring them', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'om-int-runtime-stale-'))
    const lockPath = path.join(tempRoot, 'ephemeral-runtime.lock')
    const warn = jest.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await mkdir(lockPath, { recursive: true })
      await writeFile(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: 999_999, source: 'integration', acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      )

      const lock = await acquireEphemeralRuntimeLock('integration', {
        lockPath,
        isProcessRunning: () => false,
      })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Removed stale ephemeral runtime lock'))
      await lock.release()
    } finally {
      warn.mockRestore()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})

describe('waitForApplicationReadiness', () => {
  const makeFakeProcess = (): ChildProcess => new EventEmitter() as unknown as ChildProcess
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  it('serializes probe cycles so slow probes never pile up concurrent login attempts', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let loginPageCycles = 0

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        // Each probe fetch is slower than the retry interval; the old race-against-a-tick loop
        // would launch overlapping cycles here and blow past 3 concurrent in-flight requests.
        await sleep(40)
        const isLoginPage = url.endsWith('/login') && !url.endsWith('/api/auth/login')
        if (isLoginPage) {
          loginPageCycles += 1
          if (loginPageCycles <= 2) {
            return { status: 503, ok: false, text: async () => '' } as unknown as Response
          }
          return {
            status: 200,
            ok: true,
            text: async () => '<!doctype html><script src="/_next/static/chunks/app.js"></script>',
          } as unknown as Response
        }
        if (url.endsWith('/api/auth/login')) {
          return { status: 200, ok: true, text: async () => JSON.stringify({ token: 'token' }) } as unknown as Response
        }
        if (url.includes('/api/customers/people')) {
          return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
        }
        return { status: 200, ok: true, text: async () => '' } as unknown as Response
      } finally {
        inFlight -= 1
      }
    })

    try {
      await waitForApplicationReadiness('http://127.0.0.1:5001', makeFakeProcess(), {
        timeoutMs: 5_000,
        intervalMs: 5,
        stabilizationMs: 10,
      })
      // One cycle issues exactly three parallel probe fetches (login page, backend login,
      // authenticated login). Serialized cycles keep the peak at three; overlap would exceed it.
      expect(maxInFlight).toBeLessThanOrEqual(3)
      expect(loginPageCycles).toBeGreaterThanOrEqual(3)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('fails fast when the application process exits before becoming ready', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      await sleep(20)
      return { status: 503, ok: false, text: async () => '' } as unknown as Response
    })
    const fakeProcess = makeFakeProcess()

    try {
      const readiness = waitForApplicationReadiness('http://127.0.0.1:5001', fakeProcess, {
        timeoutMs: 5_000,
        intervalMs: 5,
      })
      setTimeout(() => fakeProcess.emit('exit', 1), 30)
      await expect(readiness).rejects.toThrow(/exited before readiness check \(exit 1\)/)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
