import { randomUUID } from 'crypto'
import { LockMode, type FindOneOptions } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { assertFound, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
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

/**
 * `notFoundMessage` is passed to `assertFound` verbatim, so request-scoped callers
 * must hand in an already-translated sentence; the key default only suits the
 * command surface, which runs without a request locale.
 */
export async function requireScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
  notFoundMessage = 'warranty_claims.errors.notFound',
): Promise<WarrantyClaim> {
  const claim = await loadScopedClaim(em, id, scope, options)
  return assertFound(claim, notFoundMessage)
}

export async function assertUniqueClaimLineNumbers(lineNumbers: Iterable<number>): Promise<void> {
  const usedNumbers = new Set<number>()
  for (const lineNo of lineNumbers) {
    if (usedNumbers.has(lineNo)) {
      const { translate } = await resolveTranslations()
      const code = 'warranty_claims.errors.duplicateLineNo'
      throw new CrudHttpError(409, {
        error: translate(code, 'Another line on this claim already uses that line number. Choose a different number before retrying.'),
        code,
      })
    }
    usedNumbers.add(lineNo)
  }
}

export async function assertClaimLineNumberAvailable(
  em: EntityManager,
  claim: WarrantyClaim,
  lineNo: number,
  excludedLineId?: string,
  allowCurrentNumber = false,
): Promise<void> {
  const scope = { tenantId: claim.tenantId, organizationId: claim.organizationId }
  await requireScopedClaim(em, claim.id, scope, { lockMode: LockMode.PESSIMISTIC_WRITE })
  const siblings = await findWithDecryption(
    em,
    WarrantyClaimLine,
    { claim: claim.id, lineNo, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  if (allowCurrentNumber && siblings.some((line) => line.id === excludedLineId)) return
  await assertUniqueClaimLineNumbers([lineNo, ...siblings.filter((line) => line.id !== excludedLineId).map((line) => line.lineNo)])
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
  const childLines = resolvedChildren.length
    ? await findWithDecryption(
        em,
        WarrantyClaimLine,
        {
          claim: { $in: resolvedChildren.map((child) => child.id) },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        {},
        scope,
      )
    : []
  const recoveredTotal = computeHeaderRollups(childLines).totalApprovedAmount
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

  const dataEngine = ctx.resolve<DataEngine>('dataEngine')
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: sourceClaim,
    identifiers: {
      id: sourceClaim.id,
      organizationId: sourceClaim.organizationId,
      tenantId: sourceClaim.tenantId,
    },
    indexer: { entityType: 'warranty_claims:warranty_claim' },
    events: {
      module: 'warranty_claims',
      entity: 'claim',
      persistent: true,
      buildPayload: () => ({
        id: sourceClaim.id,
        organizationId: sourceClaim.organizationId,
        tenantId: sourceClaim.tenantId,
        claimType: sourceClaim.claimType,
        status: sourceClaim.status,
      }),
    },
  })
  await flushCrudSideEffects(dataEngine)
  await invalidateCrudCache(
    ctx as unknown as Parameters<typeof invalidateCrudCache>[0],
    'warranty_claims.claim',
    { id: sourceClaim.id, organizationId: sourceClaim.organizationId, tenantId: sourceClaim.tenantId },
    input.tenantId,
    'warranty_claims.vendor_recovery.reconciliation',
  )
}
