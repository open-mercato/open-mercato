import { randomUUID } from 'crypto'
import type { FindOneOptions } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
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
import { withExactAmounts } from '@open-mercato/shared/lib/decimal'

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

export const WARRANTY_MONEY_FIELDS = [
  'creditAmount',
  'restockingFee',
  'coreChargeAmount',
  'coreCreditAmount',
  'autoApproveMaxAmount',
] as const

/**
 * Adds `<field>Exact` strings (raw request digits) next to the coerced money
 * numbers, on the input and on each of its `lines`.
 */
export function withWarrantyExactAmounts<T>(parsed: T, raw: unknown): T {
  if (!parsed || typeof parsed !== 'object') return parsed
  const withExact = withExactAmounts(parsed as object, raw, WARRANTY_MONEY_FIELDS) as Record<string, unknown>
  const lines = withExact.lines
  if (Array.isArray(lines)) {
    const rawLines = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).lines : undefined
    withExact.lines = lines.map((line, index) =>
      line && typeof line === 'object'
        ? withExactAmounts(line as object, Array.isArray(rawLines) ? rawLines[index] : undefined, WARRANTY_MONEY_FIELDS)
        : line,
    )
  }
  return withExact as T
}

/**
 * The input without the `<field>Exact` keys a route attached, so the strict
 * command schemas accept it. `withWarrantyExactAmounts` still reads them from
 * the original input.
 */
export function withoutWarrantyExactKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const exactKeys = new Set(WARRANTY_MONEY_FIELDS.map((field) => `${field}Exact`))
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => !exactKeys.has(key))
    .map(([key, value]) => [key, key === 'lines' && Array.isArray(value) ? value.map(withoutWarrantyExactKeys) : value])
  return Object.fromEntries(entries)
}

/** The exact money input for `field`: its `<field>Exact` string when present. */
export function exactMoneyInput(
  input: object,
  field: (typeof WARRANTY_MONEY_FIELDS)[number],
): number | string | null | undefined {
  const values = input as Record<string, number | string | null | undefined>
  const exact = values[`${field}Exact`]
  return typeof exact === 'string' ? exact : values[field]
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
  const recoveredTotal = computeHeaderRollups(childLines).totalApprovedAmountExact
  await withAtomicFlush(
    em,
    [
      () => {
        sourceClaim.totalRecoveredAmount = recoveredTotal
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
