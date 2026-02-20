import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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

  return {
    container,
    auth,
    em,
    knex,
    organizationId,
    tenantId,
  }
}
