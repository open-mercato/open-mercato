import { randomBytes } from 'node:crypto'
import type { CacheStrategy } from '@open-mercato/cache'
import { runWithCacheTenant } from '@open-mercato/cache'
import { readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { SCIM_ADMISSION_TTL_MS, scimAdmissionCacheKey, scimAdmissionTokenTag, scimAdmissionTokenKey, scimTokenLookupHash } from '../lib/scim-admission-cache'
import type { RequiredEntityData } from '@mikro-orm/core'
import { EntityManager } from '@mikro-orm/postgresql'
import { hash, compare } from 'bcryptjs'
import { ScimToken, SsoConfig } from '../data/entities'
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
  constructor(private em: EntityManager, private cache?: CacheStrategy) {}

  async generateToken(
    ssoConfigId: string,
    name: string,
    scope: SsoAdminScope,
  ): Promise<ScimTokenCreateResult> {
    const where: Record<string, unknown> = { id: ssoConfigId, deletedAt: null }
    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) throw new ScimTokenError('Organization context is required', 403)
      where.organizationId = scope.organizationId
    }
    const config = await this.em.findOne(SsoConfig, where)
    if (!config) throw new ScimTokenError('SSO configuration not found', 404)
    if (config.jitEnabled) {
      throw new ScimTokenError('Cannot create SCIM tokens while JIT provisioning is enabled. Disable JIT first.', 409)
    }

    const raw = TOKEN_PREFIX + randomBytes(32).toString('hex')
    const tokenHash = await hash(raw, BCRYPT_COST)
    const tokenPrefix = raw.slice(0, 12)

    try {
      const token = this.em.create(ScimToken, {
        ssoConfigId,
        name,
        tokenHash,
        tokenLookupHash: scimTokenLookupHash(raw),
        tokenPrefix,
        isActive: true,
        createdBy: null,
        tenantId: config.tenantId ?? null,
        organizationId: config.organizationId,
      } as RequiredEntityData<ScimToken>)
      await this.em.persist(token).flush()
      return { id: token.id, token: raw, prefix: tokenPrefix, name }
    } catch {
      const error = new Error('[internal] SCIM token persistence unavailable')
      try {
        getTelemetryRuntime()?.reportError(error, { module: 'sso', code: 'sso.scim_token_persistence_unavailable' })
      } catch {}
      throw error
    }
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
      const tokenHash = candidate.tokenHash
      const isValid = await compare(rawToken, tokenHash)
      if (isValid) {
        if (candidate.tokenLookupHash == null) {
          const tokenLookupHash = scimTokenLookupHash(rawToken)
          const updated = await this.em.nativeUpdate(ScimToken, {
            id: candidate.id,
            tenantId: candidate.tenantId ?? null,
            organizationId: candidate.organizationId,
            ssoConfigId: candidate.ssoConfigId,
            tokenHash,
            isActive: true,
            $or: [{ tokenLookupHash: null }, { tokenLookupHash }],
          }, { tokenLookupHash }).catch(() => {
            const error = new ScimTokenError('[internal] SCIM token enrollment unavailable', 503)
            try {
              getTelemetryRuntime()?.reportError(error, { module: 'sso', code: 'sso.scim_enrollment_unavailable' })
            } catch {}
            throw error
          })
          if (updated === 0) return null
        }
        const cache = this.cache
        if (cache && readRateLimitConfig().enabled) {
          try {
            await runWithCacheTenant(null, () => cache.set(
              scimAdmissionCacheKey(rawToken),
              scimAdmissionTokenKey(candidate),
              { ttl: SCIM_ADMISSION_TTL_MS, tags: [scimAdmissionTokenTag(candidate.id)] },
            ))
          } catch (error) {
            try {
              getTelemetryRuntime()?.reportError(error, { module: 'sso', code: 'sso.scim_admission_cache_write_failed' })
            } catch {}
          }
        }
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
    const cache = this.cache
    if (cache) {
      try {
        await runWithCacheTenant(null, () => cache.deleteByTags([scimAdmissionTokenTag(token.id)]))
      } catch (error) {
        try {
          getTelemetryRuntime()?.reportError(error, { module: 'sso', code: 'sso.scim_admission_cache_invalidation_failed' })
        } catch {}
      }
    }
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
