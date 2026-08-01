import { createHash, randomUUID } from 'node:crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GatewaySessionInitialization } from '../data/entities'

type Scope = { organizationId: string; tenantId: string }

export type OwnedPaymentSessionInitialization = {
  id: string
  claimToken: string
}

export function buildPaymentSessionOperationKey(input: {
  idempotencyKey: string
  paymentId: string
  providerKey: string
  scope: Scope
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      input.scope.tenantId,
      input.scope.organizationId,
      input.providerKey,
      input.paymentId,
      input.idempotencyKey,
    ]))
    .digest('hex')
  return `om-payment-session:${digest}`
}

export async function findPaymentSessionInitialization(
  em: EntityManager,
  operationKey: string,
  providerKey: string,
  scope: Scope,
): Promise<GatewaySessionInitialization | null> {
  return findOneWithDecryption(
    em.fork(),
    GatewaySessionInitialization,
    {
      operationKey,
      providerKey,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )
}

export async function claimPaymentSessionInitialization(
  em: EntityManager,
  operationKey: string,
  providerKey: string,
  scope: Scope,
  claimedAt: Date,
): Promise<OwnedPaymentSessionInitialization | null> {
  const claimEm = em.fork()
  const claimToken = randomUUID()
  const record = claimEm.create(GatewaySessionInitialization, {
    operationKey,
    providerKey,
    claimToken,
    claimedAt,
    gatewayTransactionId: null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  try {
    await claimEm.persist(record).flush()
    return { id: record.id, claimToken }
  } catch (error: unknown) {
    if (error instanceof UniqueConstraintViolationException) return null
    throw error
  }
}

export async function reclaimPaymentSessionInitialization(
  em: EntityManager,
  claim: GatewaySessionInitialization,
  scope: Scope,
  claimedAt: Date,
  staleBefore: Date,
): Promise<OwnedPaymentSessionInitialization | null> {
  const claimToken = randomUUID()
  const claimedRows = await em.fork().nativeUpdate(
    GatewaySessionInitialization,
    {
      id: claim.id,
      operationKey: claim.operationKey,
      providerKey: claim.providerKey,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      gatewayTransactionId: null,
      $or: [
        { claimToken: null },
        { claimedAt: { $lt: staleBefore } },
      ],
    },
    { claimToken, claimedAt, updatedAt: claimedAt },
  )
  return claimedRows > 0 ? { id: claim.id, claimToken } : null
}

export async function releasePaymentSessionInitialization(
  em: EntityManager,
  ownership: OwnedPaymentSessionInitialization,
  scope: Scope,
): Promise<void> {
  await em.fork().nativeUpdate(
    GatewaySessionInitialization,
    {
      id: ownership.id,
      claimToken: ownership.claimToken,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      gatewayTransactionId: null,
    },
    { claimToken: null, claimedAt: null, updatedAt: new Date() },
  )
}

export async function refreshPaymentSessionInitialization(
  em: EntityManager,
  ownership: OwnedPaymentSessionInitialization,
  scope: Scope,
  claimedAt: Date,
): Promise<boolean> {
  const refreshedRows = await em.fork().nativeUpdate(
    GatewaySessionInitialization,
    {
      id: ownership.id,
      claimToken: ownership.claimToken,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      gatewayTransactionId: null,
    },
    { claimedAt, updatedAt: claimedAt },
  )
  return refreshedRows > 0
}
