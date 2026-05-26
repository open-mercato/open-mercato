import { TableNotFoundException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

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

export async function createMissingCustomerLabelTablesError(): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(503, {
    error: translate(
      'customers.errors.customer_label_tables_missing',
      'Customer label tables are missing. Run yarn db:migrate.',
    ),
  })
}
