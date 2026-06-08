import crypto from 'node:crypto'
import { generateDek, hashForLookup } from './aes'
import { isEncryptionDebugEnabled, isTenantDataEncryptionEnabled } from './toggles'
import { parseBooleanToken } from '../boolean'
import { fetchWithTimeout, resolveTimeoutMs } from '../http/fetchWithTimeout'

const DEFAULT_VAULT_REQUEST_TIMEOUT_MS = 1_000

function resolveVaultRequestTimeoutMs(): number {
  const raw = process.env.VAULT_REQUEST_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : undefined
  return resolveTimeoutMs(parsed, DEFAULT_VAULT_REQUEST_TIMEOUT_MS)
}

export type TenantDek = {
  tenantId: string
  key: string // base64
  fetchedAt: number
}

export interface KmsService {
  getTenantDek(tenantId: string): Promise<TenantDek | null>
  createTenantDek(tenantId: string): Promise<TenantDek | null>
  isHealthy(): boolean
  invalidateDek?(tenantId: string): void
}

class FallbackKmsService implements KmsService {
  private notified = false
  constructor(
    private readonly primary: KmsService,
    private readonly fallback: KmsService | null,
    private readonly onFallback?: () => void,
  ) {}

  isHealthy(): boolean {
    return this.primary.isHealthy() || Boolean(this.fallback?.isHealthy?.())
  }

  private notifyFallback() {
    if (this.notified) return
    this.notified = true
    this.onFallback?.()
  }

  private async fromPrimary<T>(op: () => Promise<T | null>): Promise<T | null> {
    try {
      return await op()
    } catch (err) {
      console.warn('⚠️ [encryption][kms] Primary KMS failed, will try fallback', {
        error: (err as Error)?.message || String(err),
      })
      return null
    }
  }

  async getTenantDek(tenantId: string): Promise<TenantDek | null> {
    if (this.primary.isHealthy()) {
      const dek = await this.fromPrimary(() => this.primary.getTenantDek(tenantId))
      if (dek) return dek
    }
    if (this.fallback?.isHealthy()) {
      this.notifyFallback()
      return this.fallback.getTenantDek(tenantId)
    }
    return null
  }

  async createTenantDek(tenantId: string): Promise<TenantDek | null> {
    if (this.primary.isHealthy()) {
      const dek = await this.fromPrimary(() => this.primary.createTenantDek(tenantId))
      if (dek) return dek
    }
    if (this.fallback?.isHealthy()) {
      this.notifyFallback()
      return this.fallback.createTenantDek(tenantId)
    }
    return null
  }

  invalidateDek(tenantId: string): void {
    this.primary.invalidateDek?.(tenantId)
    this.fallback?.invalidateDek?.(tenantId)
  }
}

type VaultClientOpts = {
  vaultAddr?: string
  vaultToken?: string
  mountPath?: string
  ttlMs?: number
  requestTimeoutMs?: number
}

type VaultReadResponse = {
  data?: { data?: { key?: string; version?: number }; metadata?: Record<string, unknown> }
}

// 'conflict' = a check-and-set write lost to a concurrent writer (normal race
// outcome, Vault still healthy); 'error' = the write genuinely failed.
type VaultWriteOutcome = 'ok' | 'conflict' | 'error'

function normalizeEnv(value: string | undefined): string {
  if (!value) return ''
  return value.trim().replace(/(?:^['"]|['"]$)/g, '')
}

type DerivedSecret = { secret: string; source: 'explicit' | 'dev-default'; envName: string }

function resolveDerivedKeySecret(): DerivedSecret | null {
  const candidates: Array<{ value: string | null; envName: string }> = [
    { value: process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? null, envName: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' },
    { value: process.env.TENANT_DATA_ENCRYPTION_KEY ?? null, envName: 'TENANT_DATA_ENCRYPTION_KEY' },
  ]
  for (const raw of candidates) {
    const normalized = normalizeEnv(raw.value ?? undefined)
    if (normalized) return { secret: normalized, source: 'explicit', envName: raw.envName }
  }
  if (
    process.env.NODE_ENV !== 'production'
    && parseBooleanToken(process.env.ALLOW_DERIVED_KMS_FALLBACK) === true
  ) {
    return { secret: 'om-dev-tenant-encryption', source: 'dev-default', envName: 'DEV_DEFAULT' }
  }
  return null
}

export class NoopKmsService implements KmsService {
  isHealthy(): boolean { return !isTenantDataEncryptionEnabled() }
  async getTenantDek(): Promise<TenantDek | null> { return null }
  async createTenantDek(): Promise<TenantDek | null> { return null }
}

class DerivedKmsService implements KmsService {
  private root: Buffer
  constructor(secret: string) {
    // Derive a stable root key from the provided secret so derived tenant keys are deterministic
    this.root = crypto.createHash('sha256').update(secret).digest()
  }

  isHealthy(): boolean {
    return true
  }

  private deriveKey(tenantId: string): string {
    const iterations = 310_000
    const keyLength = 32
    const derived = crypto.pbkdf2Sync(this.root, tenantId, iterations, keyLength, 'sha512')
    return derived.toString('base64')
  }

  async getTenantDek(tenantId: string): Promise<TenantDek | null> {
    if (!tenantId) return null
    return { tenantId, key: this.deriveKey(tenantId), fetchedAt: Date.now() }
  }

  async createTenantDek(tenantId: string): Promise<TenantDek | null> {
    return this.getTenantDek(tenantId)
  }
}

export class HashicorpVaultKmsService implements KmsService {
  private cache = new Map<string, TenantDek>()
  private readonly vaultAddr: string
  private readonly vaultToken: string
  private readonly mountPath: string
  private readonly ttlMs: number
  private readonly requestTimeoutMs: number
  private healthy = true
  private readonly debugEnabled: boolean
  private static loggedInit = false

  constructor(opts: VaultClientOpts = {}) {
    this.vaultAddr = normalizeEnv(opts.vaultAddr || process.env.VAULT_ADDR || '')
    this.vaultToken = normalizeEnv(opts.vaultToken || process.env.VAULT_TOKEN || '')
    this.mountPath = (opts.mountPath || process.env.VAULT_KV_PATH || 'secret/data').replace(/\/+$/, '')
    this.ttlMs = opts.ttlMs ?? 15 * 60 * 1000
    this.requestTimeoutMs = resolveTimeoutMs(opts.requestTimeoutMs, resolveVaultRequestTimeoutMs())
    this.debugEnabled = isEncryptionDebugEnabled()
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false
      if (this.debugEnabled) {
        console.warn('⚠️ [encryption][kms] Vault misconfigured (missing VAULT_ADDR or VAULT_TOKEN)')
      }
    }
    if (this.healthy && !HashicorpVaultKmsService.loggedInit && this.debugEnabled) {
      HashicorpVaultKmsService.loggedInit = true
      if(this.debugEnabled) {
        console.info('🔐 [encryption][kms] Hashicorp Vault KMS enabled')
      }
    }
  }

  isHealthy(): boolean {
    return this.healthy
  }

  private now(): number {
    return Date.now()
  }

  private cacheHit(tenantId: string): TenantDek | null {
    const entry = this.cache.get(tenantId)
    if (!entry) return null
    if (this.now() - entry.fetchedAt > this.ttlMs) {
      this.cache.delete(tenantId)
      return null
    }
    return entry
  }

  private async readVault(path: string): Promise<VaultReadResponse | null> {
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false
      return null
    }
    try {
      const res = await fetchWithTimeout(`${this.vaultAddr}/v1/${path}`, {
        method: 'GET',
        headers: { 'X-Vault-Token': this.vaultToken },
        timeoutMs: this.requestTimeoutMs,
      })
      if (!res.ok) {
        this.healthy = res.status < 500
        console.warn('⚠️ [encryption][kms] Vault read failed', { path, status: res.status })
        return null
      }
      if (this.debugEnabled) {
        console.info('🔍 [encryption][kms] Vault read ok', { path })
      }
      return (await res.json()) as VaultReadResponse
    } catch (err) {
      this.healthy = false
      console.warn('⚠️ [encryption][kms] Vault read error', {
        path,
        error: (err as Error)?.message || String(err),
        timeoutMs: this.requestTimeoutMs,
      })
      return null
    }
  }

  private async writeVault(path: string, key: string, opts?: { cas?: number }): Promise<VaultWriteOutcome> {
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false
      return 'error'
    }
    const body: { data: { key: string }; options?: { cas: number } } = { data: { key } }
    if (typeof opts?.cas === 'number') body.options = { cas: opts.cas }
    try {
      const res = await fetchWithTimeout(`${this.vaultAddr}/v1/${path}`, {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.vaultToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        timeoutMs: this.requestTimeoutMs,
      })
      if (res.ok) {
        this.healthy = true
        return 'ok'
      }
      // KV v2 returns 400 when a check-and-set write loses to a concurrent
      // writer (path already at a newer version). That is a normal race outcome,
      // not an unhealthy Vault — don't flip `healthy`.
      if (typeof opts?.cas === 'number' && res.status === 400) {
        console.warn('⚠️ [encryption][kms] Vault write CAS conflict (concurrent DEK create)', { path, status: res.status })
        return 'conflict'
      }
      this.healthy = false
      console.warn('⚠️ [encryption][kms] Vault write failed', { path, status: res.status })
      return 'error'
    } catch (err) {
      this.healthy = false
      console.warn('⚠️ [encryption][kms] Vault write error', {
        path,
        error: (err as Error)?.message || String(err),
        timeoutMs: this.requestTimeoutMs,
      })
      return 'error'
    }
  }

  private buildKeyPath(tenantId: string): string {
    const suffix = `tenant_key_${tenantId}`
    const normalizedMount = this.mountPath.replace(/^\/+/, '')
    return `${normalizedMount}/${suffix}`
  }

  private remember(entry: TenantDek): TenantDek {
    this.cache.set(entry.tenantId, entry)
    return entry
  }

  async getTenantDek(tenantId: string): Promise<TenantDek | null> {
    const cached = this.cacheHit(tenantId)
    if (cached) return cached
    const path = this.buildKeyPath(tenantId)
    const res = await this.readVault(path)
    const key = res?.data?.data?.key
    if (!key) {
      console.warn('⚠️ [encryption][kms] No tenant DEK found in Vault', { tenantId, path })
      return null
    }
    const dek: TenantDek = { tenantId, key, fetchedAt: this.now() }
    return this.remember(dek)
  }

  async createTenantDek(tenantId: string): Promise<TenantDek | null> {
    const path = this.buildKeyPath(tenantId)
    // Read-before-write: if a DEK already exists for this tenant (another request
    // or process created it first), adopt it instead of overwriting the active
    // key — overwriting orphans every row already encrypted under it (#2746).
    const existing = await this.readVault(path)
    const existingKey = existing?.data?.data?.key
    if (existingKey) {
      return this.remember({ tenantId, key: existingKey, fetchedAt: this.now() })
    }
    // A read failure (timeout / 5xx) flips `healthy` off; don't blind-write a new
    // key over a possibly-existing one we just couldn't read — let the caller fall back.
    if (!this.healthy) return null
    const key = generateDek()
    const outcome = await this.writeVault(path, key, { cas: 0 })
    if (outcome === 'ok') {
      console.info('🔑 [encryption][kms] Stored tenant DEK in Vault', { tenantId, path })
      return this.remember({ tenantId, key, fetchedAt: this.now() })
    }
    if (outcome === 'conflict') {
      // A concurrent create won the CAS race — adopt the winner's key so both
      // callers encrypt under the same DEK.
      const winner = await this.readVault(path)
      const winnerKey = winner?.data?.data?.key
      if (winnerKey) {
        console.info('🔑 [encryption][kms] Adopted concurrently-created tenant DEK', { tenantId, path })
        return this.remember({ tenantId, key: winnerKey, fetchedAt: this.now() })
      }
    }
    console.warn('⚠️ [encryption][kms] Failed to store tenant DEK in Vault', { tenantId, path })
    return null
  }

  invalidateDek(tenantId: string): void {
    this.cache.delete(tenantId)
  }
}

let loggedDerivedKeyFallbackBanner = false

function fingerprintSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16)
}

export function buildDerivedKeyFallbackBannerLines(opts: DerivedSecret): string[] {
  const sourceLine =
    opts.source === 'explicit' ? `Source: ${opts.envName}` : 'Source: dev default secret (do NOT use in production)'
  return [
    '🚨 Using derived tenant encryption keys (Vault unavailable / no DEK)',
    sourceLine,
    `Secret fingerprint (sha256, truncated): ${fingerprintSecret(opts.secret)}`,
    'Persist this secret securely. Without it, encrypted tenant data cannot be recovered after restart.',
  ]
}

function logDerivedKeyFallbackBanner(opts: DerivedSecret): void {
  if (process.env.NODE_ENV === 'test' || loggedDerivedKeyFallbackBanner) return
  loggedDerivedKeyFallbackBanner = true
  const redBg = '\x1b[41m'
  const white = '\x1b[97m'
  const reset = '\x1b[0m'
  const width = 110
  const border = `${redBg}${white}${'━'.repeat(width)}${reset}`
  const body = buildDerivedKeyFallbackBannerLines(opts)
  console.warn(border)
  for (const line of body) {
    const padded = line.padEnd(width - 2, ' ')
    console.warn(`${redBg}${white} ${padded} ${reset}`)
  }
  console.warn(border)
}

export function createKmsService(): KmsService {
  if (!isTenantDataEncryptionEnabled()) return new NoopKmsService()
  const primary = new HashicorpVaultKmsService()

  const derived = resolveDerivedKeySecret()
  const fallback = derived ? new DerivedKmsService(derived.secret) : null
  const notifyFallback = derived
    ? () => {
        logDerivedKeyFallbackBanner(derived)
      }
    : undefined

  if (!primary.isHealthy()) {
    if (fallback) {
      notifyFallback?.()
      return fallback
    }
    console.warn(
      '⚠️ [encryption][kms] Vault not healthy or misconfigured (missing VAULT_ADDR/VAULT_TOKEN) and no fallback secret provided; falling back to noop KMS',
    )
    return new NoopKmsService()
  }

  if (fallback) {
    return new FallbackKmsService(primary, fallback, notifyFallback)
  }

  return primary
}

export { hashForLookup }
