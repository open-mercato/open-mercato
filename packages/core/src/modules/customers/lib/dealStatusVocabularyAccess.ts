import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export async function requireTenantDealStatusManageAccess(ctx: CommandRuntimeContext): Promise<string> {
  const { translate } = await resolveTranslations()
  if (!ctx.auth?.tenantId || !ctx.auth.sub) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }
  const rbac = ctx.container.resolve('rbacService') as RbacService
  const access = await rbac.resolveFeatureOrganizationAccess(ctx.auth.sub, ['customers.deals.manage'], {
    tenantId: ctx.auth.tenantId,
  })
  if (!access.unrestricted) {
    throw new CrudHttpError(403, {
      error: translate('customers.settings.dealStatusVocabulary.tenantAccessRequired', 'Managing deal status vocabulary requires deal management access to all organizations in this tenant.'),
    })
  }
  return ctx.auth.tenantId
}
