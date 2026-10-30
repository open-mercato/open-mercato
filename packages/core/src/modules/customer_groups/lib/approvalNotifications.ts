import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

// Release 5 Phase 4 (G15, D-R5-6, §10.2, Step 2.7). The in-app half of
// `customer_groups.approval.requested`'s fan-out: "Staff holding
// `customer_groups.approvals.decide` in the organization" — EVERY eligible decider,
// not a single fallback (unlike `createCreditLimitExceededNotification`'s
// account-manager-then-fallback shape), so this always goes through
// `createForFeature` with `restrictRecipientsToOrganization: true`, never
// `notificationService.create` for a single recipient. Idempotent on event
// redelivery for free: `createForFeature` → `createOrRefreshNotification` dedupes
// per `(recipientUserId, type, groupKey)`, refreshing rather than duplicating.

export type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type ApprovalRequestedNotificationInput = {
  tenantId: string
  organizationId: string
  approvalId: string
  amountGross: string
  currencyCode: string
}

const MERCHANT_DECIDE_FEATURE = 'customer_groups.approvals.decide'

export async function notifyMerchantDecidersOfApprovalRequested(
  container: ResolverContainer,
  input: ApprovalRequestedNotificationInput,
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'customer_groups.approval.requested')
  if (!typeDef) return

  const notificationService = resolveNotificationService(container)
  await notificationService.createForFeature(
    {
      ...buildFeatureNotificationFromType(typeDef, {
        requiredFeature: MERCHANT_DECIDE_FEATURE,
        bodyVariables: {
          amountGross: input.amountGross,
          currencyCode: input.currencyCode,
        },
        sourceEntityType: 'customer_groups:purchase_approval',
        sourceEntityId: input.approvalId,
        groupKey: `customer_groups.approval.requested:${input.approvalId}`,
      }),
      restrictRecipientsToOrganization: true,
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}
