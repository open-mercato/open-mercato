import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const scopedTransactionNotFound = Symbol.for('@open-mercato/payment_gateways/scoped-transaction-not-found')

export function transactionNotFound(message: string): CrudHttpError {
  return Object.assign(new CrudHttpError(404, { error: message }), { [scopedTransactionNotFound]: true })
}

export function isTransactionNotFound(error: unknown): error is CrudHttpError {
  return isCrudHttpError(error)
    && (error as CrudHttpError & { [scopedTransactionNotFound]?: unknown })[scopedTransactionNotFound] === true
}
