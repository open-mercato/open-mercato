import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ScimTokenError, ScimTokenService } from '../../services/scimTokenService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import { SsoConfig } from '../../data/entities'
import { buildScimError, scimJson } from '../../lib/scim-response'
import type { EntityManager } from '@mikro-orm/postgresql'
import { checkScimRateLimit } from './rate-limit'

export interface ScimScope {
  ssoConfigId: string
  organizationId: string
  tenantId: string | null
  config: SsoConfig
}

export async function resolveScimContext(req: Request): Promise<
  | { ok: true; scope: ScimScope }
  | { ok: false; response: Response }
> {
  const rateLimitError = await checkScimRateLimit(req)
  if (rateLimitError) return { ok: false, response: rateLimitError }

  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: scimJson(
        buildScimError(401, 'Bearer token required'),
        401,
      ),
    }
  }

  const rawToken = authHeader.slice(7)
  if (!rawToken) {
    return {
      ok: false,
      response: scimJson(buildScimError(401, 'Bearer token required'), 401),
    }
  }

  const container = await createRequestContainer()
  const scimTokenService = container.resolve<ScimTokenService>('scimTokenService')
  let verified: Awaited<ReturnType<ScimTokenService['verifyToken']>>
  try {
    verified = await scimTokenService.verifyToken(rawToken)
  } catch (error) {
    if (!(error instanceof ScimTokenError) || error.statusCode !== 503) throw error
    const { translate } = await resolveTranslations()
    return {
      ok: false,
      response: scimJson(buildScimError(503, translate(RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK)), 503),
    }
  }

  if (!verified) {
    return {
      ok: false,
      response: scimJson(buildScimError(401, 'Invalid or revoked token'), 401),
    }
  }

  const em = container.resolve<EntityManager>('em')
  const config = await em.findOne(SsoConfig, {
    id: verified.ssoConfigId,
    organizationId: verified.organizationId,
    deletedAt: null,
  })

  if (!config) {
    return {
      ok: false,
      response: scimJson(buildScimError(403, 'SSO configuration not found'), 403),
    }
  }

  if (!config.isActive) {
    return {
      ok: false,
      response: scimJson(buildScimError(403, 'SSO configuration is not active'), 403),
    }
  }

  if (config.jitEnabled) {
    return {
      ok: false,
      response: scimJson(buildScimError(403, 'SCIM provisioning is unavailable — JIT provisioning is enabled on this configuration'), 403),
    }
  }

  return {
    ok: true,
    scope: {
      ssoConfigId: config.id,
      organizationId: config.organizationId,
      tenantId: verified.tenantId,
      config,
    },
  }
}
