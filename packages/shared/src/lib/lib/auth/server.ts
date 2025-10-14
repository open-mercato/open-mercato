import { cookies } from 'next/headers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { verifyJwt } from './jwt'

export type AuthContext = {
  sub: string
  tenantId: string | null
  orgId: string | null
  email?: string
  roles?: string[]
  isApiKey?: boolean
  keyId?: string
  keyName?: string
  [k: string]: any
} | null

async function resolveApiKeyAuth(secret: string): Promise<AuthContext> {
  if (!secret) return null
  try {
    const { createRequestContainer } = await import('@/lib/di/container')
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const { findApiKeyBySecret } = await import('@open-mercato/core/modules/api_keys/services/apiKeyService')
    const { Role } = await import('@open-mercato/core/modules/auth/data/entities')

    const record = await findApiKeyBySecret(em, secret)
    if (!record) return null

    const roleIds = Array.isArray(record.rolesJson) ? record.rolesJson : []
    const roles = roleIds.length
      ? await em.find(Role, { id: { $in: roleIds as any } } as any)
      : []
    const roleNames = roles.map((role) => role.name).filter((name): name is string => typeof name === 'string' && name.length > 0)

    try {
      record.lastUsedAt = new Date()
      await em.persistAndFlush(record)
    } catch {}

    return {
      sub: `api_key:${record.id}`,
      tenantId: record.tenantId ?? null,
      orgId: record.organizationId ?? null,
      roles: roleNames,
      isApiKey: true,
      keyId: record.id,
      keyName: record.name,
    }
  } catch {
    return null
  }
}

function extractApiKey(req: Request): string | null {
  const header = (req.headers.get('x-api-key') || '').trim()
  if (header) return header
  const authHeader = (req.headers.get('authorization') || '').trim()
  if (authHeader.toLowerCase().startsWith('apikey ')) {
    return authHeader.slice(7).trim()
  }
  return null
}

export async function getAuthFromCookies(): Promise<AuthContext> {
  const token = (await cookies()).get('auth_token')?.value
  if (!token) return null
  try {
    const payload = verifyJwt(token)
    return payload
  } catch {
    return null
  }
}

export async function getAuthFromRequest(req: Request): Promise<AuthContext> {
  const authHeader = (req.headers.get('authorization') || '').trim()
  let token: string | undefined
  if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim()
  if (!token) {
    const cookie = req.headers.get('cookie') || ''
    const match = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) token = decodeURIComponent(match[1])
  }
  if (token) {
    try {
      const payload = verifyJwt(token)
      if (payload) return payload
    } catch {}
  }

  const apiKey = extractApiKey(req)
  if (!apiKey) return null
  return resolveApiKeyAuth(apiKey)
}
