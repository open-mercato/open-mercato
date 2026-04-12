import { TableNotFoundException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const CUSTOMER_LABEL_TABLES = [
  'customer_labels',
  'customer_label_assignments',
] as const

export function isMissingCustomerLabelTable(error: unknown): boolean {
  if (error instanceof TableNotFoundException) {
    return true
  }
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === '42P01') {
    return true
  }
  const message = candidate.message
  if (typeof message !== 'string') {
    return false
  }
  return CUSTOMER_LABEL_TABLES.some((tableName) => message.includes(tableName))
}

export function createMissingCustomerLabelTablesError(): CrudHttpError {
  return new CrudHttpError(503, {
    error: 'Customer label tables are missing. Run yarn db:migrate.',
  })
}
