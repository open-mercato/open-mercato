import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateFn } from '@open-mercato/shared/lib/api/scoped'

export type CommandRouteContext = {
  ctx: CommandRuntimeContext
  translate: TranslateFn
  commandBus: CommandBus
}

export async function buildCommandRouteContext(req: Request): Promise<CommandRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }

  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
    organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const commandBus = container.resolve('commandBus') as CommandBus

  return {
    ctx,
    translate,
    commandBus,
  }
}
