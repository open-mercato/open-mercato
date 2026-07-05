import { randomUUID } from 'crypto'
import type { FindOneOptions } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  WarrantyClaim,
  WarrantyClaimEvent,
  WarrantyClaimLine,
} from '../data/entities'
import type {
  WarrantyClaimEventKind,
  WarrantyClaimEventVisibility,
} from '../data/validators'
import { computeHeaderRollups } from '../lib/stateMachine'

export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export const WARRANTY_CLAIM_RESOURCE_KIND = 'warranty_claims.claim'
export const WARRANTY_CLAIM_LINE_RESOURCE_KIND = 'warranty_claims.claim_line'

export type WarrantyClaimScope = {
  organizationId: string
  tenantId: string
}

export type VersionedRecord = {
  id: string
  updatedAt?: Date | string | null
}

export type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export type AppendClaimEventInput = {
  visibility?: WarrantyClaimEventVisibility
  body?: string | null
  payload?: Record<string, unknown> | null
  actorUserId?: string | null
  actorCustomerId?: string | null
}

export async function enforceWarrantyClaimOptimisticLock(
  ctx: CommandRuntimeContext,
  record: VersionedRecord | null | undefined,
  resourceKind = WARRANTY_CLAIM_RESOURCE_KIND,
  expected?: string | Date | null,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected,
    request: ctx.request ?? null,
  })
}

export async function loadScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    options,
    scope,
  )
}

export async function requireScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim> {
  const claim = await loadScopedClaim(em, id, scope, options)
  return assertFound(claim, 'warranty_claims.errors.notFound')
}

export function appendClaimEvent(
  em: EntityManager,
  claim: WarrantyClaim,
  kind: WarrantyClaimEventKind,
  input: AppendClaimEventInput = {},
): WarrantyClaimEvent {
  const event = em.create(WarrantyClaimEvent, {
    id: randomUUID(),
    claim,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
    kind,
    visibility: input.visibility ?? 'internal',
    body: input.body ?? null,
    payload: input.payload ?? null,
    actorUserId: input.actorUserId ?? null,
    actorCustomerId: input.actorCustomerId ?? null,
    createdAt: new Date(),
  })
  em.persist(event)
  return event
}

export async function reconcileVendorRecoverySourceClaim(
  ctx: ResolverContext,
  input: { claimId: string; tenantId: string; organizationId: string },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const recoveryClaim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: input.claimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!recoveryClaim || recoveryClaim.claimType !== 'vendor_recovery' || !recoveryClaim.sourceClaimId) return

  const sourceClaim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: recoveryClaim.sourceClaimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!sourceClaim) return

  const resolvedChildren = await findWithDecryption(
    em,
    WarrantyClaim,
    {
      sourceClaimId: sourceClaim.id,
      claimType: 'vendor_recovery',
      status: { $in: ['resolved', 'closed'] },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  let recoveredTotal = 0
  for (const child of resolvedChildren) {
    const childLines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      {
        claim: child.id,
        tenantId: child.tenantId,
        organizationId: child.organizationId,
        deletedAt: null,
      },
      {},
      scope,
    )
    recoveredTotal += computeHeaderRollups(childLines).totalApprovedAmount
  }
  await withAtomicFlush(
    em,
    [
      () => {
        sourceClaim.totalRecoveredAmount = String(recoveredTotal)
        sourceClaim.updatedAt = new Date()
      },
    ],
    { transaction: true, label: 'warranty_claims.vendor_recovery.reconciliation' },
  )

  await invalidateCrudCache(
    ctx as unknown as Parameters<typeof invalidateCrudCache>[0],
    'warranty_claims.claim',
    { id: sourceClaim.id, organizationId: sourceClaim.organizationId, tenantId: sourceClaim.tenantId },
    input.tenantId,
    'warranty_claims.vendor_recovery.reconciliation',
  )
}
