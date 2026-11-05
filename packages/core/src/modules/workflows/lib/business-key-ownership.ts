/**
 * Who owns a business key right now, and the one safe way to take it back.
 *
 * The `workflow_instances_business_key_open_uq` partial unique index allows one
 * OPEN instance per key. A key can move to a newer run once its holder ended,
 * so every path that returns an ended instance to an open status competes for
 * the key and MUST go through {@link reopenWorkflowInstance}.
 */

import { UniqueConstraintViolationException, type EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { WorkflowInstance } from '../data/entities'
import { WORKFLOW_TERMINAL_INSTANCE_STATUSES, isTerminalInstanceStatus } from './business-key'

export type BusinessKeyScope = {
  tenantId: string
  organizationId: string
  workflowId: string
  businessKey: string
}

function buildHolderWhere(scope: BusinessKeyScope, excludeInstanceId?: string) {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowId: scope.workflowId,
    businessKey: scope.businessKey,
    deletedAt: null,
    ...(excludeInstanceId ? { id: { $ne: excludeInstanceId } } : {}),
  }
}

export async function findOpenBusinessKeyHolder(
  em: EntityManager,
  scope: BusinessKeyScope,
  excludeInstanceId?: string,
): Promise<WorkflowInstance | null> {
  return findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    { ...buildHolderWhere(scope, excludeInstanceId), status: { $nin: [...WORKFLOW_TERMINAL_INSTANCE_STATUSES] } },
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/**
 * The instance that owns `businessKey` in its scope.
 *
 * An OPEN holder always wins, whatever its age: a failed run that is retried
 * after a newer run reused its key and completed is the key's live owner, and
 * a creation-order lookup would hand back the finished newer run instead. Only
 * when nothing holds the key open does the latest ended run decide the reuse
 * policy.
 */
export async function findBusinessKeyHolder(
  em: EntityManager,
  scope: BusinessKeyScope,
  excludeInstanceId?: string,
): Promise<WorkflowInstance | null> {
  const openHolder = await findOpenBusinessKeyHolder(em, scope, excludeInstanceId)
  if (openHolder) return openHolder
  return findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    buildHolderWhere(scope, excludeInstanceId),
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/**
 * An ended instance cannot reopen while another run holds its key open.
 * `holderInstanceId` is null when the racing holder ended again before it could
 * be read; the recovery can simply be retried.
 */
export class WorkflowBusinessKeyHeldError extends Error {
  readonly code = 'WORKFLOW_BUSINESS_KEY_HELD'

  constructor(readonly holderInstanceId: string | null) {
    super('[internal] business key held by another open run')
  }
}

function reopeningScope(instance: WorkflowInstance): BusinessKeyScope | null {
  if (!instance.businessKey || !isTerminalInstanceStatus(instance.status)) return null
  return {
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    workflowId: instance.workflowId,
    businessKey: instance.businessKey,
  }
}

async function discardRefusedChange(em: EntityManager, instance: WorkflowInstance): Promise<void> {
  try {
    await em.refresh(instance)
  } catch (refreshError) {
    getTelemetryRuntime()?.reportError(refreshError, {
      module: 'workflows',
      code: 'workflows.business_key.reopen_restore_failed',
    })
    em.clear()
  }
}

/**
 * Apply and commit a recovery's state change, together with its audit record.
 *
 * Nothing is written while another run holds the key open. A racing start is
 * caught by the unique index, and any failed write discards the refused change
 * so a later flush on the same `em` cannot replay it.
 *
 * @throws WorkflowBusinessKeyHeldError when another open run holds the key
 */
export async function reopenWorkflowInstance(
  em: EntityManager,
  instance: WorkflowInstance,
  options: { reopen: () => void; audit?: (trx: EntityManager) => Promise<void> },
): Promise<void> {
  const scope = reopeningScope(instance)
  if (scope) {
    const holder = await findOpenBusinessKeyHolder(em, scope, instance.id)
    if (holder) throw new WorkflowBusinessKeyHeldError(holder.id)
  }

  try {
    await em.transactional(async (trx) => {
      options.reopen()
      await trx.flush()
      await options.audit?.(trx)
    })
  } catch (error) {
    await discardRefusedChange(em, instance)
    if (scope && error instanceof UniqueConstraintViolationException) {
      const holder = await findOpenBusinessKeyHolder(em, scope, instance.id)
      throw new WorkflowBusinessKeyHeldError(holder?.id ?? null)
    }
    throw error
  }
}
