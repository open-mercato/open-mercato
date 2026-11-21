import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogService } from '@open-mercato/core/modules/catalog/data/entities'

export type LineServiceReference = {
  serviceId?: string | null
  lineNumber: number
}

export type LineServiceReferenceScope = {
  tenantId: string
  organizationId: string
}

export type LineServiceReferenceOptions = {
  /**
   * Accept services that were soft-deleted after being referenced. Invoices and
   * credit memos copy references from existing order lines, so a service archived
   * since must still resolve; new quote/order references must point at a live one.
   */
  includeDeleted?: boolean
}

/**
 * The reference a line write must validate: the line's service when it is new
 * or differs from the stored one, otherwise nothing — an unchanged reference to
 * a service archived since stays editable.
 */
export function changedLineServiceReference(
  line: { serviceId?: string | null; lineNumber?: number | null },
  previousServiceId: string | null | undefined,
): LineServiceReference[] {
  const serviceId = line.serviceId ?? null
  if (!serviceId || serviceId === (previousServiceId ?? null)) return []
  return [{ serviceId, lineNumber: line.lineNumber ?? 1 }]
}

export async function assertLineServicesExistInScope(
  em: EntityManager,
  scope: LineServiceReferenceScope,
  references: LineServiceReference[],
  options: LineServiceReferenceOptions = {},
): Promise<void> {
  const serviceIds = [
    ...new Set(references.flatMap((reference) => (reference.serviceId ? [reference.serviceId] : []))),
  ]
  if (!serviceIds.length) return
  const where: FilterQuery<CatalogService> = {
    id: { $in: serviceIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(options.includeDeleted ? {} : { deletedAt: null }),
  }
  const services = await findWithDecryption(em, CatalogService, where, undefined, scope)
  const foundIds = new Set(services.map((service) => service.id))
  const missing = references.find(
    (reference) => reference.serviceId && !foundIds.has(reference.serviceId),
  )
  if (!missing) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.serviceNotFound',
      'Line {{line}} references a service that does not exist in this organization.',
      { line: String(missing.lineNumber) },
    ),
  })
}
