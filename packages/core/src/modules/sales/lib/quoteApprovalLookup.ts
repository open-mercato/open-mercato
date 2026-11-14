import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  ApprovalView,
  CustomerPurchaseApprovalService,
} from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import type { QuoteApprovalProofView } from './quoteApprovalRequirement'

type ResolvingContainer = { resolve: <T = unknown>(name: string) => T }

type ApprovalScope = { tenantId: string; organizationId: string }

type CustomerPurchaseApprovalServiceFactory = (em: EntityManager) => CustomerPurchaseApprovalService

function softResolve<T>(container: ResolvingContainer, name: string): T | null {
  try {
    return container.resolve<T>(name) ?? null
  } catch {
    return null
  }
}

function toProofView(view: ApprovalView): QuoteApprovalProofView {
  return {
    id: view.id,
    status: view.status,
    currencyCode: view.currencyCode,
    amountGross: view.amountGross,
    subjectType: view.subjectType,
    subjectId: view.subjectId,
    customerId: view.customerId,
  }
}

export function createQuoteApprovalLookup(
  container: ResolvingContainer,
  scope: ApprovalScope,
  transactionEm?: EntityManager,
): ((approvalId: string) => Promise<QuoteApprovalProofView | null>) | null {
  let service: CustomerPurchaseApprovalService | null = null
  if (transactionEm) {
    const factory = softResolve<CustomerPurchaseApprovalServiceFactory>(container, 'customerPurchaseApprovalServiceFactory')
    service = factory ? factory(transactionEm) : null
  } else {
    service = softResolve<CustomerPurchaseApprovalService>(container, 'customerPurchaseApprovalService')
  }
  if (!service) return null
  const resolved = service
  return async (approvalId) => {
    const view = await resolved.getApproval({ scope, approvalId })
    return view ? toProofView(view) : null
  }
}
