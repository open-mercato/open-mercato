import type { EntityManager } from '@mikro-orm/postgresql'
import {
  NO_PORTAL_RECIPIENT_ID,
  PORTAL_APPROVAL_DECIDE_FEATURE,
  resolveApprovalPortalRecipientIds,
} from '../approvalPortalAudience'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const COMPANY_A = 'company-a'
const COMPANY_B = 'company-b'

type UserRow = { id: string; companyId: string }

const USERS: UserRow[] = [
  { id: 'a-requester', companyId: COMPANY_A },
  { id: 'a-approver', companyId: COMPANY_A },
  { id: 'a-plain', companyId: COMPANY_A },
  { id: 'b-approver', companyId: COMPANY_B },
  { id: 'b-plain', companyId: COMPANY_B },
]

function makeEm(): EntityManager {
  const connection = {
    execute: async (sql: string, params: unknown[]) => {
      if (sql.includes('customer_entity_id from customer_users')) {
        const user = USERS.find((entry) => entry.id === params[0])
        return user ? [{ customer_entity_id: user.companyId }] : []
      }
      return []
    },
  }
  return {
    getConnection: () => connection,
    execute: async (sql: string, params: unknown[]) => {
      if (sql.includes('from customer_users') && sql.includes('customer_entity_id = ?')) {
        return USERS.filter((entry) => entry.companyId === params[2]).map((entry) => ({ id: entry.id }))
      }
      return []
    },
  } as unknown as EntityManager
}

const rbac = {
  userHasAllFeatures: jest.fn(async (userId: string, required: string[]) => {
    return required.includes(PORTAL_APPROVAL_DECIDE_FEATURE) && userId.endsWith('-approver')
  }),
}

function approvalOf(companyId: string, requesterId: string) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    customerId: companyId,
    requestedByActorType: 'customer_user',
    requestedByActorId: requesterId,
  }
}

describe('resolveApprovalPortalRecipientIds', () => {
  beforeEach(() => rbac.userHasAllFeatures.mockClear())

  it('targets exactly the requester and the decide-authorized approvers of the approval company', async () => {
    const recipients = await resolveApprovalPortalRecipientIds({
      em: makeEm(),
      rbac,
      approval: approvalOf(COMPANY_A, 'a-requester'),
    })

    expect(recipients.sort()).toEqual(['a-approver', 'a-requester'])
  })

  it('never includes users of another company, with or without the approve feature (two-company isolation)', async () => {
    const forA = await resolveApprovalPortalRecipientIds({ em: makeEm(), rbac, approval: approvalOf(COMPANY_A, 'a-requester') })
    const forB = await resolveApprovalPortalRecipientIds({ em: makeEm(), rbac, approval: approvalOf(COMPANY_B, 'b-plain') })

    expect(forA).not.toContain('b-approver')
    expect(forA).not.toContain('b-plain')
    expect(forB.sort()).toEqual(['b-approver', 'b-plain'])
    expect(forB).not.toContain('a-approver')
    expect(forB).not.toContain('a-requester')
  })

  it('drops a requester whose live company does not match the approval company', async () => {
    const recipients = await resolveApprovalPortalRecipientIds({
      em: makeEm(),
      rbac,
      approval: approvalOf(COMPANY_B, 'a-requester'),
    })

    expect(recipients).not.toContain('a-requester')
    expect(recipients).toEqual(['b-approver'])
  })

  it('falls back to a sentinel that matches no portal user rather than an empty (broadcast-to-all) audience', async () => {
    const recipients = await resolveApprovalPortalRecipientIds({
      em: makeEm(),
      rbac: null,
      approval: { ...approvalOf(COMPANY_A, 'ghost'), requestedByActorType: 'staff_user' },
    })

    expect(recipients).toEqual([NO_PORTAL_RECIPIENT_ID])
  })

  it('fails closed to the requester only when entitlement lookups throw', async () => {
    const recipients = await resolveApprovalPortalRecipientIds({
      em: makeEm(),
      rbac: { userHasAllFeatures: async () => { throw new Error('rbac unavailable') } },
      approval: approvalOf(COMPANY_A, 'a-requester'),
    })

    expect(recipients).toEqual(['a-requester'])
  })
})
