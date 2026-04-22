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
  shouldReuseBuildArtifacts,
} from '../integration'

const CACHE_TTL_ENV_VAR = 'OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS'
const APP_READY_TIMEOUT_ENV_VAR = 'OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS'
const CHECKOUT_TEST_INJECTION_FLAG = 'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED'
const resolver = createResolver()
const projectRootDirectory = resolver.getRootDir()

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
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/api/auth/login')) {
        return { status: 401, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          text: async () => '<!doctype html><script src="/_next/static/chunks/app-healthcheck.js"></script>',
        } as unknown as Response
      }
      if (url.includes('/_next/static/chunks/app-healthcheck.js')) {
        return { status: 200, text: async () => '' } as unknown as Response
      }
      return { status: 200, text: async () => '' } as unknown as Response
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
        logPrefix: 'integration',
        captureScreenshots: true,
      })

      const state = await readEphemeralEnvironmentState()
      expect(state).toMatchObject({ baseUrl, port: 5001, captureScreenshots: true })

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
      expect(environment?.commandEnvironment.PW_CAPTURE_SCREENSHOTS).toBe('1')
      expect(environment?.commandEnvironment.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  }, 20000)

  it('reuses an existing environment with checkout wrapper injections only when explicitly enabled', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    process.env[CHECKOUT_TEST_INJECTION_FLAG] = 'true'
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/api/auth/login')) {
        return { status: 401, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          text: async () => '<!doctype html><script src="/_next/static/chunks/app-healthcheck.js"></script>',
        } as unknown as Response
      }
      if (url.includes('/_next/static/chunks/app-healthcheck.js')) {
        return { status: 200, text: async () => '' } as unknown as Response
      }
      return { status: 200, text: async () => '' } as unknown as Response
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
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
      expect(environment?.commandEnvironment.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED).toBe('true')
    } finally {
      fetchSpy.mockRestore()
    }
  }, 20000)

  it('reuses an existing environment when /login returns a redirect status other than 302', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/api/auth/login')) {
        return { status: 401, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return { status: 308, text: async () => '' } as unknown as Response
      }
      return { status: 200, text: async () => '' } as unknown as Response
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
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
  }, 20000)

  it('reuses an existing environment when /login returns healthy HTML without static asset references', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/api/auth/login')) {
        return { status: 401, text: async () => '' } as unknown as Response
      }
      if (url.endsWith('/login')) {
        return {
          status: 200,
          text: async () => '<!doctype html><html><body><form data-auth-ready="0"></form></body></html>',
        } as unknown as Response
      }
      return { status: 200, text: async () => '' } as unknown as Response
    })

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
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
  })

  it('falls back to rebuilding when the ephemeral environment state is unreachable', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as unknown as Response)

    try {
      await writeEphemeralEnvironmentState({
        baseUrl,
        port: 5001,
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
          version: 1,
          builtAt: Date.now(),
          sourceFingerprint: initialFingerprint,
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
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(true)

      await writeFile(sourceFile, 'const value = 2')
      await expect(
        shouldReuseBuildArtifacts(120, 'integration', {
          inputPaths: [sourceFile],
          artifactPaths: [artifactPath],
          cacheStatePath,
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)

      await writeFile(sourceFile, 'const value = 1')
      const refreshedFingerprint = await resolveBuildCacheFingerprint(tempRoot, sourceFile)
      await writeFile(
        cacheStatePath,
        `${JSON.stringify({
          version: 1,
          builtAt: Date.now() - 240_000,
          sourceFingerprint: refreshedFingerprint,
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
          projectRoot: tempRoot,
        }),
      ).resolves.toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
