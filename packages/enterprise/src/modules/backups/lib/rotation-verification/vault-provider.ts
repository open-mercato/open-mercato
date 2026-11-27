import { createHash, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { collect } from '../engine/streams'
import type { ExplicitKeyProvider } from './keys'

export type VersionedVaultOptions = { address: string; token: string; keyPath: string; versionsFile: string; target: boolean; signal?: AbortSignal }
const fail = (code: string): never => { throw new Error(`[internal] ${code}`) }
const tenantPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function concreteKey(value: unknown): string {
  if (typeof value !== 'string') return fail('ROTATION_KEY_UNAVAILABLE')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length !== 32 || bytes.toString('base64') !== value) return fail('ROTATION_KEY_UNAVAILABLE')
  return value
}

/** KV v2 reads only. Never provisions, overwrites, deletes, or selects a fallback. */
export async function createVersionedVaultProvider(tenantIds: string[], options: VersionedVaultOptions): Promise<ExplicitKeyProvider> {
  if (options.address.length > 2048 || options.keyPath.length > 1024) return fail('ROTATION_VAULT_CONFIGURATION_INVALID')
  let address: string
  try {
    const parsed = new URL(options.address)
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    if (!['http:', 'https:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && !loopback) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.href.includes('?') || parsed.href.includes('#')) return fail('ROTATION_VAULT_CONFIGURATION_INVALID')
    address = parsed.toString().replace(/\/+$/, '')
  } catch { return fail('ROTATION_VAULT_CONFIGURATION_INVALID') }
  const keyPath = options.keyPath.replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPath) || !options.token || !isAbsolute(options.versionsFile)) return fail('ROTATION_VAULT_CONFIGURATION_INVALID')
  let manifest: unknown
  try {
    const file = await open(options.versionsFile, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 1024 * 1024 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) return fail('ROTATION_VAULT_PINS_INVALID')
      const bytes = await collect(file.createReadStream({ autoClose: false, highWaterMark: 65536 }), 1024 * 1024)
      manifest = JSON.parse(bytes.toString('utf8'))
    } finally { await file.close() }
  } catch { return fail('ROTATION_VAULT_PINS_INVALID') }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return fail('ROTATION_VAULT_PINS_INVALID')
  const input = manifest as Record<string, unknown>
  if (input.schemaVersion !== 1 || Object.keys(input).some(key => !['schemaVersion', 'versions'].includes(key)) || !input.versions || typeof input.versions !== 'object' || Array.isArray(input.versions)) return fail('ROTATION_VAULT_PINS_INVALID')
  const entries = Object.entries(input.versions as Record<string, unknown>)
  if (!entries.length || entries.length > 10000 || entries.some(([tenant, version]) => !tenantPattern.test(tenant) || !Number.isSafeInteger(version) || Number(version) < 1)) return fail('ROTATION_VAULT_PINS_INVALID')
  const requested = new Map(entries as [string, number][])
  const selectedTenants = new Set(tenantIds)
  if (requested.size !== selectedTenants.size || entries.some(([tenant]) => !selectedTenants.has(tenant))) return fail('ROTATION_VAULT_PIN_SCOPE_MISMATCH')
  const versions = new Map<string, number>()
  for (const tenant of [...new Set(tenantIds)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!tenantPattern.test(tenant) || !requested.has(tenant)) return fail('ROTATION_VAULT_PIN_REQUIRED')
    versions.set(tenant, requested.get(tenant)!)
  }
  const read = async (tenant: string, version?: number): Promise<{ key: string; version: number }> => {
    if (options.signal?.aborted) return fail('ROTATION_VERIFICATION_INCOMPLETE')
    const signal = AbortSignal.any([AbortSignal.timeout(10000), ...(options.signal ? [options.signal] : [])])
    try {
      const response = await fetch(`${address}/v1/${keyPath}/tenant_key_${tenant}${version === undefined ? '' : `?version=${version}`}`, { headers: { 'X-Vault-Token': options.token }, signal, redirect: 'error', cache: 'no-store' })
      if (!response.ok || !response.body) return fail('ROTATION_VAULT_READ_FAILED')
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > 65536) return fail('ROTATION_VAULT_RESPONSE_INVALID')
          chunks.push(next.value)
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: { data?: { key?: unknown }; metadata?: { version?: unknown; destroyed?: unknown; deletion_time?: unknown } } }
      const metadata = value?.data?.metadata
      if (!metadata || !Number.isSafeInteger(metadata.version) || Number(metadata.version) < 1 || metadata.destroyed === true || (metadata.deletion_time !== undefined && metadata.deletion_time !== '')) return fail('ROTATION_VAULT_RESPONSE_INVALID')
      if (version !== undefined && metadata.version !== version) return fail('ROTATION_VAULT_VERSION_MISMATCH')
      return { key: concreteKey(value.data?.data?.key), version: Number(metadata.version) }
    } catch (error) {
      if (options.signal?.aborted) return fail('ROTATION_VERIFICATION_INCOMPLETE')
      if (error instanceof Error && /^\[internal\] ROTATION_/.test(error.message)) throw error
      return fail('ROTATION_VAULT_READ_FAILED')
    }
  }
  const service: KmsService = {
    isHealthy: () => true,
    invalidateDek() {},
    async createTenantDek() { return fail('ROTATION_KEY_PROVISIONING_FORBIDDEN') },
    async getTenantDek(tenantId): Promise<TenantDek> {
      const version = versions.get(tenantId)
      if (version === undefined) return fail('ROTATION_COVERAGE_UNSUPPORTED')
      const selected = await read(tenantId, version)
      if (options.target) {
        const latest = await read(tenantId)
        if (latest.version !== version || !timingSafeEqual(Buffer.from(latest.key, 'base64'), Buffer.from(selected.key, 'base64'))) return fail('ROTATION_VAULT_TARGET_NOT_CURRENT')
      }
      return { tenantId, key: selected.key, fetchedAt: Date.now() }
    },
  }
  const versionBinding = { tenants: versions.size, sha256: createHash('sha256').update(JSON.stringify([...versions])).digest('hex') }
  return { identity: JSON.stringify(['vault-kv2', address, keyPath, versionBinding]), service }
}
