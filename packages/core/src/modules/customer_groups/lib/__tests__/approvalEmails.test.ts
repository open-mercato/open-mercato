// Release 5 Phase 4 (D-R5-6, §10.2, Step 2.7). Buyer-side approval e-mail: fan-out
// to eligible company deciders (policy buyer/both), the single requester e-mail on
// a terminal decision, the per-tenant switch, and the CAS markers that make each
// e-mail batch exactly-once under a persistent-subscriber redelivery.

const sendEmailMock = jest.fn(async () => {})
const translateMock = jest.fn((_key: string, fallback?: string) => fallback ?? '')
const resolveTranslationsMock = jest.fn(async () => ({ translate: translateMock }))
const urlForCustomerOrgMock = jest.fn(async () => 'https://shop.example.com/')
const listCompanyCustomerUserCandidatesMock = jest.fn(async () => [] as Array<{ id: string; email: string }>)
const resolveCustomerUserEmailMock = jest.fn(async () => null as string | null)

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => resolveTranslationsMock(...args),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerUrl', () => ({
  urlForCustomerOrg: (...args: unknown[]) => urlForCustomerOrgMock(...args),
}))
jest.mock('../approvalEmailRecipients', () => ({
  listCompanyCustomerUserCandidates: (...args: unknown[]) => listCompanyCustomerUserCandidatesMock(...args),
  resolveCustomerUserEmail: (...args: unknown[]) => resolveCustomerUserEmailMock(...args),
}))
jest.mock('../../data/entities', () => ({ CustomerPurchaseApproval: class {} }))

import {
  resolveApprovalEmailsEnabled,
  sendApprovalRequestedBuyerEmails,
  sendApprovalDecidedRequesterEmail,
} from '../approvalEmails'

describe('resolveApprovalEmailsEnabled', () => {
  beforeEach(() => jest.clearAllMocks())

  it('defaults to enabled with no moduleConfigService', async () => {
    await expect(resolveApprovalEmailsEnabled(null, { tenantId: 'tenant-1' })).resolves.toBe(true)
  })

  it('reads the per-tenant switch when moduleConfigService is available', async () => {
    const getValue = jest.fn(async () => false)
    await expect(
      resolveApprovalEmailsEnabled({ getValue } as unknown as Parameters<typeof resolveApprovalEmailsEnabled>[0], { tenantId: 'tenant-1' }),
    ).resolves.toBe(false)
    expect(getValue).toHaveBeenCalledWith('customer_groups', 'approval_emails_enabled', {
      defaultValue: true,
      scope: { tenantId: 'tenant-1' },
    })
  })
})

describe('sendApprovalRequestedBuyerEmails', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    customerId: 'company-1',
    amountGross: '500.00',
    currencyCode: 'USD',
    approvalPolicy: 'both' as const,
    requestedBy: { actorType: 'customer_user' as const, actorId: 'requester-1' },
  }

  function makeEm(claimed: number) {
    return { nativeUpdate: jest.fn(async () => claimed) } as unknown as import('@mikro-orm/postgresql').EntityManager
  }

  function makeContainer(opts: { moduleConfigService?: unknown; customerRbacService?: unknown } = {}) {
    return {
      resolve: jest.fn((name: string) => {
        if (name === 'moduleConfigService') {
          if (!('moduleConfigService' in opts)) throw new Error('not registered')
          return opts.moduleConfigService
        }
        if (name === 'customerRbacService') {
          if (!('customerRbacService' in opts)) throw new Error('not registered')
          return opts.customerRbacService
        }
        throw new Error(`unexpected resolve: ${name}`)
      }),
    }
  }

  beforeEach(() => jest.clearAllMocks())

  it('skips entirely for policy merchant (no buyer slot)', async () => {
    const em = makeEm(1)
    await sendApprovalRequestedBuyerEmails(em, makeContainer(), { ...baseInput, approvalPolicy: 'merchant' })
    expect((em.nativeUpdate as jest.Mock)).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when the per-tenant e-mail switch is off', async () => {
    const em = makeEm(1)
    const moduleConfigService = { getValue: jest.fn(async () => false) }
    await sendApprovalRequestedBuyerEmails(em, makeContainer({ moduleConfigService }), baseInput)
    expect((em.nativeUpdate as jest.Mock)).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when customerRbacService is unavailable (optional peer absent)', async () => {
    const em = makeEm(1)
    await sendApprovalRequestedBuyerEmails(em, makeContainer(), baseInput)
    expect((em.nativeUpdate as jest.Mock)).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is a no-op on redelivery once the requested e-mail batch is already claimed', async () => {
    const em = makeEm(0)
    const userHasAllFeatures = jest.fn(async () => true)
    await sendApprovalRequestedBuyerEmails(
      em,
      makeContainer({ moduleConfigService: { getValue: jest.fn(async () => true) }, customerRbacService: { userHasAllFeatures } }),
      baseInput,
    )
    expect(listCompanyCustomerUserCandidatesMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('e-mails every eligible decider except the requester, policy both', async () => {
    const em = makeEm(1)
    listCompanyCustomerUserCandidatesMock.mockResolvedValueOnce([
      { id: 'decider-1', email: 'decider1@example.com' },
      { id: 'requester-1', email: 'requester@example.com' },
      { id: 'decider-2', email: 'decider2@example.com' },
    ])
    const userHasAllFeatures = jest.fn(async (userId: string) => userId !== 'decider-2')
    await sendApprovalRequestedBuyerEmails(
      em,
      makeContainer({ moduleConfigService: { getValue: jest.fn(async () => true) }, customerRbacService: { userHasAllFeatures } }),
      baseInput,
    )

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'decider1@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
    expect(userHasAllFeatures).not.toHaveBeenCalledWith('requester-1', expect.anything(), expect.anything())
  })

  it('sends nothing for policy buyer when no decider is eligible', async () => {
    const em = makeEm(1)
    listCompanyCustomerUserCandidatesMock.mockResolvedValueOnce([{ id: 'decider-1', email: 'decider1@example.com' }])
    const userHasAllFeatures = jest.fn(async () => false)
    await sendApprovalRequestedBuyerEmails(
      em,
      makeContainer({ moduleConfigService: { getValue: jest.fn(async () => true) }, customerRbacService: { userHasAllFeatures } }),
      { ...baseInput, approvalPolicy: 'buyer' },
    )
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('sendApprovalDecidedRequesterEmail', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    amountGross: '500.00',
    currencyCode: 'USD',
    status: 'approved' as const,
    requestedBy: { actorType: 'customer_user' as const, actorId: 'requester-1' },
  }

  function makeEm(claimed: number) {
    return { nativeUpdate: jest.fn(async () => claimed) } as unknown as import('@mikro-orm/postgresql').EntityManager
  }

  function makeContainer(moduleConfigService?: unknown) {
    return {
      resolve: jest.fn((name: string) => {
        if (name === 'moduleConfigService') {
          if (moduleConfigService === undefined) throw new Error('not registered')
          return moduleConfigService
        }
        throw new Error(`unexpected resolve: ${name}`)
      }),
    }
  }

  beforeEach(() => jest.clearAllMocks())

  it('never e-mails a staff requester (no Release 5 path creates one, X7)', async () => {
    const em = makeEm(1)
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), {
      ...baseInput,
      requestedBy: { actorType: 'staff_user', actorId: 'staff-1' },
    })
    expect((em.nativeUpdate as jest.Mock)).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when the per-tenant e-mail switch is off', async () => {
    const em = makeEm(1)
    await sendApprovalDecidedRequesterEmail(em, makeContainer({ getValue: jest.fn(async () => false) }), baseInput)
    expect((em.nativeUpdate as jest.Mock)).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is a no-op on redelivery once the decided e-mail is already claimed', async () => {
    const em = makeEm(0)
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)
    expect(resolveCustomerUserEmailMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('e-mails the requester once resolved, status approved', async () => {
    const em = makeEm(1)
    resolveCustomerUserEmailMock.mockResolvedValueOnce('requester@example.com')
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'requester@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
  })

  it('sends nothing when the requester e-mail cannot be resolved', async () => {
    const em = makeEm(1)
    resolveCustomerUserEmailMock.mockResolvedValueOnce(null)
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
