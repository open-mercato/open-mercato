import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { hash, compare } from 'bcryptjs'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '../data/entities'

const BCRYPT_COST = 10

export type CreateApiKeyInput = {
  name: string
  description?: string | null
  tenantId?: string | null
  organizationId?: string | null
  roles?: string[]
  expiresAt?: Date | null
  createdBy?: string | null
}

export type ApiKeyWithSecret = {
  record: ApiKey
  secret: string
}

export function generateApiKeySecret(): { secret: string; prefix: string } {
  const short = randomBytes(4).toString('hex')
  const body = randomBytes(24).toString('hex')
  const secret = `omk_${short}.${body}`
  const prefix = secret.slice(0, 12)
  return { secret, prefix }
}

export async function hashApiKey(secret: string): Promise<string> {
  return hash(secret, BCRYPT_COST)
}

export async function verifyApiKey(secret: string, keyHash: string): Promise<boolean> {
  return compare(secret, keyHash)
}

export async function createApiKey(
  em: EntityManager,
  input: CreateApiKeyInput,
  opts: { rbac?: RbacService } = {},
): Promise<ApiKeyWithSecret> {
  const { secret, prefix } = generateApiKeySecret()
  const keyHash = await hashApiKey(secret)
  const record = em.create(ApiKey, {
    name: input.name,
    description: input.description ?? null,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    keyHash,
    keyPrefix: prefix,
    rolesJson: Array.isArray(input.roles) ? input.roles : [],
    createdBy: input.createdBy ?? null,
    expiresAt: input.expiresAt ?? null,
    createdAt: new Date(),
  })
  await em.persistAndFlush(record)
  if (opts.rbac) {
    await opts.rbac.invalidateUserCache(`api_key:${record.id}`)
  }
  return { record, secret }
}

export async function deleteApiKey(
  em: EntityManager,
  id: string,
  opts: { rbac?: RbacService } = {},
): Promise<void> {
  const record = await em.findOne(ApiKey, { id })
  if (!record) return
  record.deletedAt = new Date()
  await em.persistAndFlush(record)
  if (opts.rbac) {
    await opts.rbac.invalidateUserCache(`api_key:${record.id}`)
  }
}

export async function findApiKeyBySecret(em: EntityManager, secret: string): Promise<ApiKey | null> {
  if (!secret) return null
  // Extract prefix from the secret for fast candidate lookup
  const prefix = secret.slice(0, 12)
  // Find candidates by prefix (fast index lookup)
  const candidates = await em.find(ApiKey, { keyPrefix: prefix, deletedAt: null })
  // Verify each candidate with bcrypt until we find a match
  for (const candidate of candidates) {
    if (candidate.expiresAt && candidate.expiresAt.getTime() < Date.now()) continue
    const isValid = await verifyApiKey(secret, candidate.keyHash)
    if (isValid) return candidate
  }
  return null
}

// =============================================================================
// Session-scoped API Keys (for AI Chat ephemeral authorization)
// =============================================================================

export type CreateSessionApiKeyInput = {
  sessionToken: string
  userId: string
  userRoles: string[]
  tenantId?: string | null
  organizationId?: string | null
  ttlMinutes?: number
}

/**
 * Generate a unique session token for ephemeral API keys.
 * Format: sess_{32 hex chars}
 */
export function generateSessionToken(): string {
  return `sess_${randomBytes(16).toString('hex')}`
}

/**
 * Create an ephemeral API key scoped to a chat session.
 * The key inherits the user's roles and expires after ttlMinutes (default 30).
 */
export async function createSessionApiKey(
  em: EntityManager,
  input: CreateSessionApiKeyInput
): Promise<{ keyId: string; secret: string; sessionToken: string }> {
  const { secret, prefix } = generateApiKeySecret()
  const ttl = input.ttlMinutes ?? 30
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000)
  const keyHash = await hashApiKey(secret)

  const record = em.create(ApiKey, {
    name: `__session_${input.sessionToken}__`,
    description: 'Ephemeral session API key for AI chat',
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    keyHash,
    keyPrefix: prefix,
    rolesJson: input.userRoles,
    createdBy: input.userId,
    sessionToken: input.sessionToken,
    sessionUserId: input.userId,
    expiresAt,
    createdAt: new Date(),
  })

  await em.persistAndFlush(record)

  return {
    keyId: record.id,
    secret,
    sessionToken: input.sessionToken,
  }
}

/**
 * Find an API key by its session token.
 * Returns null if not found, expired, or deleted.
 */
export async function findApiKeyBySessionToken(
  em: EntityManager,
  sessionToken: string
): Promise<ApiKey | null> {
  if (!sessionToken) return null

  const record = await em.findOne(ApiKey, {
    sessionToken,
    deletedAt: null,
  })

  if (!record) return null
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null

  return record
}

/**
 * Delete an ephemeral API key by its session token.
 */
export async function deleteSessionApiKey(
  em: EntityManager,
  sessionToken: string
): Promise<void> {
  const record = await em.findOne(ApiKey, { sessionToken, deletedAt: null })
  if (!record) return

  record.deletedAt = new Date()
  await em.persistAndFlush(record)
}

/**
 * Execute a function with a one-time API key
 *
 * Creates a temporary API key, executes the function, and deletes the key.
 * Perfect for workflow activities that need authenticated access without
 * storing long-lived credentials.
 *
 * @param em - Entity manager
 * @param input - API key configuration
 * @param fn - Function to execute with the API key secret
 * @returns Result of the function
 */
export async function withOnetimeApiKey<T>(
  em: EntityManager,
  input: CreateApiKeyInput,
  fn: (secret: string) => Promise<T>
): Promise<T> {
  const { record, secret } = await createApiKey(em, {
    ...input,
    name: input.name || '__onetime__',
    description: input.description || 'One-time API key',
  })

  try {
    // Execute the function with the API key
    const result = await fn(secret)
    return result
  } finally {
    // Always delete the API key, even if the function throws
    try {
      await em.removeAndFlush(record)
    } catch (error) {
      // Log but don't throw - we don't want cleanup errors to mask the original error
      console.error('[withOnetimeApiKey] Failed to delete one-time API key:', error)
    }
  }
}
