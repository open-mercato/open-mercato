import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function ensureDocumentNumberEditPermission(
  ctx: Pick<CommandRuntimeContext, 'auth' | 'container' | 'request' | 'systemActor'>,
  { tenantId, organizationId }: { tenantId: string | null; organizationId: string | null },
): Promise<void> {
  if (ctx.systemActor === true && !ctx.auth && !ctx.request) return

  const actorId = ctx.auth?.sub
  if (actorId) {
    const rbac = ctx.container.resolve<RbacService | undefined>('rbacService', { allowUnregistered: true })
    if (await rbac?.userHasAllFeatures(actorId, ['sales.documents.number.edit'], { tenantId, organizationId })) return
  }

  const { translate } = await resolveTranslations()
  throw forbidden(translate('sales.documents.errors.number_edit_forbidden', 'Document number cannot be edited.'))
}
