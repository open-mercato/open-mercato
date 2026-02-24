import { randomBytes } from 'node:crypto'
import { EntityManager } from '@mikro-orm/postgresql'
import { hash, compare } from 'bcryptjs'
import { ScimToken } from '../data/entities'
import type { SsoAdminScope } from './ssoConfigService'

const BCRYPT_COST = 10
const TOKEN_PREFIX = 'omscim_'

export interface ScimTokenPublic {
  id: string
  ssoConfigId: string
  name: string
  tokenPrefix: string
  isActive: boolean
  createdBy: string | null
  createdAt: Date
}

export interface ScimTokenCreateResult {
  id: string
  token: string
  prefix: string
  name: string
}

export class ScimTokenService {
  constructor(private em: EntityManager) {}

  async generateToken(
    ssoConfigId: string,
    name: string,
    scope: SsoAdminScope,
  ): Promise<ScimTokenCreateResult> {
    const raw = TOKEN_PREFIX + randomBytes(32).toString('hex')
    const tokenHash = await hash(raw, BCRYPT_COST)
    const tokenPrefix = raw.slice(0, 12)

    const token = this.em.create(ScimToken, {
      ssoConfigId,
      name,
      tokenHash,
      tokenPrefix,
      isActive: true,
      createdBy: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId!,
    } as any)

    await this.em.persistAndFlush(token)

    return { id: token.id, token: raw, prefix: tokenPrefix, name }
  }

  async verifyToken(rawToken: string): Promise<{
    ssoConfigId: string
    organizationId: string
    tenantId: string | null
  } | null> {
    const prefix = rawToken.slice(0, 12)

    const candidates = await this.em.find(ScimToken, {
      tokenPrefix: prefix,
      isActive: true,
    })

    if (candidates.length === 0) {
      await hash(rawToken, BCRYPT_COST)
      return null
    }

    for (const candidate of candidates) {
      const isValid = await compare(rawToken, candidate.tokenHash)
      if (isValid) {
        return {
          ssoConfigId: candidate.ssoConfigId,
          organizationId: candidate.organizationId,
          tenantId: candidate.tenantId ?? null,
        }
      }
    }

    return null
  }

  async revokeToken(tokenId: string, scope: SsoAdminScope): Promise<void> {
    const where: Record<string, unknown> = { id: tokenId }
    if (!scope.isSuperAdmin) where.organizationId = scope.organizationId

    const token = await this.em.findOne(ScimToken, where)
    if (!token) throw new ScimTokenError('SCIM token not found', 404)

    token.isActive = false
    await this.em.flush()
  }

  async listTokens(ssoConfigId: string, scope: SsoAdminScope): Promise<ScimTokenPublic[]> {
    const where: Record<string, unknown> = { ssoConfigId }
    if (!scope.isSuperAdmin) where.organizationId = scope.organizationId

    const tokens = await this.em.find(ScimToken, where, {
      orderBy: { createdAt: 'desc' },
    })

    return tokens.map((t) => ({
      id: t.id,
      ssoConfigId: t.ssoConfigId,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      isActive: t.isActive,
      createdBy: t.createdBy ?? null,
      createdAt: t.createdAt,
    }))
  }
}

export class ScimTokenError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ScimTokenError'
  }
}
