import crypto from 'node:crypto'
import { generateDek } from './aes'
import { isEncryptionDebugEnabled, isTenantDataEncryptionEnabled } from './toggles'

export type TenantDek = {
  tenantId: string
  key: string // base64
  fetchedAt: number
}

export interface KmsService {
  getTenantDek(tenantId: string): Promise<TenantDek | null>
  createTenantDek(tenantId: string): Promise<TenantDek | null>
  isHealthy(): boolean
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
}

type VaultClientOpts = {
  vaultAddr?: string
  vaultToken?: string
  mountPath?: string
  ttlMs?: number
}

type VaultReadResponse = {
  data?: { data?: { key?: string; version?: number }; metadata?: Record<string, unknown> }
}

function normalizeEnv(value: string | undefined): string {
  if (!value) return ''
  return value.trim().replace(/^['"]|['"]$/g, '')
}

type DerivedSecret = { secret: string; source: 'explicit' | 'dev-default'; envName: string }

function resolveDerivedKeySecret(): DerivedSecret | null {
  const candidates: Array<{ value: string | null; envName: string }> = [
    { value: process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? null, envName: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' },
    { value: process.env.TENANT_DATA_ENCRYPTION_KEY ?? null, envName: 'TENANT_DATA_ENCRYPTION_KEY' },
    { value: process.env.AUTH_SECRET ?? null, envName: 'AUTH_SECRET' },
    { value: process.env.NEXTAUTH_SECRET ?? null, envName: 'NEXTAUTH_SECRET' },
  ]
  for (const raw of candidates) {
    const normalized = normalizeEnv(raw.value ?? undefined)
    if (normalized) return { secret: normalized, source: 'explicit', envName: raw.envName }
  }
  if (process.env.NODE_ENV !== 'production') {
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
    const derived = crypto.createHmac('sha256', this.root).update(tenantId).digest()
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
  private healthy = true
  private readonly debugEnabled: boolean
  private static loggedInit = false

  constructor(opts: VaultClientOpts = {}) {
    this.vaultAddr = normalizeEnv(opts.vaultAddr || process.env.VAULT_ADDR || '')
    this.vaultToken = normalizeEnv(opts.vaultToken || process.env.VAULT_TOKEN || '')
    this.mountPath = (opts.mountPath || process.env.VAULT_KV_PATH || 'secret/data').replace(/\/+$/, '')
    this.ttlMs = opts.ttlMs ?? 15 * 60 * 1000
    this.debugEnabled = isEncryptionDebugEnabled()
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false
      console.warn('⚠️ [encryption][kms] Vault misconfigured (missing VAULT_ADDR or VAULT_TOKEN)')
    }
    if (this.healthy && !HashicorpVaultKmsService.loggedInit && this.debugEnabled) {
      HashicorpVaultKmsService.loggedInit = true
      console.info('🔐 [encryption][kms] Hashicorp Vault KMS enabled')
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
      const res = await fetch(`${this.vaultAddr}/v1/${path}`, {
        method: 'GET',
        headers: { 'X-Vault-Token': this.vaultToken },
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
      console.warn('⚠️ [encryption][kms] Vault read error', { path, error: (err as Error)?.message || String(err) })
      return null
    }
  }

  private async writeVault(path: string, key: string): Promise<boolean> {
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false
      return false
    }
    try {
      const res = await fetch(`${this.vaultAddr}/v1/${path}`, {

        method: 'POST',
        headers: {
          'X-Vault-Token': this.vaultToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { key } }),
      })
      this.healthy = res.ok
      if (!res.ok) {
        console.warn('⚠️ [encryption][kms] Vault write failed', { path, status: res.status })
      }
      return res.ok
    } catch (err) {
      this.healthy = false
      console.warn('⚠️ [encryption][kms] Vault write error', { path, error: (err as Error)?.message || String(err) })
      return false
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
    const key = generateDek()
    const path = this.buildKeyPath(tenantId)
    const ok = await this.writeVault(path, key)
    if (ok) {
      console.info('🔑 [encryption][kms] Stored tenant DEK in Vault', { tenantId, path })
    } else {
      console.warn('⚠️ [encryption][kms] Failed to store tenant DEK in Vault', { tenantId, path })
    }
    if (!ok) return null
    return this.remember({ tenantId, key, fetchedAt: this.now() })
  }
}

let loggedDerivedKeyBanner = false

function logDerivedKeyBanner(opts: DerivedSecret): void {
  if (loggedDerivedKeyBanner) return
  loggedDerivedKeyBanner = true
  const redBg = '\x1b[41m'
  const white = '\x1b[97m'
  const reset = '\x1b[0m'
  const width = 110
  const border = `${redBg}${white}${'━'.repeat(width)}${reset}`
  const body = [
    '🚨 Using derived tenant encryption keys (Vault unavailable)',
    opts.source === 'explicit'
      ? `Source: ${opts.envName}`
      : 'Source: dev default secret (do NOT use in production)',
    `Secret: ${opts.secret}`,
    'Persist this secret securely. Without it, encrypted tenant data cannot be recovered after restart.',
  ]
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
        const level = derived.source === 'dev-default' ? 'warn' : 'info'
        console[level](
          `⚠️ [encryption][kms] Vault unavailable; using derived tenant keys (${derived.source === 'dev-default' ? 'dev default' : 'env-provided'} secret).`,
        )
        logDerivedKeyBanner(derived)
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
