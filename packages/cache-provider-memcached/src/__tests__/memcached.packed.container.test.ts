/**
 * Packed installation of @open-mercato/cache-provider-memcached into a fresh
 * app (no sibling adapters), type-checked and exercised against a real
 * memcached container. Gated on OM_CACHE_PROVIDER_CONTAINER_TESTS=1.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StartedTestContainer } from 'testcontainers'
import { randomNamespace } from '@open-mercato/cache/testing/conformance'
import { CONTAINER_TESTS_ENABLED, describeWithMemcached, runNode, startMemcached, type MemcachedEndpoint } from './support/harness'

jest.setTimeout(300_000)

const PACKAGE_DIR = path.resolve(__dirname, '../..')
const REPO_DIR = path.resolve(PACKAGE_DIR, '../..')
const CACHE_DIR = path.join(REPO_DIR, 'packages', 'cache')
const SMOKE_SCRIPT = path.join(PACKAGE_DIR, 'test-support', 'packed-smoke.mjs')
const BUNDLE_BUILDER = path.join(PACKAGE_DIR, 'test-support', 'build-bundle.mjs')
const TSC = path.join(REPO_DIR, 'node_modules', 'typescript', 'bin', 'tsc')

let container: StartedTestContainer | null = null
let endpoint: MemcachedEndpoint = { host: '127.0.0.1', port: 0 }
let workDir = ''
let appDir = ''
let hostBundle = ''
let installMode: 'npm' | 'tar' = 'npm'

function pack(directory: string, destination: string): string {
  const output = execFileSync('npm', ['pack', '--pack-destination', destination, '--ignore-scripts', '--json'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  }).toString()
  const [result] = JSON.parse(output) as Array<{ filename: string }>
  return path.join(destination, result.filename)
}

function extractInto(tarball: string, target: string): void {
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], { stdio: 'pipe' })
}

function install(cacheTarball: string, providerTarball: string): 'npm' | 'tar' {
  try {
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps', '--no-package-lock'], {
      cwd: appDir,
      stdio: 'pipe',
      timeout: 180_000,
    })
    return 'npm'
  } catch {
    extractInto(cacheTarball, path.join(appDir, 'node_modules', '@open-mercato', 'cache'))
    extractInto(providerTarball, path.join(appDir, 'node_modules', '@open-mercato', 'cache-provider-memcached'))
    for (const dependency of ['zod', '@types/node']) {
      const target = path.join(appDir, 'node_modules', dependency)
      mkdirSync(path.dirname(target), { recursive: true })
      if (!existsSync(target)) symlinkSync(path.join(REPO_DIR, 'node_modules', dependency), target, 'dir')
    }
    return 'tar'
  }
}

if (CONTAINER_TESTS_ENABLED) {
  beforeAll(async () => {
    const started = await startMemcached(['-m', '32'])
    container = started.container
    endpoint = started.endpoint

    execFileSync(process.execPath, ['build.mjs'], { cwd: CACHE_DIR, stdio: 'pipe', timeout: 180_000 })
    execFileSync(process.execPath, ['build.mjs'], { cwd: PACKAGE_DIR, stdio: 'pipe', timeout: 180_000 })

    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-memcached-packed-'))
    const packDir = path.join(workDir, 'pack')
    mkdirSync(packDir, { recursive: true })
    const cacheTarball = pack(CACHE_DIR, packDir)
    const providerTarball = pack(PACKAGE_DIR, packDir)

    appDir = path.join(workDir, 'app')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      name: 'memcached-packed-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies: {
        '@open-mercato/cache': `file:${cacheTarball}`,
        '@open-mercato/cache-provider-memcached': `file:${providerTarball}`,
      },
      devDependencies: { '@types/node': '^22.0.0' },
    }, null, 2))
    installMode = install(cacheTarball, providerTarball)

    hostBundle = path.join(workDir, 'host-bundle.mjs')
    await runNode([BUNDLE_BUILDER, hostBundle, '--host-only'])
  }, 600_000)

  afterAll(async () => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
    await container?.stop()
  })
}

describeWithMemcached('packed @open-mercato/cache-provider-memcached', () => {
  it('installs from tarballs without sibling adapters or workspace links', () => {
    expect(['npm', 'tar']).toContain(installMode)
    console.info(`[packed] install mode: ${installMode}`)
    const scoped = readdirSync(path.join(appDir, 'node_modules', '@open-mercato')).sort()
    expect(scoped).toEqual(['cache', 'cache-provider-memcached'])
    expect(readdirSync(path.join(appDir, 'node_modules')).filter((name) => /memcache|ioredis|redis/i.test(name))).toEqual([])
    const installed = path.join(appDir, 'node_modules', '@open-mercato', 'cache-provider-memcached')
    const files = readdirSync(installed).sort()
    expect(files).toEqual(expect.arrayContaining(['README.md', 'dist', 'package.json', 'src']))
    expect(existsSync(path.join(installed, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(path.join(installed, 'dist', 'protocol', 'index.js'))).toBe(true)
    expect(existsSync(path.join(installed, 'src', '__tests__'))).toBe(false)
    expect(existsSync(path.join(installed, 'test-support'))).toBe(false)
    const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')) as { peerDependencies?: Record<string, string> }
    expect(manifest.peerDependencies).toEqual({ '@open-mercato/cache': '>=0.11.0' })
  })

  it('type-checks a consumer registration against the installed package', () => {
    writeFileSync(path.join(appDir, 'consumer.ts'), [
      "import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'",
      "import { provider, memcachedSettingsSchema, type MemcachedProviderConfig, type MemcachedProviderSettingsInput } from '@open-mercato/cache-provider-memcached'",
      "import { createMemcachedClient, createTcpTransport, type MemcachedClient } from '@open-mercato/cache-provider-memcached/protocol'",
      "const settings: MemcachedProviderSettingsInput = { host: 'cache.internal', bucketCount: 32 }",
      'export const registration = defineCacheProviderRegistration<MemcachedProviderConfig>({',
      "  id: 'open-mercato/memcached',",
      '  load: async () => provider,',
      '  settings: () => memcachedSettingsSchema.parse(settings),',
      '})',
      "export const client: MemcachedClient = createMemcachedClient({ transport: createTcpTransport({ host: 'h', port: 11211 }) })",
      '',
    ].join('\n'))
    writeFileSync(path.join(appDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
        allowImportingTsExtensions: false,
      },
      files: ['consumer.ts'],
    }))
    let output = ''
    try {
      execFileSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: appDir, stdio: 'pipe', timeout: 180_000 })
    } catch (error) {
      output = String((error as { stdout?: Buffer }).stdout ?? error)
    }
    expect(output).toBe('')
  })

  it('resolves through a registration and runs a cache workflow on memcached', async () => {
    const stdout = await runNode([path.join(appDir, 'smoke.mjs')], {
      SMOKE_HOST_BUNDLE: hostBundle,
      SMOKE_HOST: endpoint.host,
      SMOKE_PORT: String(endpoint.port),
      SMOKE_NAMESPACE: randomNamespace('packed'),
    })
    const result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}')
    expect(result.id).toBe('open-mercato/memcached')
    expect(result.placement).toBe('shared')
    expect(result.redacted).toMatchObject({ host: endpoint.host, port: endpoint.port, transport: 'tcp', bucketCount: 16 })
    for (const entry of [result.providerEntry, result.protocolEntry, result.cacheEntry]) {
      expect(String(entry)).toContain(path.basename(workDir))
      expect(String(entry)).toContain('/node_modules/@open-mercato/')
    }
    expect(result.version).toMatch(/^1\.6\./)
    expect(result.workflow).toEqual({
      hit: { name: 'Packed' },
      keys: ['product:1', 'product:2'],
      statsBefore: { size: 3, expired: 0 },
      invalidated: 2,
      afterInvalidation: null,
      remaining: ['order:1'],
      cleared: 1,
    })
  })
})

beforeEach(() => {
  if (appDir && !existsSync(path.join(appDir, 'smoke.mjs'))) {
    writeFileSync(path.join(appDir, 'smoke.mjs'), readFileSync(SMOKE_SCRIPT, 'utf8'))
  }
})
