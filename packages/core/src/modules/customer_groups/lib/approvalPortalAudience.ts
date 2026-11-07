import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveCustomerUserCompanyId } from './creditIdentity'

export const NO_PORTAL_RECIPIENT_ID = '00000000-0000-0000-0000-000000000000'
export const PORTAL_APPROVAL_DECIDE_FEATURE = 'customer_groups.portal.approvals.decide'

const MAX_APPROVER_RECIPIENTS = 100
const CUSTOMER_USERS_TABLE = 'customer_users'

export type PortalApprovalRbac = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string; organizationId: string },
  ) => Promise<boolean>
}

export type ApprovalAudienceFacts = {
  tenantId: string
  organizationId: string
  customerId: string
  requestedByActorType: string
  requestedByActorId: string
}

async function listCompanyCustomerUserIds(
  em: EntityManager,
  facts: ApprovalAudienceFacts,
): Promise<string[]> {
  const rows = await em.execute<Array<{ id?: unknown }>>(
    `select id from ${CUSTOMER_USERS_TABLE}
      where tenant_id = ? and organization_id = ? and customer_entity_id = ? and deleted_at is null
      order by id
      limit ${MAX_APPROVER_RECIPIENTS}`,
    [facts.tenantId, facts.organizationId, facts.customerId],
  )
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export async function resolveApprovalPortalRecipientIds(input: {
  em: EntityManager
  rbac: PortalApprovalRbac | null
  approval: ApprovalAudienceFacts
}): Promise<string[]> {
  const { em, rbac, approval } = input
  const recipients = new Set<string>()
  const scope = { tenantId: approval.tenantId, organizationId: approval.organizationId }

  if (approval.requestedByActorType === 'customer_user' && approval.requestedByActorId) {
    try {
      const companyId = await resolveCustomerUserCompanyId(em, approval.requestedByActorId, approval.tenantId)
      if (companyId === approval.customerId) recipients.add(approval.requestedByActorId)
    } catch {
      // the requester stays out of the audience when their company membership cannot be proven
    }
  }

  if (rbac) {
    try {
      for (const userId of await listCompanyCustomerUserIds(em, approval)) {
        if (recipients.has(userId)) continue
        if (await rbac.userHasAllFeatures(userId, [PORTAL_APPROVAL_DECIDE_FEATURE], scope)) recipients.add(userId)
      }
    } catch {
      // approvers whose entitlement cannot be proven are simply not targeted
    }
  }

  return recipients.size > 0 ? Array.from(recipients) : [NO_PORTAL_RECIPIENT_ID]
}
