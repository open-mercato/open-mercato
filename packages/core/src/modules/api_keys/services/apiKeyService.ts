import { randomBytes, createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '../data/entities'

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

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export async function createApiKey(
  em: EntityManager,
  input: CreateApiKeyInput,
  opts: { rbac?: RbacService } = {},
): Promise<ApiKeyWithSecret> {
  const { secret, prefix } = generateApiKeySecret()
  const record = em.create(ApiKey, {
    name: input.name,
    description: input.description ?? null,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    keyHash: hashApiKey(secret),
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
  const hash = hashApiKey(secret)
  const record = await em.findOne(ApiKey, { keyHash: hash, deletedAt: null })
  if (!record) return null
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null
  return record
}
