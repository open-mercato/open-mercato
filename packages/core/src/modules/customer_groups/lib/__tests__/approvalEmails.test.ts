// Release 5 Phase 4 (D-R5-6, §10.2, Step 2.7). Buyer-side approval e-mail: fan-out
// to eligible company deciders (policy buyer/both), the single requester e-mail on
// a terminal decision, the per-tenant switch, and per-recipient delivery dedup that
// survives a partial failure (#8268 review Major 3).

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
jest.mock('../../data/entities', () => ({
  CustomerPurchaseApproval: class {},
  CustomerPurchaseApprovalEmailDelivery: class {},
}))

import {
  resolveApprovalEmailsEnabled,
  sendApprovalRequestedBuyerEmails,
  sendApprovalDecidedRequesterEmail,
} from '../approvalEmails'

type DeliveryRow = { kind: string; recipientKey: string }

// A minimal `EntityManager` stand-in for the delivery ledger: `find` reads the rows
// already "committed", `create`/`persist`/`flush` commit a new one (or throw, when
// `failFlushFor` says so, simulating a transient transport/DB failure AFTER
// `sendEmail` already resolved for that recipient). `flush` has no internal `await` —
// it commits synchronously within the microtask that calls it — so concurrent
// recipients in a `Promise.all` batch never interleave their create→persist→flush.
function makeEm(options: {
  delivered?: DeliveryRow[]
  failFlushFor?: (kind: string, recipientKey: string) => boolean
} = {}) {
  const deliveries: DeliveryRow[] = [...(options.delivered ?? [])]
  let pending: DeliveryRow | null = null
  const nativeUpdate = jest.fn(async () => 1)
  const em: Record<string, unknown> = {
    find: jest.fn(async (_entity: unknown, where: { kind: string }) =>
      deliveries.filter((row) => row.kind === where.kind).map((row) => ({ recipientKey: row.recipientKey }))),
    nativeUpdate,
    create: jest.fn((_entity: unknown, data: DeliveryRow) => {
      pending = { kind: data.kind, recipientKey: data.recipientKey }
      return data
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {
      if (!pending) return
      const toInsert = pending
      pending = null
      if (options.failFlushFor?.(toInsert.kind, toInsert.recipientKey)) throw new Error('transport failure')
      deliveries.push(toInsert)
    }),
  }
  em.fork = () => em
  return { em: em as unknown as import('@mikro-orm/postgresql').EntityManager, deliveries, nativeUpdate }
}

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
    const { em } = makeEm()
    await sendApprovalRequestedBuyerEmails(em, makeContainer(), { ...baseInput, approvalPolicy: 'merchant' })
    expect(listCompanyCustomerUserCandidatesMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when the per-tenant e-mail switch is off', async () => {
    const { em } = makeEm()
    const moduleConfigService = { getValue: jest.fn(async () => false) }
    await sendApprovalRequestedBuyerEmails(em, makeContainer({ moduleConfigService }), baseInput)
    expect(listCompanyCustomerUserCandidatesMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when customerRbacService is unavailable (optional peer absent)', async () => {
    const { em } = makeEm()
    await sendApprovalRequestedBuyerEmails(em, makeContainer(), baseInput)
    expect(listCompanyCustomerUserCandidatesMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is a no-op on redelivery once every eligible recipient already has a delivery row', async () => {
    const { em, nativeUpdate } = makeEm({ delivered: [{ kind: 'requested', recipientKey: 'decider-1' }] })
    listCompanyCustomerUserCandidatesMock.mockResolvedValueOnce([{ id: 'decider-1', email: 'decider1@example.com' }])
    const userHasAllFeatures = jest.fn(async () => true)
    await sendApprovalRequestedBuyerEmails(
      em,
      makeContainer({ moduleConfigService: { getValue: jest.fn(async () => true) }, customerRbacService: { userHasAllFeatures } }),
      baseInput,
    )
    expect(sendEmailMock).not.toHaveBeenCalled()
    // Still marks the batch-complete bookkeeping column, even though nothing was sent.
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('e-mails every eligible decider except the requester, policy both', async () => {
    const { em } = makeEm()
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
    const { em } = makeEm()
    listCompanyCustomerUserCandidatesMock.mockResolvedValueOnce([{ id: 'decider-1', email: 'decider1@example.com' }])
    const userHasAllFeatures = jest.fn(async () => false)
    await sendApprovalRequestedBuyerEmails(
      em,
      makeContainer({ moduleConfigService: { getValue: jest.fn(async () => true) }, customerRbacService: { userHasAllFeatures } }),
      { ...baseInput, approvalPolicy: 'buyer' },
    )
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // #8268 review Major 3: the core regression. One recipient's delivery fails AFTER
  // `sendEmail` resolved for a sibling recipient in the same batch — the sibling's
  // delivery row must still be committed (not rolled back by the other's failure), and
  // a redelivery must retry ONLY the one that never got a row, never re-send to the
  // one that already did.
  it('a one-shot delivery failure for one recipient does not lose the sibling delivery, and redelivery retries only the failed one', async () => {
    let decider2Attempts = 0
    const { em, deliveries } = makeEm({
      // Fails decider-2's FIRST delivery attempt only — a one-shot transient failure,
      // not a permanent refusal — so the redelivery below can succeed.
      failFlushFor: (_kind, recipientKey) => recipientKey === 'decider-2' && ++decider2Attempts === 1,
    })
    listCompanyCustomerUserCandidatesMock.mockResolvedValue([
      { id: 'decider-1', email: 'decider1@example.com' },
      { id: 'decider-2', email: 'decider2@example.com' },
    ])
    const userHasAllFeatures = jest.fn(async () => true)
    const container = makeContainer({
      moduleConfigService: { getValue: jest.fn(async () => true) },
      customerRbacService: { userHasAllFeatures },
    })

    await expect(sendApprovalRequestedBuyerEmails(em, container, baseInput)).rejects.toThrow('transport failure')

    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    // decider-1's delivery survived decider-2's failure.
    expect(deliveries).toEqual([{ kind: 'requested', recipientKey: 'decider-1' }])

    sendEmailMock.mockClear()
    await sendApprovalRequestedBuyerEmails(em, container, baseInput)

    // Redelivery only retries decider-2 — decider-1 is never e-mailed twice.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'decider2@example.com' }))
    expect(deliveries.map((row) => row.recipientKey).sort()).toEqual(['decider-1', 'decider-2'])
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
    const { em } = makeEm()
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), {
      ...baseInput,
      requestedBy: { actorType: 'staff_user', actorId: 'staff-1' },
    })
    expect(resolveCustomerUserEmailMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when the per-tenant e-mail switch is off', async () => {
    const { em } = makeEm()
    await sendApprovalDecidedRequesterEmail(em, makeContainer({ getValue: jest.fn(async () => false) }), baseInput)
    expect(resolveCustomerUserEmailMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('is a no-op on redelivery once the requester already has a delivery row', async () => {
    const { em, nativeUpdate } = makeEm({ delivered: [{ kind: 'decided', recipientKey: 'requester-1' }] })
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)
    expect(resolveCustomerUserEmailMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('e-mails the requester once resolved, status approved', async () => {
    const { em } = makeEm()
    resolveCustomerUserEmailMock.mockResolvedValueOnce('requester@example.com')
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'requester@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
  })

  it('sends nothing when the requester e-mail cannot be resolved', async () => {
    const { em } = makeEm()
    resolveCustomerUserEmailMock.mockResolvedValueOnce(null)
    await sendApprovalDecidedRequesterEmail(em, makeContainer(), baseInput)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // #8268 review Major 3: a transient lookup/transport failure must not leave a
  // permanent "delivered" marker with nothing actually sent — a forced redelivery must
  // still retry, and once it succeeds, a THIRD delivery must not double-send.
  it('retries after a one-shot transport failure, then never double-sends on a further redelivery', async () => {
    let attempt = 0
    sendEmailMock.mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('transport failure')
    })
    const { em, deliveries } = makeEm()
    resolveCustomerUserEmailMock.mockResolvedValue('requester@example.com')
    const container = makeContainer()

    await expect(sendApprovalDecidedRequesterEmail(em, container, baseInput)).rejects.toThrow('transport failure')
    expect(deliveries).toEqual([])

    await sendApprovalDecidedRequesterEmail(em, container, baseInput)
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    expect(deliveries).toEqual([{ kind: 'decided', recipientKey: 'requester-1' }])

    await sendApprovalDecidedRequesterEmail(em, container, baseInput)
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
  })
})
