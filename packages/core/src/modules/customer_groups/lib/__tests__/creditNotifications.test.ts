// Release 5 Phase 3 (G15, Step 1.8) — recipient resolution for the
// `customer_groups.credit.limit_exceeded` notification: the company's `account_manager`
// when one is assigned (`CustomerEntityRole`), otherwise every staff user holding
// `customer_groups.credit.manage` in the organization. Shared by the limit-exceeded
// subscriber and the exposure-audit job, so this test covers both call sites.

const createMock = jest.fn(async () => ({}))
const createForFeatureMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ create: createMock, createForFeature: createForFeatureMock }))
const buildNotificationFromTypeMock = jest.fn((typeDef: unknown, options: unknown) => ({ typeDef, ...(options as object) }))
const buildFeatureNotificationFromTypeMock = jest.fn((typeDef: unknown, options: unknown) => ({ typeDef, ...(options as object) }))
const resolveAccountManagerUserIdMock = jest.fn()
const resolveCustomerEntityKindMock = jest.fn()

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('../../../notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: (...args: unknown[]) => buildNotificationFromTypeMock(...args),
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))
jest.mock('../../notifications', () => ({
  notificationTypes: [
    { type: 'customer_groups.credit.limit_exceeded', module: 'customer_groups', titleKey: 'customer_groups.notifications.creditLimitExceeded.title' },
  ],
}))
jest.mock('../creditIdentity', () => ({
  resolveAccountManagerUserId: (...args: unknown[]) => resolveAccountManagerUserIdMock(...args),
  resolveCustomerEntityKind: (...args: unknown[]) => resolveCustomerEntityKindMock(...args),
}))

import { createCreditLimitExceededNotification } from '../creditNotifications'

describe('createCreditLimitExceededNotification', () => {
  const em = {} as unknown as import('@mikro-orm/postgresql').EntityManager
  const container = { resolve: jest.fn() }

  const input = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    creditAccountId: 'account-1',
    customerId: 'company-1',
    currencyCode: 'USD',
    requestedAmount: '150.00',
    creditLimit: '100.00',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies the company account manager directly when one is assigned', async () => {
    resolveAccountManagerUserIdMock.mockResolvedValue('manager-user-1')
    resolveCustomerEntityKindMock.mockResolvedValue('company')

    await createCreditLimitExceededNotification(em, container, input)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createForFeatureMock).not.toHaveBeenCalled()
    expect(buildNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer_groups.credit.limit_exceeded' }),
      expect.objectContaining({
        recipientUserId: 'manager-user-1',
        sourceEntityId: 'account-1',
        sourceEntityType: 'customer_groups:credit_account',
        linkHref: '/backend/customers/companies/company-1',
        groupKey: 'customer_groups.credit.limit_exceeded:account-1',
        bodyVariables: { requestedAmount: '150.00', currencyCode: 'USD', creditLimit: '100.00' },
      }),
    )
    expect(createMock).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('falls back to staff holding credit.manage when no account manager is assigned', async () => {
    resolveAccountManagerUserIdMock.mockResolvedValue(null)
    resolveCustomerEntityKindMock.mockResolvedValue('person')

    await createCreditLimitExceededNotification(em, container, input)

    expect(createForFeatureMock).toHaveBeenCalledTimes(1)
    expect(createMock).not.toHaveBeenCalled()
    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer_groups.credit.limit_exceeded' }),
      expect.objectContaining({
        requiredFeature: 'customer_groups.credit.manage',
        linkHref: '/backend/customers/people/company-1',
      }),
    )
    expect(createForFeatureMock).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
