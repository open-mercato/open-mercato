import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { SudoChallengeConfig } from '../../data/entities'
import type { SudoChallengeService, SudoChallengeServiceError } from '../../services/SudoChallengeService'
import { isSudoRequiredError } from '../../lib/sudo-middleware'
import { localizeSecurityApiBody, securityApiError } from '../i18n'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type SudoRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  sudoChallengeService: SudoChallengeService
}

export function toSudoConfigResponse(config: SudoChallengeConfig) {
  return {
    id: config.id,
    tenantId: config.tenantId ?? null,
    tenantName: null as string | null,
    organizationId: config.organizationId ?? null,
    organizationName: null as string | null,
    label: config.label ?? null,
    targetIdentifier: config.targetIdentifier,
    isEnabled: config.isEnabled,
    isDeveloperDefault: config.isDeveloperDefault,
    ttlSeconds: config.ttlSeconds,
    challengeMethod: config.challengeMethod,
    configuredBy: config.configuredBy ?? null,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

export async function attachSudoConfigScopeNames(
  container: RequestContainer,
  configs: SudoChallengeConfig[],
): Promise<Array<ReturnType<typeof toSudoConfigResponse>>> {
  if (configs.length === 0) return []

  const em = container.resolve<EntityManager>('em')
  const tenantIds = Array.from(
    new Set(
      configs
        .map((c) => c.tenantId ?? null)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const organizationIds = Array.from(
    new Set(
      configs
        .map((c) => c.organizationId ?? null)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )

  const [tenants, organizations] = await Promise.all([
    tenantIds.length ? em.find(Tenant, { id: { $in: tenantIds }, deletedAt: null }) : Promise.resolve([]),
    organizationIds.length ? em.find(Organization, { id: { $in: organizationIds }, deletedAt: null }) : Promise.resolve([]),
  ])

  const tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
    const id = tenant?.id ? String(tenant.id) : null
    if (!id) return acc
    acc[id] = typeof tenant.name === 'string' && tenant.name.length > 0 ? tenant.name : id
    return acc
  }, {})
  const organizationMap = organizations.reduce<Record<string, string>>((acc, org) => {
    const id = org?.id ? String(org.id) : null
    if (!id) return acc
    acc[id] = typeof org.name === 'string' && org.name.length > 0 ? org.name : id
    return acc
  }, {})

  return configs.map((config) => {
    const response = toSudoConfigResponse(config)
    return {
      ...response,
      tenantName: response.tenantId ? tenantMap[response.tenantId] ?? response.tenantId : null,
      organizationName: response.organizationId ? organizationMap[response.organizationId] ?? response.organizationId : null,
    }
  })
}

export async function resolveSudoContext(req: Request): Promise<SudoRequestContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return securityApiError(401, 'Unauthorized')
  }

  const container = await createRequestContainer()
  return {
    auth,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
      request: req,
    },
    sudoChallengeService: container.resolve<SudoChallengeService>('sudoChallengeService'),
  }
}

export async function mapSudoError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  if (isSudoRequiredError(error)) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.statusCode })
  }
  if (isSudoChallengeServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }
  console.error('security.sudo.route failure', error)
  return securityApiError(500, 'Failed to process sudo request.')
}

function isSudoChallengeServiceError(error: unknown): error is SudoChallengeServiceError {
  return error instanceof Error
    && error.name === 'SudoChallengeServiceError'
    && typeof (error as Partial<SudoChallengeServiceError>).statusCode === 'number'
}
