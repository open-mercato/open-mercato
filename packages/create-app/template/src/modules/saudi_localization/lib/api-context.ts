/**
 * The request-scoped context every Saudi endpoint needs: the container, the
 * tenant and organization the caller acts in, and the actor for the audit trail.
 *
 * It lives here rather than in each route because the *scope* is the part that
 * must not vary: a report computed against a different organization than the one
 * the caller selected is a cross-tenant read, and one helper is one place to get
 * that wrong instead of five.
 */
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { FinancialLedgerService, LedgerScope } from '@/modules/financial/lib/ledgerQuery'
import { readSaudiVatSettings, type SaudiVatSettings } from './vat-settings'

export type SaudiApiContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string
  actorId: string
  /**
   * Concrete, because the guard above refuses a request without both: every
   * figure this module reports is scoped to one tenant's legal entity, and a
   * nullable scope is how one of them ends up unscoped.
   */
  scope: LedgerScope
}

export function resolveActorId(auth: { sub?: unknown; userId?: unknown; keyId?: unknown }): string {
  const candidates = [auth.sub, auth.userId, auth.keyId]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return 'system'
}

export async function resolveSaudiApiContext(req: Request): Promise<SaudiApiContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  if (!auth.orgId) {
    // Every figure here is scoped to a legal entity. Without one there is no
    // ledger to read and no settings row to read it against.
    throw new CrudHttpError(400, {
      error: translate('errors.organization_required', 'Organization context is required'),
    })
  }
  return {
    container,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    actorId: resolveActorId(auth),
    scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
  }
}

export function resolveConfigService(context: SaudiApiContext): ModuleConfigService {
  return context.container.resolve('moduleConfigService') as ModuleConfigService
}

export function resolveLedgerService(context: SaudiApiContext): FinancialLedgerService {
  return context.container.resolve('financialLedgerService') as FinancialLedgerService
}

export async function readSettings(context: SaudiApiContext): Promise<SaudiVatSettings> {
  return readSaudiVatSettings(resolveConfigService(context), context.scope)
}
