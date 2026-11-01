import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType, buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { resolveAccountManagerUserId, resolveCustomerEntityKind } from './creditIdentity'

// Release 5 Phase 3 (G15, G21, Step 1.8). Shared by two callers that both need the
// `customer_groups.credit.limit_exceeded` in-app notification but trigger it for different
// reasons and MUST NOT conflate those reasons into one domain event:
//   - `subscribers/credit-limit-exceeded-notification.ts`, on the real
//     `customer_groups.credit.limit_exceeded` event (`reserveCredit` refusing a reservation);
//   - `workers/credit-exposure-audit.ts`, when the daily audit finds an account whose
//     recomputed exposure is both DRIFTING from `balance_after` and over its limit — a bug
//     finding, not a refused reservation, so it never emits the event (whose contract, per
//     spec §10.1, is "emitted on a refused reserveCredit").
// Recipient resolution is identical either way: the company's `account_manager`
// (`CustomerEntityRole`), falling back to staff holding `customer_groups.credit.manage`.

export type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type CreditLimitExceededNotificationInput = {
  tenantId: string
  organizationId: string
  creditAccountId: string
  customerId: string
  currencyCode: string
  requestedAmount: string
  creditLimit: string
}

export async function createCreditLimitExceededNotification(
  em: EntityManager,
  container: ResolverContainer,
  input: CreditLimitExceededNotificationInput,
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'customer_groups.credit.limit_exceeded')
  if (!typeDef) return

  const [accountManagerUserId, kind] = await Promise.all([
    resolveAccountManagerUserId(em, input.customerId, { tenantId: input.tenantId, organizationId: input.organizationId }),
    resolveCustomerEntityKind(em, input.customerId, input.tenantId),
  ])

  const notificationService = resolveNotificationService(container)
  const common = {
    bodyVariables: {
      requestedAmount: input.requestedAmount,
      currencyCode: input.currencyCode,
      creditLimit: input.creditLimit,
    },
    sourceEntityType: 'customer_groups:credit_account',
    sourceEntityId: input.creditAccountId,
    linkHref:
      kind === 'person'
        ? `/backend/customers/people/${input.customerId}`
        : `/backend/customers/companies/${input.customerId}`,
    groupKey: `customer_groups.credit.limit_exceeded:${input.creditAccountId}`,
  }

  if (accountManagerUserId) {
    await notificationService.create(
      buildNotificationFromType(typeDef, { ...common, recipientUserId: accountManagerUserId }),
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    return
  }

  await notificationService.createForFeature(
    buildFeatureNotificationFromType(typeDef, { ...common, requiredFeature: 'customer_groups.credit.manage' }),
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}
