import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { Knex } from 'knex'

export type TranslationsRouteContext = {
  container: AwilixContainer
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  em: EntityManager
  knex: Knex
  organizationId: string | null
  tenantId: string
  commandCtx: CommandRuntimeContext
}

export async function resolveTranslationsRouteContext(req: Request): Promise<TranslationsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager
  const knex = (em as unknown as { getConnection(): { getKnex(): Knex } }).getConnection().getKnex()
  const tenantId: string = scope?.tenantId ?? auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId ?? null

  const commandCtx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return {
    container,
    auth,
    em,
    knex,
    organizationId,
    tenantId,
    commandCtx,
  }
}

export async function requireTranslationFeatures(
  context: TranslationsRouteContext,
  requiredFeatures: string[],
): Promise<void> {
  if (!requiredFeatures.length) return
  const subject = context.auth.sub
  if (!subject) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const rbacService = context.container.resolve('rbacService') as {
    userHasAllFeatures(
      userId: string,
      required: string[],
      scope: { tenantId: string | null; organizationId: string | null },
    ): Promise<boolean>
  }
  const hasFeatures = await rbacService.userHasAllFeatures(subject, requiredFeatures, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  })
  if (!hasFeatures) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}
