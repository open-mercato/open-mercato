import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Redis } from 'ioredis'
import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, CacheProviderLogger, ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderConformance, randomNamespace, sleep } from '@open-mercato/cache/testing/conformance'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { buildRespKeyLayout } from '@open-mercato/cache-redis-protocol'
import { APP_PASSWORD, APP_USER, describeContainers } from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { TlsMaterial } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { buildConformanceHost, PACKAGES_DIR, spawnRespRemote } from '@open-mercato/cache-redis-protocol/test-support/host'
import { createPackedInstall } from '@open-mercato/cache-redis-protocol/test-support/packed'
import type { PackedInstall } from '@open-mercato/cache-redis-protocol/test-support/packed'
import { PREFLIGHT_CREDENTIAL_FILE_ENV, PREFLIGHT_REAUTH_INTERVAL_MS, preflightProviderFixture } from './file-credential'
import type { PreflightProviderFixture } from './file-credential'

export const MANAGED_KIT_PACKAGE_DIR_NAME = 'cache-provider-managed-kit'

export const GATE_ENV = {
  OM_ENABLE_ENTERPRISE_MODULES: 'true',
  OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS: 'true',
} as const

export type PreflightTarget = {
  tls: TlsMaterial
  /** One admin connection per server node (a single entry for standalone). */
  nodes(): Redis[]
  /** Admin client able to address any key (a Cluster for cluster targets). */
  keyspace(): Pick<Redis, 'set' | 'get' | 'del'>
  stop(): Promise<void>
}

export type PreflightTlsOverride = { ca?: string; servername?: string }

export type ManagedPreflightOptions = {
  label: string
  /** Package directory under `packages/` (its `src/index.ts` exports `packed.factoryExport`). */
  packageDirName: string
  /** Build the provider under test with the rotating file credential standing in for the cloud identity. */
  createProvider(fixture: PreflightProviderFixture): CacheProviderDefinition<unknown>
  start(): Promise<PreflightTarget>
  /** Raw (pre-parse) provider settings for the started target. */
  settings(target: PreflightTarget, tls?: PreflightTlsOverride): Record<string, unknown>
  packed: {
    packageName: string
    /** Exported provider factory accepting `{ credentialSource }`. */
    factoryExport: string
    /** Exported gated registration helper accepting `{ settings }`. */
    registrationExport: string
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /app-pass-7c1f0e2b9d/,
  /admin-pass-41ad8e3c/,
  /denied-credential-/,
  /"type":\s*"service_account"/,
  /client_secret/i,
]

function packedSmokeScript(options: ManagedPreflightOptions['packed']): string {
  return `
import * as pkg from '${options.packageName}'
import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
const env = (namespace) => ({ CACHE_PROVIDER: pkg.provider.id, CACHE_PROVIDER_NAMESPACE: namespace })
const out = { id: pkg.provider.id }
delete process.env.OM_ENABLE_ENTERPRISE_MODULES
delete process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS
let settingsEvaluated = false
const gated = pkg.${options.registrationExport}({ settings: () => { settingsEvaluated = true; return {} } })
const closed = await resolveCacheProvider([gated], { env: env('packed-closed') })
try {
  await closed.definition.create(closed.config, createCacheProviderHostContext(closed))
  out.closed = 'created'
} catch (error) {
  out.closed = error.code
}
out.settingsEvaluatedWhileClosed = settingsEvaluated
process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS = 'true'
const provider = pkg.${options.factoryExport}({
  credentialSource: () => async () => ({ username: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD, expiresAt: null }),
})
const settings = JSON.parse(process.env.SMOKE_SETTINGS)
const resolved = await resolveCacheProvider([defineCacheProviderRegistration({ id: provider.id, load: async () => provider, settings: () => settings })], { env: env('packed-open') })
const strategy = await resolved.definition.create(resolved.config, createCacheProviderHostContext(resolved))
await strategy.healthcheck()
await strategy.set('smoke:a', { ok: 1 }, { tags: ['smoke'] })
out.get = await strategy.get('smoke:a')
out.invalidated = await strategy.deleteByTags(['smoke'])
out.after = await strategy.get('smoke:a')
out.cleared = await strategy.clear()
await strategy.close()
await strategy.close()
out.redacted = resolved.definition.redact(resolved.config)
process.stdout.write(JSON.stringify(out))
process.exit(0)
`
}

type Credential = { username?: string; password: string }

/**
 * Entry module for the independent conformance process: the provider built by
 * the package factory over the same rotating file credential as in-process.
 */
function writeFixtureEntry(dir: string, options: ManagedPreflightOptions): string {
  const entry = path.join(dir, 'fixture-provider.ts')
  writeFileSync(entry, [
    `import { preflightProviderFixture } from ${JSON.stringify(path.join(__dirname, 'file-credential.ts'))}`,
    `import { ${options.packed.factoryExport} } from ${JSON.stringify(path.join(PACKAGES_DIR, options.packageDirName, 'src', 'index.ts'))}`,
    `export const provider = ${options.packed.factoryExport}(preflightProviderFixture())`,
    '',
  ].join('\n'))
  return entry
}

const SUITE_TIMEOUT_MS = 600_000

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as { originalError?: unknown }).originalError ?? (error as { cause?: unknown }).cause
  return `${error.name} ${error.message} ${JSON.stringify(error)} ${cause instanceof Error ? `${cause.message} ${cause.stack ?? ''}` : ''}`
}

function silentLogger(): CacheProviderLogger & { messages: string[] } {
  const messages: string[] = []
  return { messages, warn: (message) => void messages.push(message), error: (message) => void messages.push(message) }
}

async function eventually<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await sleep(200)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('[internal] operation did not succeed in time')
}

async function authCalls(nodes: Redis[]): Promise<number> {
  let total = 0
  for (const node of nodes) {
    const stats = await node.info('commandstats')
    const match = stats.match(/cmdstat_auth:calls=(\d+)/)
    total += match ? Number(match[1]) : 0
  }
  return total
}

async function clientCount(nodes: Redis[]): Promise<number> {
  let total = 0
  for (const node of nodes) {
    const list = String(await node.call('CLIENT', 'LIST'))
    total += list.split('\n').filter((line) => line.includes(`user=${APP_USER} `)).length
  }
  return total
}

async function keyCount(nodes: Redis[]): Promise<number> {
  let total = 0
  for (const node of nodes) total += await node.dbsize()
  return total
}

/**
 * Container preflight for an official managed provider: the provider's own
 * settings schema, TLS with hostname verification and an ACL user whose
 * password is supplied by a rotating fake credential source standing in for
 * the cloud identity. Not live evidence: it never promotes a cloud profile.
 */
export function defineManagedProviderPreflight(options: ManagedPreflightOptions): void {
  const provider = options.createProvider(preflightProviderFixture())
  const providerId = provider.id
  let target: PreflightTarget | null = null
  let hostModule = ''
  let credentialDir = ''
  let credentialFile = ''
  let current: Credential = { username: APP_USER, password: APP_PASSWORD }
  const savedEnv: Record<string, string | undefined> = {}

  const writeCredential = (credential: Credential) => {
    current = credential
    writeFileSync(credentialFile, JSON.stringify(credential), { mode: 0o600 })
  }

  const ctx = () => {
    if (!target) throw new Error('[internal] preflight target not started')
    return target
  }

  const settingsFor = (tls?: PreflightTlsOverride) => options.settings(ctx(), tls)

  const resolve = async (namespace: string, settings: unknown = settingsFor()) => {
    const registration = defineCacheProviderRegistration({ id: providerId, load: async () => provider, settings: () => settings })
    const resolved = await resolveCacheProvider([registration], { env: { CACHE_PROVIDER: providerId, CACHE_PROVIDER_NAMESPACE: namespace } })
    if (!resolved) throw new Error('[internal] provider not selected')
    return resolved as ResolvedCacheProvider<unknown>
  }

  const openStrategy = async (namespace: string, settings?: unknown, logger?: CacheProviderLogger): Promise<CacheStrategy> => {
    const resolved = await resolve(namespace, settings)
    const context = createCacheProviderHostContext(resolved)
    return resolved.definition.create(resolved.config, { ...context, logger: logger ?? silentLogger() })
  }

  describeContainers(`${options.label} (container preflight, not live evidence)`, () => {
    jest.setTimeout(180_000)

    beforeAll(async () => {
      for (const [key, value] of Object.entries({ ...GATE_ENV, [PREFLIGHT_CREDENTIAL_FILE_ENV]: '' })) {
        savedEnv[key] = process.env[key]
        if (value) process.env[key] = value
      }
      credentialDir = mkdtempSync(path.join(os.tmpdir(), 'om-managed-preflight-'))
      credentialFile = path.join(credentialDir, 'credential.json')
      process.env[PREFLIGHT_CREDENTIAL_FILE_ENV] = credentialFile
      writeCredential({ username: APP_USER, password: APP_PASSWORD })
      target = await options.start()
      hostModule = await buildConformanceHost(options.packageDirName, writeFixtureEntry(credentialDir, options))
    }, SUITE_TIMEOUT_MS)

    afterAll(async () => {
      await target?.stop()
      rmSync(credentialDir, { recursive: true, force: true })
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }, SUITE_TIMEOUT_MS)

    defineCacheProviderConformance({
      name: options.label,
      createService: async (namespace, serviceOptions) => createCacheService({
        provider: await resolve(namespace),
        ...(serviceOptions?.defaultTtl !== undefined ? { defaultTtl: serviceOptions.defaultTtl } : {}),
      }),
      createIndependentProcess: (namespace) => spawnRespRemote({ hostModule, providerId, namespace, settings: settingsFor() }),
      corrupt: async ({ namespace, physicalKey }) => {
        await ctx().keyspace().set(buildRespKeyLayout(namespace).valueKey(physicalKey), '{"v":1,"value":')
      },
      supportsReturnExpired: false,
    })

    describe('managed identity preflight', () => {
      it('re-authenticates live connections on rotation and reconnects with the rotated credential', async () => {
        const nodes = ctx().nodes()
        const strategy = await openStrategy(randomNamespace('rotate'))
        try {
          await strategy.set('before', 1)
          const previous = current.password
          const rotated = `rotated-${Math.random().toString(36).slice(2)}-pass`
          for (const node of nodes) await node.call('ACL', 'SETUSER', APP_USER, `>${rotated}`)
          writeCredential({ username: APP_USER, password: rotated })
          const authBefore = await authCalls(nodes)
          await sleep(PREFLIGHT_REAUTH_INTERVAL_MS * 3)
          expect(await authCalls(nodes)).toBeGreaterThan(authBefore)
          for (const node of nodes) await node.call('ACL', 'SETUSER', APP_USER, `<${previous}`)
          expect(await strategy.get('before')).toBe(1)
          for (const node of nodes) await node.call('CLIENT', 'KILL', 'USER', APP_USER)
          await eventually(async () => {
            await strategy.set('after', 2)
            expect(await strategy.get('after')).toBe(2)
          }, 30_000)
          expect(await clientCount(nodes)).toBeGreaterThan(0)
        } finally {
          await strategy.clear()
          await strategy.close?.()
        }
      })

      it('fails closed on a denied or expired credential without leaking it', async () => {
        const valid = current
        const denied = 'denied-credential-31c9a7'
        writeCredential({ username: APP_USER, password: denied })
        try {
          const failure = await openStrategy(randomNamespace('denied'), { ...settingsFor(), connectTimeoutMs: 3_000 })
            .then(async (strategy) => {
              try {
                await strategy.healthcheck?.()
                return null
              } catch (error) {
                return error
              } finally {
                await strategy.close?.()
              }
            }, (error: unknown) => error)
          expect(failure).toBeInstanceOf(Error)
          expect(errorText(failure)).not.toContain(denied)
        } finally {
          writeCredential(valid)
        }
      })

      it('verifies the server certificate chain and hostname with no bypass', async () => {
        const wrongName = await openStrategy(randomNamespace('tls-name'), { ...settingsFor({ servername: 'not-the-cache.example.com' }), connectTimeoutMs: 2_000 }).catch((error: unknown) => error)
        expect(wrongName).toBeInstanceOf(Error)
        const wrongCa = await openStrategy(randomNamespace('tls-ca'), { ...settingsFor({ ca: ctx().tls.otherCa }), connectTimeoutMs: 2_000 }).catch((error: unknown) => error)
        expect(wrongCa).toBeInstanceOf(Error)
        expect(provider.settings.safeParse({ ...settingsFor(), tls: { rejectUnauthorized: false } }).success).toBe(false)
      })

      it('healthcheck is non-mutating and close is idempotent', async () => {
        const nodes = ctx().nodes()
        const strategy = await openStrategy(randomNamespace('health'))
        const before = await keyCount(nodes)
        for (let attempt = 0; attempt < 3; attempt += 1) await strategy.healthcheck?.()
        expect(await keyCount(nodes)).toBe(before)
        await strategy.close?.()
        await strategy.close?.()
      })

      it('installs from packed tarballs alone, stays gated, connects with an injected identity and ships no secrets', async () => {
        let packed: PackedInstall | null = null
        try {
          packed = createPackedInstall(options.packageDirName, { withPackages: [MANAGED_KIT_PACKAGE_DIR_NAME] })
          expect(packed.installedScopePackages).toEqual(['cache', 'cache-redis-protocol', MANAGED_KIT_PACKAGE_DIR_NAME, options.packageDirName].sort())
          const tarballs = readdirSync(path.join(packed.workDir, 'pack'))
          for (const [dirName, required] of [
            [options.packageDirName, ['package/RUNBOOK.md']],
            [MANAGED_KIT_PACKAGE_DIR_NAME, []],
          ] as const) {
            const tarball = tarballs.find((name) => name === `${dirName}.tgz`)!
            const tarPath = path.join(packed.workDir, 'pack', tarball)
            const entries = execFileSync('tar', ['-tzf', tarPath], { encoding: 'utf8' }).trim().split('\n')
            expect(entries).toEqual(expect.arrayContaining(['package/LICENSE.md', 'package/README.md', 'package/package.json', 'package/dist/index.js', ...required]))
            expect(entries.filter((entry) => /__tests__|test-support|jest\.|\.test\.|\.env|\.pem$|\.key$/.test(entry))).toEqual([])
            const contents = execFileSync('tar', ['-xzOf', tarPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            for (const pattern of SECRET_PATTERNS) expect([dirName, pattern.source, pattern.test(contents)]).toEqual([dirName, pattern.source, false])
            const packedManifest = JSON.parse(execFileSync('tar', ['-xzOf', tarPath, 'package/package.json'], { encoding: 'utf8' })) as { license: string; dependencies: Record<string, string> }
            expect(packedManifest.license).toBe('SEE LICENSE IN LICENSE.md')
            expect(JSON.stringify(packedManifest.dependencies)).not.toContain('workspace:')
          }
          const output = packed.run(packedSmokeScript(options.packed), {
            SMOKE_SETTINGS: JSON.stringify(settingsFor()),
            SMOKE_USER: current.username ?? '',
            SMOKE_PASSWORD: current.password,
          })
          const result = JSON.parse(output)
          expect(result).toMatchObject({
            id: providerId,
            closed: 'unavailable',
            settingsEvaluatedWhileClosed: false,
            get: { ok: 1 },
            after: null,
          })
          expect(result.invalidated).toBeGreaterThanOrEqual(1)
          expect(JSON.stringify(result.redacted)).not.toContain(current.password)
          packed.typecheck([
            `import { ${options.packed.registrationExport} } from '${options.packed.packageName}'`,
            `export const cacheProviders = [${options.packed.registrationExport}({ settings: () => ({}) })]`,
            '',
          ].join('\n'))
        } finally {
          packed?.dispose()
        }
      }, 900_000)

      it('opens no connection while the Enterprise gate is closed', async () => {
        const nodes = ctx().nodes()
        const settings = settingsFor()
        const clientsBefore = await clientCount(nodes)
        const authBefore = await authCalls(nodes)
        delete process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS
        try {
          const resolved = await resolve(randomNamespace('gate'), settings)
          const service = createCacheService({ provider: resolved })
          await expect(service.get('k')).rejects.toMatchObject({ code: 'unavailable' })
          await service.close?.()
        } finally {
          process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS = 'true'
        }
        expect(await clientCount(nodes)).toBeLessThanOrEqual(clientsBefore)
        expect(await authCalls(nodes)).toBe(authBefore)
      })
    })
  })
}
