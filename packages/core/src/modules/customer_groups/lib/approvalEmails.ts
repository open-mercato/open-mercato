import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { urlForCustomerOrg } from '@open-mercato/core/modules/customer_accounts/lib/customerUrl'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerPurchaseApproval, type CustomerPurchaseApprovalActorType } from '../data/entities'
import ApprovalEmail from '../emails/ApprovalEmail'
import { listCompanyCustomerUserCandidates, resolveCustomerUserEmail } from './approvalEmailRecipients'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (D-R5-6, §10.2, Step 2.7). Buyer-side e-mail for approvals,
// through the shared `sendEmail` pipeline — never the staff in-app notification
// system (which has no `CustomerUser` recipient channel, `lib/approvalNotifications.ts`'s
// own comment). `customer_accounts` (for `customerRbacService`, the portal decide
// feature check) and `configs` (for the per-tenant switch) are both optional peers —
// resolved with `tryResolve`, degrading to "skip the e-mail" rather than throwing,
// per `packages/core/AGENTS.md` → Cross-Module Coupling.

export type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type CustomerRbacServiceLike = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string; organizationId: string },
  ): Promise<boolean>
}

function tryResolve<T>(container: ResolverContainer, name: string): T | null {
  try {
    const value = container.resolve<T>(name)
    return (value ?? null) as T | null
  } catch {
    return null
  }
}

export const APPROVAL_EMAILS_ENABLED_CONFIG_MODULE_ID = 'customer_groups'
export const APPROVAL_EMAILS_ENABLED_CONFIG_NAME = 'approval_emails_enabled'
const DEFAULT_APPROVAL_EMAILS_ENABLED = true

// D-R5-6: "on by default and switchable off per tenant through `ModuleConfigService`
// ... key `customer_groups.approval_emails_enabled`." Same call shape
// `customerPurchaseApprovalService.ts`'s own `resolveApprovalExpiryDays` already
// established for this module's one other `ModuleConfigService` read.
export async function resolveApprovalEmailsEnabled(
  moduleConfigService: ModuleConfigService | null,
  scope: { tenantId: string },
): Promise<boolean> {
  if (!moduleConfigService) return DEFAULT_APPROVAL_EMAILS_ENABLED
  const raw = await moduleConfigService.getValue<boolean>(
    APPROVAL_EMAILS_ENABLED_CONFIG_MODULE_ID,
    APPROVAL_EMAILS_ENABLED_CONFIG_NAME,
    { defaultValue: DEFAULT_APPROVAL_EMAILS_ENABLED, scope: { tenantId: scope.tenantId } },
  )
  return typeof raw === 'boolean' ? raw : DEFAULT_APPROVAL_EMAILS_ENABLED
}

const BUYER_DECIDE_FEATURE = 'customer_groups.portal.approvals.decide'

export type ApprovalRequestedEmailInput = {
  tenantId: string
  organizationId: string
  approvalId: string
  customerId: string
  amountGross: string
  currencyCode: string
  approvalPolicy: 'buyer' | 'merchant' | 'both'
  requestedBy: { actorType: CustomerPurchaseApprovalActorType; actorId: string }
}

// §10.2: "Every `CustomerUser` of the approval's company holding
// `customer_groups.portal.approvals.decide`, except the requester" — gated to
// policy `buyer`/`both`. The `requested_email_sent_at` CAS marker (claimed BEFORE
// any send is attempted, same "claim then act" ordering `decideApproval`'s own CAS
// already uses) makes the whole batch exactly-once per approval even under a
// persistent-subscriber retry: `sendEmail` has no dedup of its own, unlike the
// sibling in-app notification, which dedupes per recipient via the notification
// system's `groupKey`.
export async function sendApprovalRequestedBuyerEmails(
  em: EntityManager,
  container: ResolverContainer,
  input: ApprovalRequestedEmailInput,
): Promise<void> {
  if (input.approvalPolicy !== 'buyer' && input.approvalPolicy !== 'both') return

  const moduleConfigService = tryResolve<ModuleConfigService>(container, 'moduleConfigService')
  if (!(await resolveApprovalEmailsEnabled(moduleConfigService, { tenantId: input.tenantId }))) return

  const rbacService = tryResolve<CustomerRbacServiceLike>(container, 'customerRbacService')
  if (!rbacService) {
    logger.debug('[customer_groups:approval-emails] customerRbacService unavailable, skipping buyer decider e-mail', {
      approvalId: input.approvalId,
    })
    return
  }

  const claimed = await em.nativeUpdate(
    CustomerPurchaseApproval,
    {
      id: input.approvalId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      requestedEmailSentAt: null,
    },
    { requestedEmailSentAt: new Date() },
  )
  if (claimed === 0) return

  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const candidates = await listCompanyCustomerUserCandidates(em, input.customerId, input.tenantId)
  const recipients: string[] = []
  for (const candidate of candidates) {
    if (input.requestedBy.actorType === 'customer_user' && input.requestedBy.actorId === candidate.id) continue
    const allowed = await rbacService.userHasAllFeatures(candidate.id, [BUYER_DECIDE_FEATURE], scope)
    if (allowed) recipients.push(candidate.email)
  }
  if (!recipients.length) return

  const { translate } = await resolveTranslations()
  const portalUrl = await urlForCustomerOrg(input.organizationId, '/')
  const vars = { amountGross: input.amountGross, currencyCode: input.currencyCode }
  const subject = translate('customer_groups.approvalEmail.requested.subject', 'A purchase needs your approval')
  const copy = {
    preview: translate('customer_groups.approvalEmail.requested.preview', 'A purchase is waiting for your decision.'),
    title: translate('customer_groups.approvalEmail.requested.title', 'A purchase needs your approval'),
    body: translate(
      'customer_groups.approvalEmail.requested.body',
      'A purchase of {amountGross} {currencyCode} needs your approval before it can proceed.',
      vars,
    ),
    cta: translate('customer_groups.approvalEmail.requested.cta', 'Review in your account'),
    hint: translate(
      'customer_groups.approvalEmail.requested.hint',
      'This request was sent to every approver authorized for your company account.',
    ),
  }

  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject,
        react: ApprovalEmail({ portalUrl, copy }),
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }),
    ),
  )
}

export type ApprovalDecidedEmailInput = {
  tenantId: string
  organizationId: string
  approvalId: string
  amountGross: string
  currencyCode: string
  status: 'approved' | 'rejected' | 'expired'
  requestedBy: { actorType: CustomerPurchaseApprovalActorType; actorId: string }
}

const DECIDED_FALLBACKS: Record<'approved' | 'rejected' | 'expired', { title: string; body: string }> = {
  approved: {
    title: 'Your purchase request was approved',
    body: 'Your purchase request for {amountGross} {currencyCode} has been approved.',
  },
  rejected: {
    title: 'Your purchase request was rejected',
    body: 'Your purchase request for {amountGross} {currencyCode} has been rejected.',
  },
  expired: {
    title: 'Your purchase request expired',
    body: 'Your purchase request for {amountGross} {currencyCode} expired without a decision.',
  },
}

// §10.2: "The requester, when a `customer_user`." Deliberately not called for
// `.withdrawn` — the spec's own e-mail trigger table names only
// `.approved`/`.rejected`/`.expired`; a withdrawal is always either the requester's
// own action or a system cleanup of their basket, so there is nothing to tell them
// they do not already know. See PLAN.md "Decisions taken without the owner". Also
// not called for a `staff_user` requester (no Release 5 path creates one, X7) — the
// guard stays anyway, since nothing here assumes it.
export async function sendApprovalDecidedRequesterEmail(
  em: EntityManager,
  container: ResolverContainer,
  input: ApprovalDecidedEmailInput,
): Promise<void> {
  if (input.requestedBy.actorType !== 'customer_user') return

  const moduleConfigService = tryResolve<ModuleConfigService>(container, 'moduleConfigService')
  if (!(await resolveApprovalEmailsEnabled(moduleConfigService, { tenantId: input.tenantId }))) return

  const claimed = await em.nativeUpdate(
    CustomerPurchaseApproval,
    {
      id: input.approvalId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      decidedEmailSentAt: null,
    },
    { decidedEmailSentAt: new Date() },
  )
  if (claimed === 0) return

  const email = await resolveCustomerUserEmail(em, input.requestedBy.actorId, input.tenantId)
  if (!email) return

  const { translate } = await resolveTranslations()
  const portalUrl = await urlForCustomerOrg(input.organizationId, '/')
  const vars = { amountGross: input.amountGross, currencyCode: input.currencyCode }
  const fallback = DECIDED_FALLBACKS[input.status]
  const subject = translate('customer_groups.approvalEmail.decided.subject', 'Update on your purchase approval request')
  const copy = {
    preview: translate(
      'customer_groups.approvalEmail.decided.preview',
      'There is an update on your purchase approval request.',
    ),
    title: translate(`customer_groups.approvalEmail.decided.${input.status}.title`, fallback.title, vars),
    body: translate(`customer_groups.approvalEmail.decided.${input.status}.body`, fallback.body, vars),
    cta: translate('customer_groups.approvalEmail.decided.cta', 'View in your account'),
  }

  await sendEmail({
    to: email,
    subject,
    react: ApprovalEmail({ portalUrl, copy }),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}
