import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createResolver } from '../../resolver'
import {
  parseEphemeralAppOptions,
  parseIntegrationCoverageOptions,
  parseOptions,
  tryReuseExistingEnvironment,
  writeEphemeralEnvironmentState,
  readEphemeralEnvironmentState,
  clearEphemeralEnvironmentState,
  resolveBuildCacheTtlSeconds,
  shouldReuseBuildArtifacts,
} from '../integration'

const CACHE_TTL_ENV_VAR = 'OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS'
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
    await restoreEphemeralStateFiles(originalEphemeralEnvState, originalEphemeralLegacyEnvState)
  })

  it('reuses an existing reachable ephemeral environment state', async () => {
    const baseUrl = 'http://127.0.0.1:5001'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as unknown as Response)

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

  it('parses --force-rebuild for integration test commands', () => {
    expect(parseOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
    expect(parseEphemeralAppOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
    expect(parseIntegrationCoverageOptions(['--force-rebuild'])).toMatchObject({ forceRebuild: true })
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
          inputFingerprint: initialFingerprint,
          typescriptInputFingerprint: initialFingerprint,
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
          inputFingerprint: refreshedFingerprint,
          typescriptInputFingerprint: refreshedFingerprint,
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
