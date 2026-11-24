import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { StartedTestContainer } from 'testcontainers'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider, type ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { spawnConformanceRemoteProcess, type ConformanceRemoteProcess } from '@open-mercato/cache/testing/remote'
import { MEMCACHED_PROVIDER_ID, provider, type MemcachedProviderConfig, type MemcachedProviderSettingsInput } from '../../index'
import { createMemcachedClient, createTcpTransport, type MemcachedClient } from '../../protocol'

export const MEMCACHED_IMAGE = 'memcached:1.6.45-alpine'
export const CONTAINER_TESTS_ENABLED = process.env.OM_CACHE_PROVIDER_CONTAINER_TESTS === '1'
export const describeWithMemcached = CONTAINER_TESTS_ENABLED ? describe : describe.skip

const PACKAGE_DIR = path.resolve(__dirname, '../../..')
export const CHILD_RUNNER = path.join(PACKAGE_DIR, 'test-support', 'child.mjs')
const BUNDLE_BUILDER = path.join(PACKAGE_DIR, 'test-support', 'build-bundle.mjs')

export type MemcachedEndpoint = { host: string; port: number }

export async function startMemcached(
  args: string[] = [],
  options: { hostPort?: number } = {},
): Promise<{ container: StartedTestContainer; endpoint: MemcachedEndpoint }> {
  const { GenericContainer, Wait } = await import('testcontainers')
  const exposed = options.hostPort !== undefined ? { container: 11211, host: options.hostPort } : 11211
  const container = await new GenericContainer(MEMCACHED_IMAGE)
    .withCommand(['memcached', ...args])
    .withExposedPorts(exposed)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000)
    .start()
  return { container, endpoint: { host: container.getHost(), port: container.getMappedPort(11211) } }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export function settingsFor(endpoint: MemcachedEndpoint, overrides: Partial<MemcachedProviderSettingsInput> = {}): MemcachedProviderSettingsInput {
  return { host: endpoint.host, port: endpoint.port, ...overrides }
}

export async function resolveMemcached(namespace: string, settings: MemcachedProviderSettingsInput): Promise<ResolvedCacheProvider> {
  const registration = defineCacheProviderRegistration<MemcachedProviderConfig>({
    id: MEMCACHED_PROVIDER_ID,
    load: async () => provider,
    settings: () => settings,
  })
  const resolved = await resolveCacheProvider([registration], {
    env: { CACHE_PROVIDER: MEMCACHED_PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: namespace },
  })
  if (!resolved) throw new Error('[internal] memcached provider was not selected')
  return resolved
}

export async function openService(namespace: string, settings: MemcachedProviderSettingsInput, defaultTtl?: number) {
  return createCacheService({
    provider: await resolveMemcached(namespace, settings),
    ...(defaultTtl !== undefined ? { defaultTtl } : {}),
  })
}

export function rawClient(endpoint: MemcachedEndpoint): MemcachedClient {
  return createMemcachedClient({ transport: createTcpTransport(endpoint), poolSize: 1 })
}

export type TestBundle = { path: string; dispose(): void }

export async function buildBundle(): Promise<TestBundle> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'om-memcached-bundle-'))
  const outfile = path.join(directory, 'bundle.mjs')
  await runNode([BUNDLE_BUILDER, outfile])
  return { path: outfile, dispose: () => rmSync(directory, { recursive: true, force: true }) }
}

export function runNode(args: string[], env: Record<string, string> = {}, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`[internal] node ${path.basename(args[0])} exited with ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

export function childEnv(bundle: TestBundle, namespace: string, settings: MemcachedProviderSettingsInput): Record<string, string> {
  return {
    MEMCACHED_TEST_BUNDLE: bundle.path,
    MEMCACHED_SETTINGS: JSON.stringify(settings),
    CACHE_PROVIDER: MEMCACHED_PROVIDER_ID,
    CACHE_PROVIDER_NAMESPACE: namespace,
  }
}

export function spawnServingChild(bundle: TestBundle, namespace: string, settings: MemcachedProviderSettingsInput): Promise<ConformanceRemoteProcess> {
  return spawnConformanceRemoteProcess({
    command: process.execPath,
    args: [CHILD_RUNNER],
    env: childEnv(bundle, namespace, settings),
  })
}

export type WorkloadResult = {
  pid: number
  elapsedMs: number
  throughputOpsPerSec: number
  latencyMs: Record<'get' | 'set' | 'deleteByTags', { count: number; p50: number | null; p95: number | null; p99: number | null }>
  errors: Array<{ op: string; name?: string; code?: string; message: string }>
  written: string[]
  diagnostics: {
    casConflicts: number
    casRetriesExhausted: number
    capacityEvictions: number
    commandCounts: Record<string, number>
  } | null
}

export async function runWorkloadChild(
  bundle: TestBundle,
  namespace: string,
  settings: MemcachedProviderSettingsInput,
  workload: Record<string, unknown>,
): Promise<WorkloadResult> {
  const stdout = await runNode([CHILD_RUNNER], {
    ...childEnv(bundle, namespace, settings),
    MEMCACHED_CHILD_MODE: 'workload',
    MEMCACHED_WORKLOAD: JSON.stringify(workload),
  })
  const line = stdout.trim().split('\n').pop() ?? '{}'
  return JSON.parse(line) as WorkloadResult
}
