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
  createBoundedOutputBuffer,
  formatCapturedOutput,
  CAPTURED_OUTPUT_MAX_LENGTH,
  killProcessTree,
  terminateProcessTree,
  registerEphemeralShutdownHandlers,
  buildPlaywrightSelectionEnvironment,
  resolveIntegrationSpecPaths,
  selectIntegrationSpecPaths,
} from '../integration'
import type { CapturedOutputProcess, ShutdownProcessRef } from '../integration'
import { resolveSpawnCommand } from '../../spawn'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

const CACHE_TTL_ENV_VAR = 'OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS'
const APP_READY_TIMEOUT_ENV_VAR = 'OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS'
const CHECKOUT_TEST_INJECTION_FLAG = 'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED'
const PRIVATE_ATTACHMENTS_PARTITION_ENV_KEY = 'ATTACHMENTS_PARTITION_PRIVATE_ATTACHMENTS_ROOT'
const TEST_EPHEMERAL_JWT_SECRET = 'integration-test-ephemeral-jwt-secret'
const resolver = createResolver()
const projectRootDirectory = resolver.getRootDir()
const appDirectory = path.join(projectRootDirectory, 'apps', 'mercato')
const defaultPrivateAttachmentsRoot = path.join(appDirectory, 'storage', 'attachments', 'privateAttachments')

const makeSetCookieHeaders = (cookies: string[]): Headers => ({
  get: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookies.join(', ') : null),
  getSetCookie: () => cookies,
}) as unknown as Headers

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
        headers: makeSetCookieHeaders([
          'auth_token=test-auth-token; Path=/; HttpOnly; SameSite=Lax',
          'session_token=test-session-token; Path=/; HttpOnly; SameSite=Lax',
        ]),
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
  if (url.endsWith('/backend')) {
    return { status: 200, ok: true, text: async () => '' } as unknown as Response
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

  it('passes selected Playwright specs through the explicit-path environment', () => {
    const environment = buildPlaywrightSelectionEnvironment(
      { BASE_URL: 'http://127.0.0.1:3000' },
      ['packages/core/a.spec.ts', 'packages/core/b.spec.ts'],
    )

    expect(environment).toEqual({
      BASE_URL: 'http://127.0.0.1:3000',
      OM_INTEGRATION_SPEC_PATHS: [
        'packages/core/a.spec.ts',
        'packages/core/b.spec.ts',
      ].join(path.delimiter),
    })
  })

  it('resolves an integration filter to explicit spec paths', () => {
    const targets = [
      {
        path: 'packages/core/src/modules/wms/__integration__/TC-WMS-SITES-001.spec.ts',
        description: 'WMS Sites API',
      },
      {
        path: 'packages/core/src/modules/sales/__integration__/TC-SALES-001.spec.ts',
        description: 'Sales API',
      },
    ]

    expect(
      selectIntegrationSpecPaths(
        targets,
        path.join('packages', 'core', 'src', 'modules', 'wms', '__integration__'),
      ),
    ).toEqual([targets[0].path])
    expect(selectIntegrationSpecPaths(targets, 'sites api')).toEqual([
      targets[0].path,
    ])
    expect(resolveIntegrationSpecPaths(targets, 'sites api')).toEqual([
      targets[0].path,
    ])
    expect(() => resolveIntegrationSpecPaths(targets, 'missing')).toThrow(
      'No integration tests matched filter "missing".',
    )
  })

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
    const originalJwtSecret = process.env.JWT_SECRET
    const callerJwtSecret = 'change-me-dev-secret'
    delete process.env[CHECKOUT_TEST_INJECTION_FLAG]
    process.env.JWT_SECRET = callerJwtSecret
    const fetchSpy = mockHealthyReadinessFetch()

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        jwtSecret: callerJwtSecret,
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
      expect(environment?.commandEnvironment.JWT_SECRET).toBe(callerJwtSecret)
      expect(environment?.commandEnvironment.DATABASE_URL).toBe(
        'postgres://integration:integration@127.0.0.1:5432/open_mercato',
      )
      expect(environment?.commandEnvironment.QUEUE_BASE_DIR).toBe('/tmp/open-mercato-queue')
      expect(environment?.commandEnvironment[PRIVATE_ATTACHMENTS_PARTITION_ENV_KEY]).toBe(defaultPrivateAttachmentsRoot)
      expect(environment?.commandEnvironment.PW_CAPTURE_SCREENSHOTS).toBe('1')
      expect(environment?.commandEnvironment.PLATFORM_PORTAL_BASE_URL).toBe(baseUrl)
      expect(environment?.commandEnvironment.OM_TEST_EMAIL_CAPTURE_PATH).toBe(
        path.join(projectRootDirectory, '.ai', 'qa', 'email-capture.jsonl'),
      )
      expect(environment?.commandEnvironment.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
      if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET
      } else {
        process.env.JWT_SECRET = originalJwtSecret
      }
    }
  }, REUSE_ENV_TEST_TIMEOUT_MS)

  it('reuses the persisted JWT secret when a later process has no JWT_SECRET', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const originalJwtSecret = process.env.JWT_SECRET
    const fetchSpy = mockHealthyReadinessFetch()
    delete process.env.JWT_SECRET

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        databaseUrl: 'postgres://integration:integration@127.0.0.1:5432/open_mercato',
        queueBaseDir: '/tmp/open-mercato-queue',
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const environment = await tryReuseExistingEnvironment({
        verbose: false,
        captureScreenshots: true,
        logPrefix: 'integration',
        forceRebuild: false,
      })

      expect(environment?.commandEnvironment.JWT_SECRET).toBe(TEST_EPHEMERAL_JWT_SECRET)
    } finally {
      fetchSpy.mockRestore()
      if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET
      } else {
        process.env.JWT_SECRET = originalJwtSecret
      }
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
        jwtSecret: TEST_EPHEMERAL_JWT_SECRET,
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
      await writeFile(sourceFile, 'const value = 22')
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

  it('verifies backend browser navigation with cookies returned by login', async () => {
    let backendCookieHeader: string | null = null

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input)
      const body = typeof init?.body === 'string' ? init.body : ''

      if (url.endsWith('/api/auth/login')) {
        if (body.includes('email=admin%40acme.com')) {
          return {
            status: 200,
            ok: true,
            headers: makeSetCookieHeaders([
              'auth_token=secret-auth-value; Path=/; HttpOnly; SameSite=Lax',
              'session_token=secret-session-value; Path=/; HttpOnly; SameSite=Lax',
            ]),
            text: async () => JSON.stringify({ token: 'token' }),
          } as unknown as Response
        }
        return { status: 401, ok: false, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          ok: true,
          text: async () => '<!doctype html><script src="/_next/static/chunks/app.js"></script>',
        } as unknown as Response
      }
      if (url.includes('/api/customers/people')) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
      }
      if (url.endsWith('/backend')) {
        backendCookieHeader = typeof init?.headers === 'object'
          && init.headers !== null
          && !Array.isArray(init.headers)
          ? String((init.headers as Record<string, unknown>).Cookie ?? '')
          : ''
        return { status: backendCookieHeader ? 200 : 307, ok: Boolean(backendCookieHeader), text: async () => '' } as unknown as Response
      }
      return { status: 200, ok: true, text: async () => '' } as unknown as Response
    })

    try {
      await waitForApplicationReadiness('http://127.0.0.1:5001', makeFakeProcess(), {
        timeoutMs: 1_000,
        intervalMs: 5,
        stabilizationMs: 10,
      })
      expect(backendCookieHeader).toContain('auth_token=secret-auth-value')
      expect(backendCookieHeader).toContain('session_token=secret-session-value')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('reports backend auth redirect loops without leaking cookie values', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input)
      const body = typeof init?.body === 'string' ? init.body : ''

      if (url.endsWith('/api/auth/login')) {
        if (body.includes('email=admin%40acme.com')) {
          return {
            status: 200,
            ok: true,
            headers: makeSetCookieHeaders([
              'auth_token=secret-auth-value; Path=/; HttpOnly; SameSite=Lax',
              'session_token=secret-session-value; Path=/; HttpOnly; SameSite=Lax',
            ]),
            text: async () => JSON.stringify({ token: 'token' }),
          } as unknown as Response
        }
        return { status: 401, ok: false, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          ok: true,
          text: async () => '<!doctype html><script src="/_next/static/chunks/app.js"></script>',
        } as unknown as Response
      }
      if (url.includes('/api/customers/people')) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
      }
      if (url.endsWith('/backend')) {
        return {
          status: 307,
          ok: false,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'location' ? '/api/auth/session/refresh' : null),
            getSetCookie: () => [],
          },
          text: async () => '',
        } as unknown as Response
      }
      if (url.endsWith('/api/auth/session/refresh')) {
        return {
          status: 307,
          ok: false,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'location' ? '/backend' : null),
            getSetCookie: () => ['auth_token=rotated-secret-value; Path=/; HttpOnly; SameSite=Lax'],
          },
          text: async () => '',
        } as unknown as Response
      }
      return { status: 200, ok: true, text: async () => '' } as unknown as Response
    })

    try {
      let error: Error | null = null
      try {
        await waitForApplicationReadiness('http://127.0.0.1:5001', makeFakeProcess(), {
          timeoutMs: 50,
          intervalMs: 5,
          stabilizationMs: 10,
        })
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught))
      }

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/Backend browser auth probe detected redirect loop/)
      expect(error?.message).not.toMatch(/secret-(auth|session)|rotated-secret/)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('rejects unsafe backend auth redirects without following them', async () => {
    let externalRedirectFetches = 0
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input)
      const body = typeof init?.body === 'string' ? init.body : ''

      if (url.includes('evil.example')) {
        externalRedirectFetches += 1
        return { status: 200, ok: true, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/api/auth/login')) {
        if (body.includes('email=admin%40acme.com')) {
          return {
            status: 200,
            ok: true,
            headers: makeSetCookieHeaders([
              'auth_token=secret-auth-value; Path=/; HttpOnly; SameSite=Lax',
              'session_token=secret-session-value; Path=/; HttpOnly; SameSite=Lax',
            ]),
            text: async () => JSON.stringify({ token: 'token' }),
          } as unknown as Response
        }
        return { status: 401, ok: false, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          ok: true,
          text: async () => '<!doctype html><script src="/_next/static/chunks/app.js"></script>',
        } as unknown as Response
      }
      if (url.includes('/api/customers/people')) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
      }
      if (url.endsWith('/backend')) {
        return {
          status: 307,
          ok: false,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'location' ? '//evil.example/session' : null),
            getSetCookie: () => [],
          },
          text: async () => '',
        } as unknown as Response
      }
      return { status: 200, ok: true, text: async () => '' } as unknown as Response
    })

    try {
      let error: Error | null = null
      try {
        await waitForApplicationReadiness('http://127.0.0.1:5001', makeFakeProcess(), {
          timeoutMs: 50,
          intervalMs: 5,
          stabilizationMs: 10,
        })
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught))
      }

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/unsafe redirect: protocol-relative redirect/)
      expect(error?.message).not.toMatch(/secret-(auth|session)/)
      expect(externalRedirectFetches).toBe(0)
    } finally {
      fetchSpy.mockRestore()
    }
  })

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
        // would launch overlapping cycles here and blow past one cycle's concurrent requests.
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
          return {
            status: 200,
            ok: true,
            headers: makeSetCookieHeaders([
              'auth_token=test-auth-token; Path=/; HttpOnly; SameSite=Lax',
              'session_token=test-session-token; Path=/; HttpOnly; SameSite=Lax',
            ]),
            text: async () => JSON.stringify({ token: 'token' }),
          } as unknown as Response
        }
        if (url.includes('/api/customers/people')) {
          return { status: 200, ok: true, text: async () => JSON.stringify({ items: [] }) } as unknown as Response
        }
        if (url.endsWith('/backend')) {
          return { status: 200, ok: true, text: async () => '' } as unknown as Response
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
      // One cycle issues exactly four parallel probe fetches (login page, backend login,
      // authenticated API, and backend browser-cookie navigation). Serialized cycles keep the
      // peak at four; overlap would exceed it.
      expect(maxInFlight).toBeLessThanOrEqual(4)
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

  it('includes the captured stderr tail when the application process exits unexpectedly', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      await sleep(20)
      return { status: 503, ok: false, text: async () => '' } as unknown as Response
    })
    const fakeProcess = makeFakeProcess() as CapturedOutputProcess
    fakeProcess.readCapturedOutput = () => 'Error: listen EADDRINUSE: address already in use :::5001'

    try {
      const readiness = waitForApplicationReadiness('http://127.0.0.1:5001', fakeProcess, {
        timeoutMs: 5_000,
        intervalMs: 5,
      })
      setTimeout(() => fakeProcess.emit('exit', 1), 30)
      await expect(readiness).rejects.toThrow(/exited before readiness check \(exit 1\)/)
      await expect(readiness).rejects.toThrow(/EADDRINUSE/)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('createBoundedOutputBuffer', () => {
  it('keeps the most recent output and drops the oldest once the cap is exceeded', () => {
    const buffer = createBoundedOutputBuffer()
    const lineCount = 200

    for (let index = 0; index < lineCount; index += 1) {
      buffer.append(`line-${index}:${'x'.repeat(500)}\n`)
    }

    const result = buffer.read()
    expect(result).toContain('…(truncated)…')
    expect(result).toContain(`line-${lineCount - 1}:`)
    expect(result).not.toContain('line-0:')
    expect(result.length).toBeLessThanOrEqual(CAPTURED_OUTPUT_MAX_LENGTH + '…(truncated)…'.length)
  })

  it('returns the raw output untouched when it stays under the cap', () => {
    const buffer = createBoundedOutputBuffer()
    buffer.append('hello ')
    buffer.append('world')
    expect(buffer.read()).toBe('hello world')
  })
})

describe('killProcessTree', () => {
  it('kills the POSIX process group via a negated pid', () => {
    const calls: Array<[number, NodeJS.Signals]> = []
    killProcessTree(4242, 'SIGTERM', {
      platform: 'linux',
      killPosixProcessGroup: (pid, signal) => {
        calls.push([pid, signal])
      },
    })
    expect(calls).toEqual([[4242, 'SIGTERM']])
  })

  it('asks Windows for a graceful process-tree kill on SIGTERM', () => {
    const calls: Array<[number, { forced: boolean }]> = []
    killProcessTree(4242, 'SIGTERM', {
      platform: 'win32',
      killWindowsProcessTree: (pid, options) => {
        calls.push([pid, options])
      },
    })
    expect(calls).toEqual([[4242, { forced: false }]])
  })

  it('escalates to a forced Windows process-tree kill on SIGKILL', () => {
    const calls: Array<[number, { forced: boolean }]> = []
    killProcessTree(4242, 'SIGKILL', {
      platform: 'win32',
      killWindowsProcessTree: (pid, options) => {
        calls.push([pid, options])
      },
    })
    expect(calls).toEqual([[4242, { forced: true }]])
  })

  it('negates the pid when falling back to the default POSIX killer', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      killProcessTree(4242, 'SIGTERM', { platform: 'linux' })
      expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
    } finally {
      killSpy.mockRestore()
    }
  })
})

describe('terminateProcessTree', () => {
  const makeFakeProcessWithPid = (pid: number): CapturedOutputProcess => {
    const fakeProcess = new EventEmitter() as unknown as CapturedOutputProcess
    fakeProcess.pid = pid
    return fakeProcess
  }

  it('does not throw when the process already exited on its own (ESRCH)', async () => {
    const fakeProcess = makeFakeProcessWithPid(4242)
    const esrchError = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })

    await expect(
      terminateProcessTree(fakeProcess, {
        platform: 'linux',
        gracePeriodMs: 10,
        killPosixProcessGroup: () => {
          throw esrchError
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('still kills the group of a process that already reported its exit, without waiting on it', async () => {
    const fakeProcess = makeFakeProcessWithPid(4242)
    fakeProcess.exitCode = 1
    const calls: NodeJS.Signals[] = []

    const startedAt = Date.now()
    await terminateProcessTree(fakeProcess, {
      platform: 'linux',
      gracePeriodMs: 5_000,
      killPosixProcessGroup: (_pid, signal) => {
        calls.push(signal)
      },
    })

    // A reaped leader means no `'exit'` event will ever settle the wait, not that its group is
    // empty — the descendants it spawned are exactly the orphan #5333 is about.
    expect(calls).toEqual(['SIGKILL'])
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it('resolves as soon as the process exits, without burning the rest of the grace period', async () => {
    const fakeProcess = makeFakeProcessWithPid(4242)
    const calls: NodeJS.Signals[] = []

    const startedAt = Date.now()
    const termination = terminateProcessTree(fakeProcess, {
      platform: 'linux',
      gracePeriodMs: 5_000,
      killPosixProcessGroup: (_pid, signal) => {
        calls.push(signal)
      },
    })
    setTimeout(() => fakeProcess.emit('exit', 0), 10)
    await termination

    expect(calls).toEqual(['SIGTERM'])
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it('escalates to SIGKILL when the tree outlives the grace period', async () => {
    // A live pid the escalation's `isProcessRunning` guard will confirm, without signalling anything
    // real — the injected killer records instead of killing.
    const fakeProcess = makeFakeProcessWithPid(process.pid)
    const calls: NodeJS.Signals[] = []

    await terminateProcessTree(fakeProcess, {
      platform: 'linux',
      gracePeriodMs: 10,
      killPosixProcessGroup: (_pid, signal) => {
        calls.push(signal)
      },
    })

    expect(calls).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('propagates a non-ESRCH failure from the killer', async () => {
    const fakeProcess = makeFakeProcessWithPid(4242)
    const permissionError = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })

    await expect(
      terminateProcessTree(fakeProcess, {
        platform: 'linux',
        killPosixProcessGroup: () => {
          throw permissionError
        },
      }),
    ).rejects.toThrow(/EPERM/)
  })
})

describe('formatCapturedOutput', () => {
  it('keeps the stdout tail visible when stderr also captured output', () => {
    expect(formatCapturedOutput('a deprecation warning', 'the real failure')).toBe(
      '--- stderr ---\na deprecation warning\n--- stdout ---\nthe real failure',
    )
  })

  it('returns the single populated stream unlabelled', () => {
    expect(formatCapturedOutput('only stderr', '')).toBe('only stderr')
    expect(formatCapturedOutput('', 'only stdout')).toBe('only stdout')
    expect(formatCapturedOutput('', '')).toBe('')
  })
})

describe('registerEphemeralShutdownHandlers', () => {
  const makeProcessRef = () => {
    const listeners = new Map<string, Array<() => void>>()
    const raised: Array<[number, NodeJS.Signals]> = []
    const processRef: ShutdownProcessRef = {
      pid: 9999,
      once: ((event: string, handler: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler])
        return processRef
      }) as ShutdownProcessRef['once'],
      off: ((event: string, handler: () => void) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler))
        return processRef
      }) as ShutdownProcessRef['off'],
      removeAllListeners: ((event: string) => {
        listeners.delete(event)
        return processRef
      }) as ShutdownProcessRef['removeAllListeners'],
      kill: ((pid: number, signal: NodeJS.Signals) => {
        raised.push([pid, signal])
        return true
      }) as ShutdownProcessRef['kill'],
    }
    const emit = (event: string) => {
      for (const handler of [...(listeners.get(event) ?? [])]) handler()
    }
    const listenerCount = (event: string) => (listeners.get(event) ?? []).length
    return { processRef, emit, raised, listenerCount }
  }

  // The regression guard for the interrupt path: `detached: true` puts the app tree in its own
  // session, so unless the runner tears it down on SIGINT the tree survives Ctrl+C holding
  // `server-start.lock` — the exact orphan this harness exists to prevent.
  it.each<NodeJS.Signals>(['SIGINT', 'SIGTERM'])(
    'stops the environment and re-raises %s so the runner still exits on the signal',
    async (signal) => {
      const { processRef, emit, raised } = makeProcessRef()
      let stopCallCount = 0
      registerEphemeralShutdownHandlers({
        stop: async () => {
          stopCallCount += 1
        },
        killApplicationTree: () => {},
        processRef,
      })

      emit(signal)
      await new Promise((resolve) => setImmediate(resolve))

      expect(stopCallCount).toBe(1)
      expect(raised).toEqual([[9999, signal]])
    },
  )

  it('re-raises the signal even when stopping the environment fails', async () => {
    const { processRef, emit, raised } = makeProcessRef()
    registerEphemeralShutdownHandlers({
      stop: async () => {
        throw new Error('teardown blew up')
      },
      killApplicationTree: () => {},
      processRef,
    })

    emit('SIGINT')
    await new Promise((resolve) => setImmediate(resolve))

    expect(raised).toEqual([[9999, 'SIGINT']])
  })

  it('kills the application tree on the hard-exit sweep', () => {
    const { processRef, emit } = makeProcessRef()
    let killCallCount = 0
    registerEphemeralShutdownHandlers({
      stop: async () => {},
      killApplicationTree: () => {
        killCallCount += 1
      },
      processRef,
    })

    emit('exit')
    expect(killCallCount).toBe(1)
  })

  // The environment is restarted on retry, so handlers that are never removed stack one dead
  // closure per attempt until Node warns about a listener leak.
  it('removes every listener on dispose so repeated environment starts do not stack them', () => {
    const { processRef, listenerCount } = makeProcessRef()
    const first = registerEphemeralShutdownHandlers({
      stop: async () => {},
      killApplicationTree: () => {},
      processRef,
    })
    expect(listenerCount('exit')).toBe(1)
    expect(listenerCount('SIGINT')).toBe(1)

    first.dispose()
    expect(listenerCount('exit')).toBe(0)
    expect(listenerCount('SIGINT')).toBe(0)
    expect(listenerCount('SIGTERM')).toBe(0)

    registerEphemeralShutdownHandlers({
      stop: async () => {},
      killApplicationTree: () => {},
      processRef,
    }).dispose()
    expect(listenerCount('exit')).toBe(0)
  })
})

// Every other process-lifecycle test here drives injected fakes, so nothing pins down the part
// that can only fail against the real OS: whether `detached: true` plus a negated-pid signal
// actually reaps the grandchildren the wrapper spawned. `sh` stands in for the `yarn start`
// wrapper and `sleep` for the `mercato start`/Next tree it would leave behind.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

describeOnPosix('terminateProcessTree against a real detached process tree', () => {
  const isProcessAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }

  const waitUntilGone = async (pid: number, timeoutMs = 5_000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return !isProcessAlive(pid)
  }

  it('kills the grandchild the wrapper spawned, not just the wrapper itself', async () => {
    const resolvedSpawn = resolveSpawnCommand('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], {
      detached: true,
    })
    const wrapperProcess = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      ...resolvedSpawn.spawnOptions,
    }) as CapturedOutputProcess

    let grandchildPid = 0
    try {
      grandchildPid = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for the grandchild pid')), 5_000)
        wrapperProcess.stdout?.once('data', (chunk: Buffer) => {
          clearTimeout(timer)
          resolve(Number.parseInt(chunk.toString().trim(), 10))
        })
      })

      expect(Number.isInteger(grandchildPid)).toBe(true)
      // The detached spawn puts the wrapper in its own process group, so the group id is its pid.
      expect(grandchildPid).not.toBe(wrapperProcess.pid)
      expect(isProcessAlive(grandchildPid)).toBe(true)

      await terminateProcessTree(wrapperProcess, { gracePeriodMs: 1_000 })

      await expect(waitUntilGone(grandchildPid)).resolves.toBe(true)
      await expect(waitUntilGone(wrapperProcess.pid as number)).resolves.toBe(true)
    } finally {
      for (const pid of [grandchildPid, wrapperProcess.pid ?? 0]) {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      }
    }
  }, 20_000)

  // The shape `waitForApplicationReadiness` reports: the `yarn` wrapper dies non-zero (port in use,
  // broken build, worker dead on boot) while the `mercato start`/Next tree it spawned lives on. The
  // leader is already reaped by the time teardown runs, so this is the case an exit short-circuit in
  // `terminateProcessTree` silently skips — leaving the orphan that still holds `server-start.lock`.
  it('kills a grandchild that outlived its already-exited wrapper', async () => {
    const resolvedSpawn = resolveSpawnCommand('/bin/sh', ['-c', 'sleep 30 & echo $!; exit 1'], {
      detached: true,
    })
    const wrapperProcess = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      ...resolvedSpawn.spawnOptions,
    }) as CapturedOutputProcess

    let grandchildPid = 0
    try {
      // `'exit'` and the stdout `'data'` carrying the pid are independent events with no ordering
      // guarantee, so both are awaited separately. Waiting for `'close'` instead would deadlock:
      // the detached grandchild inherits this stdout pipe and holds it open for its whole lifetime.
      const withTimeout = <T,>(label: string, subscribe: (resolve: (value: T) => void) => void) =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5_000)
          subscribe((value) => {
            clearTimeout(timer)
            resolve(value)
          })
        })

      const [pidText] = await Promise.all([
        withTimeout<string>('the grandchild pid', (resolve) =>
          wrapperProcess.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString())),
        ),
        withTimeout<void>('the wrapper to exit', (resolve) => wrapperProcess.once('exit', () => resolve())),
      ])
      grandchildPid = Number.parseInt(pidText.trim(), 10)

      expect(Number.isInteger(grandchildPid)).toBe(true)
      expect(wrapperProcess.exitCode).toBe(1)
      expect(isProcessAlive(grandchildPid)).toBe(true)

      await terminateProcessTree(wrapperProcess, { gracePeriodMs: 1_000 })

      await expect(waitUntilGone(grandchildPid)).resolves.toBe(true)
    } finally {
      for (const pid of [grandchildPid, wrapperProcess.pid ?? 0]) {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      }
    }
  }, 20_000)
})
