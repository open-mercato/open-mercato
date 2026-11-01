import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { CustomerPurchaseApprovalServiceError } from '../services/customerPurchaseApprovalService'

type Translate = (key: string, fallback?: string) => string

// Release 5 Phase 4 (Step 2.6, §9.2). One mapping from
// `CustomerPurchaseApprovalServiceError` (Step 2.5) to the platform's structured HTTP
// error shape, shared by every staff and portal approval route so the error codes/
// bodies in §9.2 are produced in exactly one place. Returns `null` for anything the
// service never throws here, so each route's own `catch` still falls through to its
// generic 500.
export function mapApprovalServiceError(err: unknown, translate: Translate): CrudHttpError | null {
  if (!(err instanceof CustomerPurchaseApprovalServiceError)) return null
  switch (err.code) {
    case 'approval_not_found':
      return notFound(translate('customer_groups.errors.approvalNotFound', 'Purchase approval not found.'))
    case 'approval_not_pending':
      return new CrudHttpError(409, {
        error: translate('customer_groups.errors.approvalNotPending', 'This approval request is no longer pending.'),
        code: 'approval_not_pending',
        status: err.details?.status ?? null,
        buyerDecision: err.details?.buyerDecision ?? null,
        merchantDecision: err.details?.merchantDecision ?? null,
      })
    case 'approval_self_decision_forbidden':
      return new CrudHttpError(403, {
        error: translate(
          'customer_groups.errors.approvalSelfDecisionForbidden',
          'You cannot decide your own approval request.',
        ),
        code: 'approval_self_decision_forbidden',
      })
    case 'approval_withdraw_forbidden':
      return new CrudHttpError(403, {
        error: translate(
          'customer_groups.errors.approvalWithdrawForbidden',
          'Only the requester can withdraw this approval request.',
        ),
        code: 'approval_withdraw_forbidden',
      })
    case 'invalid_buyer':
      return new CrudHttpError(400, { error: translate('customer_groups.errors.invalid_input', 'Invalid input') })
    default:
      return null
  }
}
