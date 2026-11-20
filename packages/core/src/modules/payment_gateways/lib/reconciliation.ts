import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { decimalsEqual, resolveExactDecimal } from '@open-mercato/shared/lib/decimal'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { GatewayPaymentOperation, GatewayTransaction } from '../data/entities'
import { reconciliationRecordSchema, reconciliationResolutionSchema, type ReconciliationRecord, type ReconciliationResolution } from '../data/validators'
import { resolvePaymentGatewayTranslator } from './order-amount-reconciliation'

export const RECONCILIATION_KEY = '__paymentReconciliation'
type Scope = { organizationId: string; tenantId: string }

export function readReconciliation(
  operation: Pick<GatewayPaymentOperation, 'operationType' | 'status' | 'result' | 'updatedAt'>,
  currencyCode: string,
): ReconciliationRecord | null {
  if (operation.operationType !== 'capture' || operation.status !== 'succeeded' || !operation.result) return null
  const stored = operation.result[RECONCILIATION_KEY]
  if (stored !== undefined) {
    const parsed = reconciliationRecordSchema.safeParse(stored)
    return parsed.success ? parsed.data : null
  }
  if (!['captured', 'partially_captured'].includes(String(operation.result.status))) return null
  if (!['cancelled', 'failed', 'expired'].includes(String(operation.result.__settledTransactionStatus))) return null
  const capturedAmountExact = resolveExactDecimal(operation.result.capturedAmountExact, operation.result.capturedAmount)
  const parsed = reconciliationRecordSchema.safeParse({
    version: 1,
    status: 'required',
    detectedAt: operation.updatedAt.toISOString(),
    observedStatus: operation.result.__settledTransactionStatus,
    capturedAmountExact,
    currencyCode,
    resolution: null,
  })
  return parsed.success ? parsed.data : null
}

export function reconciliationResponse(operationId: string) {
  return { id: operationId, requiredAtCompletion: true as const }
}

export async function listReconciliations(em: EntityManager, scope: Scope, query: { page: number; pageSize: number; status: 'required' | 'resolved' }) {
  const queryBuilder = em.createQueryBuilder(GatewayPaymentOperation, 'operation').where({
    ...scope, operationType: 'capture', status: 'succeeded',
  })
  const stored = `"operation"."result"->'${RECONCILIATION_KEY}'`
  if (query.status === 'resolved') {
    queryBuilder.andWhere(`${stored}->>'status' = ?`, ['resolved'])
  } else {
    queryBuilder.andWhere(`(${stored}->>'status' = ? or (${stored} is null and "operation"."result"->>'status' in ('captured', 'partially_captured') and "operation"."result"->>'__settledTransactionStatus' in ('cancelled', 'failed', 'expired')))`, ['required'])
  }
  const total = await queryBuilder.clone().getCount()
  const selected = await queryBuilder.select('id').orderBy({ createdAt: 'asc', id: 'asc' })
    .limit(query.pageSize).offset((query.page - 1) * query.pageSize).getResultList()
  const operations = selected.length ? await findWithDecryption(em, GatewayPaymentOperation, { ...scope, id: { $in: selected.map((operation) => operation.id) } }, undefined, scope) : []
  const transactions = operations.length ? await findWithDecryption(em, GatewayTransaction, {
    ...scope, id: { $in: operations.map((operation) => operation.transactionId) },
  }, undefined, scope) : []
  const transactionMap = new Map(transactions.map((transaction) => [transaction.id, transaction]))
  const operationMap = new Map(operations.map((operation) => [operation.id, operation]))
  const items = selected.flatMap((selectedOperation) => {
    const operation = operationMap.get(selectedOperation.id)
    const transaction = operation ? transactionMap.get(operation.transactionId) : undefined
    if (!operation || !transaction) return []
    const reconciliation = readReconciliation(operation, transaction.currencyCode)
    return reconciliation ? [{
      id: operation.id, transactionId: operation.transactionId, providerKey: operation.providerKey,
      providerSessionId: transaction.providerSessionId ?? null, gatewayPaymentId: transaction.gatewayPaymentId ?? null,
      paymentId: transaction.paymentId, parentDeleted: transaction.deletedAt != null,
      updatedAt: operation.updatedAt.toISOString(), reconciliation,
    }] : []
  })
  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
}

export async function resolveReconciliation(em: EntityManager, input: {
  id: string; evidence: ReconciliationResolution; actorUserId: string; scope: Scope; container: AwilixContainer; request?: Request
}) {
  const evidence = reconciliationResolutionSchema.parse(input.evidence)
  const translate = await resolvePaymentGatewayTranslator()
  const refuse = (key: string, status = 409): never => {
    throw new CrudHttpError(status, { error: translate(`payment_gateways.reconciliation.errors.${key}`), code: `payment_reconciliation_${key}` })
  }
  return em.transactional(async (transactionEm) => {
    const candidate = await findOneWithDecryption(transactionEm, GatewayPaymentOperation, { id: input.id, ...input.scope }, undefined, input.scope)
    if (!candidate) return refuse('notFound', 404)
    await transactionEm.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
      JSON.stringify(['payment-reconciliation', input.scope.tenantId, input.scope.organizationId, candidate.providerKey, candidate.transactionId, evidence.refundReference]),
    ])
    const operation = await findOneWithDecryption(transactionEm, GatewayPaymentOperation, { id: input.id, ...input.scope }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, input.scope)
    const transaction = operation ? await findOneWithDecryption(transactionEm, GatewayTransaction, { id: operation.transactionId, ...input.scope }, undefined, input.scope) : null
    if (!operation || !transaction) return refuse('notFound', 404)
    const reconciliation = readReconciliation(operation, transaction.currencyCode)
    if (!reconciliation) return refuse('notFound', 404)
    if (reconciliation.status === 'resolved') {
      const previous = reconciliation.resolution
      if (previous && previous.refundReference === evidence.refundReference && previous.currencyCode === evidence.currencyCode
        && decimalsEqual(previous.refundedAmountExact, evidence.refundedAmountExact) && previous.confirmedAt === evidence.confirmedAt) {
        return { id: operation.id, updatedAt: operation.updatedAt.toISOString(), reconciliation, ...input.scope }
      }
      return refuse('alreadyResolved')
    }
    await enforceCommandOptimisticLockWithGuards(input.container, { resourceKind: 'payment_gateways.payment_operation', resourceId: operation.id, current: operation.updatedAt, request: input.request })
    if (evidence.currencyCode !== reconciliation.currencyCode || !decimalsEqual(evidence.refundedAmountExact, reconciliation.capturedAmountExact)
      || new Date(evidence.confirmedAt).getTime() > Date.now()
      || new Date(evidence.confirmedAt).getTime() < operation.createdAt.getTime()) return refuse('evidenceMismatch')
    const reused = await transactionEm.createQueryBuilder(GatewayPaymentOperation, 'operation').where({
      ...input.scope, providerKey: operation.providerKey, transactionId: operation.transactionId, id: { $ne: operation.id },
    }).andWhere(`"operation"."result"->'${RECONCILIATION_KEY}'->'resolution'->>'refundReference' = ?`, [evidence.refundReference]).getCount()
    if (reused) return refuse('receiptUsed')
    const resolved: ReconciliationRecord = {
      ...reconciliation, status: 'resolved',
      resolution: { ...evidence, actorUserId: input.actorUserId, recordedAt: new Date().toISOString() },
    }
    operation.result = { ...operation.result, [RECONCILIATION_KEY]: resolved }
    operation.updatedAt = new Date()
    await transactionEm.flush()
    return { id: operation.id, updatedAt: operation.updatedAt.toISOString(), reconciliation: resolved, ...input.scope }
  }, { clear: true })
}
