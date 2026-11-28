import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { buildSudoAuthScopeFromAuth } from '../../commands/sudoConfig.shared'
import type { SudoChallengeConfig } from '../../data/entities'
import type { SudoAuthScope } from '../../lib/sudo-config-scope'
import { isSudoRequiredError, requireSudo } from '../../lib/sudo-middleware'
import type { SudoChallengeService, SudoChallengeServiceError } from '../../services/SudoChallengeService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('security').child({ component: 'sudo' })

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type SudoRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  sudoChallengeService: SudoChallengeService
  scope: SudoAuthScope
}

export function buildSudoAuthScope(auth: Auth): SudoAuthScope {
  return buildSudoAuthScopeFromAuth(auth)
}

export const sudoConfigItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  label: z.string().nullable(),
  targetIdentifier: z.string(),
  isEnabled: z.boolean(),
  isDeveloperDefault: z.boolean(),
  ttlSeconds: z.number().int(),
  challengeMethod: z.string(),
  configuredBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

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
  const items = configs.map(toSudoConfigResponse)
  if (!items.length) return items

  const tenantIds = new Set<string>()
  const organizationIds = new Set<string>()
  for (const item of items) {
    if (item.tenantId) tenantIds.add(item.tenantId)
    if (item.organizationId) organizationIds.add(item.organizationId)
  }
  const em = container.resolve<EntityManager>('em')
  const [tenants, organizations] = await Promise.all([
    tenantIds.size ? em.find(Tenant, { id: { $in: [...tenantIds] }, deletedAt: null }) : [],
    organizationIds.size ? em.find(Organization, { id: { $in: [...organizationIds] }, deletedAt: null }) : [],
  ])
  const tenantNames = new Map(tenants.map(({ id, name }) => [id, name || id] as const))
  const organizationNames = new Map(organizations.map(({ id, name }) => [id, name || id] as const))

  return items.map((item) => ({
    ...item,
    tenantName: item.tenantId ? tenantNames.get(item.tenantId) ?? item.tenantId : null,
    organizationName: item.organizationId ? organizationNames.get(item.organizationId) ?? item.organizationId : null,
  }))
}

export async function resolveSudoContext(req: Request): Promise<SudoRequestContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return securityApiError(401, 'Unauthorized')
  }

  const container = await createRequestContainer()
  const scope = buildSudoAuthScope(auth)
  const organizationId = scope.organizationId ?? null
  return {
    auth,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: organizationId ? [organizationId] : null,
      request: req,
    },
    sudoChallengeService: container.resolve<SudoChallengeService>('sudoChallengeService'),
    scope,
  }
}

export async function parseSudoConfigBody<T>(req: Request, schema: z.ZodType<T>) {
  const body = await readJsonSafe<unknown>(req, {}).catch(() => ({}))
  return schema.safeParse(body)
}

export async function executeSudoConfigMutation(
  req: Request,
  context: SudoRequestContext,
  commandId: `security.sudo.config.${'create' | 'update' | 'delete'}`,
  input: unknown,
  status: 200 | 201 = 200,
): Promise<NextResponse> {
  try {
    await requireSudo(req, 'security.sudo.manage')
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute(commandId, { input, ctx: context.commandContext })
    return NextResponse.json(result, { status })
  } catch (error) {
    return mapSudoError(error)
  }
}

export async function mapSudoError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(error)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (isSudoRequiredError(error)) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.statusCode })
  }
  if (isSudoChallengeServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }
  logger.error('Sudo route failure', { err: error })
  return securityApiError(500, 'Failed to process sudo request.')
}

function isSudoChallengeServiceError(error: unknown): error is SudoChallengeServiceError {
  return error instanceof Error
    && error.name === 'SudoChallengeServiceError'
    && typeof (error as Partial<SudoChallengeServiceError>).statusCode === 'number'
}
