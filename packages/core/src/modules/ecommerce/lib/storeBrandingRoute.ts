import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { EcommerceStore } from '../data/entities'
import { fieldError, translateEcommerceError } from './crudSupport'

export const BRANDING_MANAGE_FEATURE = 'ecommerce.branding.manage'

export const storeIdParamSchema = z.string().uuid()

export type BrandingRouteContext = {
  container: AwilixContainer
  auth: AuthContext & { tenantId: string }
  tenantId: string
  organizationId: string
  commandCtx: CommandRuntimeContext
}

export async function resolveBrandingRouteContext(request: Request): Promise<BrandingRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: await translateEcommerceError('ecommerce.errors.unauthorized', 'Sign in to continue.') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = scope?.tenantId ?? auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    const { translate } = await resolveTranslations()
    throw fieldError(400, {
      organizationId: translate('ecommerce.errors.organizationRequired', 'Select an organization first.'),
    })
  }
  const scopedAuth = { ...auth, tenantId, orgId: organizationId }
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: scopedAuth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? [organizationId],
    request,
  }
  return { container, auth: scopedAuth, tenantId, organizationId, commandCtx }
}

export async function resolveGrantedFeatures(context: BrandingRouteContext): Promise<string[]> {
  const declared = context.auth.features
  const fallback = Array.isArray(declared) ? declared.filter((value): value is string => typeof value === 'string') : []
  try {
    const rbac = context.container.resolve('rbacService') as
      | {
          getGrantedFeatures?: (
            userId: string,
            scope: { tenantId: string | null; organizationId: string | null },
          ) => Promise<string[]>
        }
      | undefined
    if (rbac?.getGrantedFeatures && context.auth.sub) {
      return await rbac.getGrantedFeatures(context.auth.sub, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      })
    }
  } catch {
    return fallback
  }
  return fallback
}

export async function requireScopedStore(context: BrandingRouteContext, storeId: string): Promise<EcommerceStore> {
  const em = (context.container.resolve('em') as EntityManager).fork()
  const store = await findOneWithDecryption(
    em,
    EcommerceStore,
    { id: storeId, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
    undefined,
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
  if (store) return store
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(404, {
    error: translate('ecommerce.errors.storeNotFound', 'The selected store does not exist in this organization.'),
  })
}
