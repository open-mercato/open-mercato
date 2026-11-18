import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ClassifiedSalesError } from './salesErrors'

const INTERNAL_PREFIX = '[internal]'

const RUNNER_ERROR_TEXT: Record<string, { key: string; fallback: string }> = {
  cancelled_status_missing: {
    key: 'property_management.salesErrors.cancelledStatusMissing',
    fallback: 'No cancelled order status is configured in the property management settings.',
  },
  sales_status_not_applied: {
    key: 'property_management.salesErrors.statusNotApplied',
    fallback: 'Sales kept the document out of the requested status.',
  },
  sales_status_missing: {
    key: 'property_management.salesErrors.statusMissing',
    fallback: 'The requested sales status is not configured.',
  },
  sales_contract_unavailable: {
    key: 'property_management.salesErrors.contractUnavailable',
    fallback: 'This sales capability is not available in this installation yet.',
  },
  invalid_payload: {
    key: 'property_management.salesErrors.invalidPayload',
    fallback: 'The billing request is incomplete.',
  },
  unsupported_kind: {
    key: 'property_management.salesErrors.unsupportedKind',
    fallback: 'The billing request type is not supported.',
  },
  predecessor_refused: {
    key: 'property_management.salesErrors.predecessorRefused',
    fallback: 'An earlier step of this billing change was refused.',
  },
}

const PM_AUTHORED_CODES = new Set(['sales_operation_duplicated'])

const UNEXPECTED_ERROR_TEXT = {
  key: 'property_management.salesErrors.unexpected',
  fallback: 'Sales could not be reached or failed unexpectedly.',
}

type SalesErrorFields = Pick<ClassifiedSalesError, 'status' | 'code' | 'message'>

function presentableMessage(message: string | null | undefined): string | null {
  return message && !message.startsWith(INTERNAL_PREFIX) ? message : null
}

function isSalesRefusalStatus(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && status !== 422
}

function hasPresentableSource(error: SalesErrorFields): boolean {
  return isSalesRefusalStatus(error.status) || Boolean(error.code && PM_AUTHORED_CODES.has(error.code))
}

export function salesRefusalMessage(error: SalesErrorFields): string | null {
  return hasPresentableSource(error) ? presentableMessage(error.message) : null
}

export async function describeSalesError(error: SalesErrorFields | null): Promise<string> {
  if (!error) return ''
  const known = error.code ? RUNNER_ERROR_TEXT[error.code] : undefined
  const { translate } = await resolveTranslations()
  if (known) return translate(known.key, known.fallback)
  return salesRefusalMessage(error) ?? translate(UNEXPECTED_ERROR_TEXT.key, UNEXPECTED_ERROR_TEXT.fallback)
}

export async function describeBillingRefusal(refusal: { code: string | null; message: string | null }): Promise<string> {
  const known = refusal.code ? RUNNER_ERROR_TEXT[refusal.code] : undefined
  const { translate } = await resolveTranslations()
  if (known) return translate(known.key, known.fallback)
  return presentableMessage(refusal.message) ?? translate(UNEXPECTED_ERROR_TEXT.key, UNEXPECTED_ERROR_TEXT.fallback)
}

export async function describeDuplicateOutcome(cancelledIds: string[], failedIds: string[]): Promise<string> {
  const { translate } = await resolveTranslations()
  const parts: string[] = []
  if (cancelledIds.length) {
    parts.push(translate('property_management.notifications.salesOperationDuplicated.cancelled', 'The extras were cancelled: {ids}.', {
      ids: cancelledIds.join(', '),
    }))
  }
  if (failedIds.length) {
    parts.push(translate('property_management.notifications.salesOperationDuplicated.notCancelled', 'These extras could not be cancelled; cancel them in Sales: {ids}.', {
      ids: failedIds.join(', '),
    }))
  }
  if (!parts.length) {
    return translate('property_management.notifications.salesOperationDuplicated.nothingToCancel', 'No extra sales document needed cancelling.')
  }
  return parts.join(' ')
}
