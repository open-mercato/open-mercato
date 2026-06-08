import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

/** Resource kinds used by the document-aggregate optimistic-lock check. */
export const SALES_RESOURCE_KIND_ORDER = 'sales.order'
export const SALES_RESOURCE_KIND_QUOTE = 'sales.quote'

/**
 * Enforce the document-aggregate OSS optimistic lock for a sales sub-resource
 * command (lines, adjustments, shipments, payments, returns, quote
 * conversion). The client sends the parent order/quote's expected `updated_at`
 * via the optimistic-lock extension header; this compares it against the
 * already-loaded document and throws the structured 409 on mismatch.
 *
 * The parent document is the consistency boundary: sub-resource mutations
 * recalculate document totals (or transition the document), which dirties the
 * parent so its `updated_at` advances on flush — meaning concurrent sub-edits
 * observe each other and conflict. Call this AFTER loading + scope-checking the
 * document and BEFORE mutating, so `document.updatedAt` is the pre-mutation
 * version.
 *
 * Strictly additive: when the client sends no header the check is a no-op, so
 * existing API consumers are unaffected. Respects `OM_OPTIMISTIC_LOCK`.
 */
export function enforceSalesDocumentOptimisticLock(
  ctx: CommandRuntimeContext,
  document: { id: string; updatedAt?: Date | string | null } | null | undefined,
  resourceKind: string,
): void {
  if (!document) return
  enforceCommandOptimisticLock({
    resourceKind,
    resourceId: document.id,
    current: document.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

export async function requireScopedEntity<T extends { id: string; deletedAt?: Date | null }>(
  em: EntityManager,
  entityClass: { new (): T },
  id: string,
  message: string,
  scope: { organizationId: string | null; tenantId: string | null } = { organizationId: null, tenantId: null },
): Promise<T> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  if (scope.organizationId) where.organizationId = scope.organizationId
  if (scope.tenantId) where.tenantId = scope.tenantId
  const entity = await findOneWithDecryption(em, entityClass, where, {}, scope)
  if (!entity) throw new CrudHttpError(404, { error: message })
  return entity
}
