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

export class NoopKmsService implements KmsService {
  isHealthy(): boolean { return !isTenantDataEncryptionEnabled() }
  async getTenantDek(): Promise<TenantDek | null> { return null }
  async createTenantDek(): Promise<TenantDek | null> { return null }
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

export function createKmsService(): KmsService {
  if (!isTenantDataEncryptionEnabled()) return new NoopKmsService()
  const svc = new HashicorpVaultKmsService()
  if (!svc.isHealthy()) {
    console.warn('⚠️ [encryption][kms] Vault not healthy or misconfigured (missing VAULT_ADDR/VAULT_TOKEN); falling back to noop KMS')
    return new NoopKmsService()
  }
  return svc
}

export { hashForLookup }
