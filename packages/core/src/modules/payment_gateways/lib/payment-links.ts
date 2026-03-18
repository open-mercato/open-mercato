import type { GatewayTransaction } from '../data/entities'

export function isGatewayTransactionSettled(transaction: GatewayTransaction): boolean {
  return ['authorized', 'captured', 'partially_captured', 'refunded', 'partially_refunded'].includes(transaction.unifiedStatus)
}
