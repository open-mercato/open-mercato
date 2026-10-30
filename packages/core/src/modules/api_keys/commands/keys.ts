import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { createApiKey, deleteApiKey } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assertActorCanGrantRoles } from '@open-mercato/core/modules/auth/lib/grantChecks'

type DeleteApiKeyInput = {
  id: string
}

export type CreateApiKeyCommandInput = {
  name: string
  description?: string | null
  tenantId: string | null
  organizationId: string | null
  roleIds: string[]
  expiresAt?: Date | null
}

export type CreateApiKeyCommandResult = {
  id: string
  name: string
  keyPrefix: string
  secret: string
  tenantId: string | null
  organizationId: string | null
  roles: Array<{ id: string; name: string | null }>
}

export const createApiKeyCommand: CommandHandler<CreateApiKeyCommandInput, CreateApiKeyCommandResult> = {
  id: 'api_keys.keys.create',
  isUndoable: false,
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const em = ctx.transactionalEm ?? ctx.container.resolve('em') as EntityManager
    const rbacService = ctx.container.resolve('rbacService') as RbacService
    let lockedRoles: Role[] = []
    const { record, secret } = await createApiKey(em, {
      name: input.name,
      description: input.description ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      roles: input.roleIds,
      expiresAt: input.expiresAt ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }, {
      rbac: rbacService,
      authorizeRoles: async (roleIds) => {
        const roleTenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
        lockedRoles = roleIds.length
          ? await findWithDecryption(
              em,
              Role,
              { id: { $in: [...roleIds] }, deletedAt: null },
              { orderBy: { id: 'ASC' }, refresh: true },
              { tenantId: roleTenantId, organizationId: null },
            )
          : []
        if (lockedRoles.length !== roleIds.length) {
          throw new CrudHttpError(400, {
            error: translate('api_keys.errors.roleNotFound', 'Role {identifier} not found', {
              identifier: roleIds.join(', '),
            }),
          })
        }
        const wrongTenantRole = lockedRoles.find((role) => (
          role.tenantId !== null
          && String(role.tenantId) !== roleTenantId
        ))
        if (wrongTenantRole) {
          throw new CrudHttpError(400, {
            error: translate('api_keys.errors.roleWrongTenant', 'Role {role} belongs to another tenant', {
              role: wrongTenantRole.name ?? String(wrongTenantRole.id),
            }),
          })
        }
        await assertActorCanGrantRoles({
          em,
          rbacService,
          actorUserId: ctx.auth?.sub,
          tenantId: roleTenantId,
          organizationId: ctx.auth?.orgId ?? null,
          roles: lockedRoles,
        })
      },
    })
    return {
      id: String(record.id),
      name: record.name,
      keyPrefix: record.keyPrefix,
      secret,
      tenantId: record.tenantId ?? null,
      organizationId: record.organizationId ?? null,
      roles: lockedRoles.map((role) => ({ id: String(role.id), name: role.name ?? null })),
    }
  },
  buildLog: async ({ input, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('api_keys.list.success.created', 'API key created'),
      resourceKind: 'api_keys.key',
      tenantId: input.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input.organizationId,
    }
  },
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

registerCommand(createApiKeyCommand)
registerCommand(deleteApiKeyCommand)
