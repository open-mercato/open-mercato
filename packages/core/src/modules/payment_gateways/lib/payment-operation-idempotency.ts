import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GatewayPaymentOperation } from '../data/entities'
import type { ManualGatewayAction } from './status-machine'

type Scope = { organizationId: string; tenantId: string }
type OperationStatus = 'in_progress' | 'succeeded' | 'failed'

const OPERATION_LEASE_MS = 10 * 60 * 1000
const OPERATION_UNIQUE_CONSTRAINT = 'gateway_payment_operations_scope_operation_unique'

export type ClaimedPaymentOperation = {
  record: GatewayPaymentOperation
  attemptToken: string
  providerIdempotencyKey: string
}

export type PreparedPaymentOperation =
  | { kind: 'completed'; result: Record<string, unknown> }
  | { kind: 'claimed'; claim: ClaimedPaymentOperation }

type PreparePaymentOperationInput = {
  em: EntityManager
  transactionId: string
  providerKey: string
  action: ManualGatewayAction
  operationId?: string
  payload: Record<string, unknown>
  scope: Scope
  assertInitialAllowed: () => void
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function operationConflict(code: string, operationId: string, message: string): CrudHttpError {
  return new CrudHttpError(409, { error: message, code, operationId })
}

async function findOperation(
  em: EntityManager,
  operationId: string,
  scope: Scope,
): Promise<GatewayPaymentOperation | null> {
  return findOneWithDecryption(
    em,
    GatewayPaymentOperation,
    {
      operationId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )
}

function buildOperationIdentity(input: Omit<PreparePaymentOperationInput, 'em' | 'assertInitialAllowed'>) {
  const requestHash = digest({
    transactionId: input.transactionId,
    providerKey: input.providerKey,
    action: input.action,
    payload: input.payload,
  })
  const operationId = input.operationId ?? `auto_${requestHash}`
  const providerIdempotencyKey = `om-pg-${digest({
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    transactionId: input.transactionId,
    action: input.action,
    operationId,
  })}`
  return { operationId, providerIdempotencyKey, requestHash }
}

function claimFields(now: Date) {
  return {
    status: 'in_progress' as OperationStatus,
    attemptToken: randomUUID(),
    leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS),
    updatedAt: now,
  }
}

async function resolveExistingOperation(
  em: EntityManager,
  existing: GatewayPaymentOperation,
  identity: ReturnType<typeof buildOperationIdentity>,
): Promise<PreparedPaymentOperation> {
  if (existing.requestHash !== identity.requestHash) {
    throw operationConflict(
      'payment_operation_conflict',
      identity.operationId,
      'Payment operation id was already used with a different request',
    )
  }
  if (existing.providerIdempotencyKey !== identity.providerIdempotencyKey) {
    throw operationConflict(
      'payment_operation_conflict',
      identity.operationId,
      'Payment operation id resolved to a different provider request',
    )
  }
  if (existing.status === 'succeeded' && existing.result) {
    return { kind: 'completed', result: existing.result }
  }

  const now = new Date()
  const stale = existing.status === 'in_progress'
    && existing.leaseExpiresAt instanceof Date
    && existing.leaseExpiresAt <= now
  if (existing.status !== 'failed' && !stale) {
    throw operationConflict(
      'payment_operation_in_progress',
      identity.operationId,
      'Payment operation is already in progress',
    )
  }

  const next = claimFields(now)
  const where = existing.status === 'failed'
    ? { id: existing.id, status: 'failed', attemptToken: existing.attemptToken }
    : { id: existing.id, status: 'in_progress', attemptToken: existing.attemptToken, leaseExpiresAt: { $lt: now } }
  const claimed = await em.nativeUpdate(
    GatewayPaymentOperation,
    where,
    { ...next, attemptCount: existing.attemptCount + 1 },
  )
  if (claimed !== 1) {
    throw operationConflict(
      'payment_operation_in_progress',
      identity.operationId,
      'Payment operation is already in progress',
    )
  }
  Object.assign(existing, next, { attemptCount: existing.attemptCount + 1 })
  return {
    kind: 'claimed',
    claim: {
      record: existing,
      attemptToken: next.attemptToken,
      providerIdempotencyKey: existing.providerIdempotencyKey,
    },
  }
}

export async function preparePaymentOperation(
  input: PreparePaymentOperationInput,
): Promise<PreparedPaymentOperation> {
  const identity = buildOperationIdentity(input)
  const existing = await findOperation(input.em, identity.operationId, input.scope)
  if (existing) {
    return resolveExistingOperation(input.em, existing, identity)
  }

  input.assertInitialAllowed()
  const now = new Date()
  const claim = claimFields(now)
  const record = input.em.create(GatewayPaymentOperation, {
    operationId: identity.operationId,
    transactionId: input.transactionId,
    operationType: input.action,
    providerKey: input.providerKey,
    requestHash: identity.requestHash,
    providerIdempotencyKey: identity.providerIdempotencyKey,
    status: claim.status,
    attemptToken: claim.attemptToken,
    attemptCount: 1,
    result: null,
    leaseExpiresAt: claim.leaseExpiresAt,
    organizationId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    createdAt: now,
    updatedAt: now,
  })
  try {
    await input.em.persist(record).flush()
    return {
      kind: 'claimed',
      claim: {
        record,
        attemptToken: claim.attemptToken,
        providerIdempotencyKey: identity.providerIdempotencyKey,
      },
    }
  } catch (error: unknown) {
    if (!isUniqueViolation(error, OPERATION_UNIQUE_CONSTRAINT) && !isUniqueViolation(error)) {
      throw error
    }
    const winner = await findOperation(input.em, identity.operationId, input.scope)
    if (!winner) throw error
    return resolveExistingOperation(input.em, winner, identity)
  }
}

export async function completePaymentOperation<T extends Record<string, unknown>>(
  em: EntityManager,
  claim: ClaimedPaymentOperation,
  result: T,
  applyResult: (tx: EntityManager) => Promise<boolean>,
): Promise<boolean> {
  const statusChanged = await em.transactional(async (tx) => {
    const completed = await tx.nativeUpdate(
      GatewayPaymentOperation,
      { id: claim.record.id, status: 'in_progress', attemptToken: claim.attemptToken },
      { status: 'succeeded', result, leaseExpiresAt: null, updatedAt: new Date() },
    )
    if (completed !== 1) {
      throw operationConflict(
        'payment_operation_claim_lost',
        claim.record.operationId,
        'Payment operation claim is no longer active',
      )
    }
    const changed = await applyResult(tx)
    await tx.flush()
    return changed
  })
  Object.assign(claim.record, { status: 'succeeded', result, leaseExpiresAt: null })
  return statusChanged
}

export async function failPaymentOperation(
  em: EntityManager,
  claim: ClaimedPaymentOperation,
): Promise<void> {
  const failed = await em.nativeUpdate(
    GatewayPaymentOperation,
    { id: claim.record.id, status: 'in_progress', attemptToken: claim.attemptToken },
    { status: 'failed', leaseExpiresAt: null, updatedAt: new Date() },
  )
  if (failed === 1) {
    Object.assign(claim.record, { status: 'failed', leaseExpiresAt: null })
  }
}
