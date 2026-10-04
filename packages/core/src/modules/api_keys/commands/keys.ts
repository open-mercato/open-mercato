import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { deleteApiKey } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'

type DeleteApiKeyInput = {
  id: string
}

export const deleteApiKeyCommand: CommandHandler<DeleteApiKeyInput, { id: string }> = {
  id: 'api_keys.keys.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const tenantId = ctx.auth?.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, {
        error: translate('api_keys.errors.tenantRequired', 'Tenant context required'),
      })
    }
    const em = ctx.transactionalEm ?? ctx.container.resolve('em') as EntityManager
    const isSuperAdmin = await resolveIsSuperAdmin(ctx)
    const allowedOrganizationIds = ctx.organizationScope?.allowedIds ?? null
    let rbac: RbacService | undefined
    try {
      rbac = ctx.container.resolve('rbacService') as RbacService
    } catch {
      rbac = undefined
    }
    const deleted = await deleteApiKey(em, input.id, {
      rbac,
      authorize: (record) => {
        if (
          record.tenantId !== tenantId
          || !isOrganizationAccessAllowed({
            isSuperAdmin,
            allowedOrganizationIds,
            targetOrganizationId: record.organizationId ?? null,
          })
        ) {
          throw new CrudHttpError(404, {
            error: translate('api_keys.errors.notFound', 'Not found'),
          })
        }
      },
    })
    if (!deleted) {
      throw new CrudHttpError(404, {
        error: translate('api_keys.errors.notFound', 'Not found'),
      })
    }
    return { id: input.id }
  },
  buildLog: async ({ input, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('api_keys.list.success.deleted', 'API key deleted'),
      resourceKind: 'api_keys.key',
      resourceId: input.id,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(deleteApiKeyCommand)
