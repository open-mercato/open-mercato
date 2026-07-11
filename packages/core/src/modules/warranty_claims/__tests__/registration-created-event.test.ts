const emitWarrantyClaimsEventMock = jest.fn<Promise<void>, [string, unknown, unknown?]>()

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: (eventId: string, payload: unknown, options?: unknown) =>
    emitWarrantyClaimsEventMock(eventId, payload, options),
}))

import { emitRegistrationCreatedEvent } from '../api/registrations/route'

const REGISTRATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

describe('warranty registration created event hook', () => {
  beforeEach(() => {
    emitWarrantyClaimsEventMock.mockReset()
    emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
  })

  test('emits the declared event with scoped payload after create', async () => {
    await emitRegistrationCreatedEvent({
      id: REGISTRATION_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      serialNumber: 'SN-1',
    })

    expect(emitWarrantyClaimsEventMock).toHaveBeenCalledTimes(1)
    expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
      'warranty_claims.registration.created',
      { registrationId: REGISTRATION_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { persistent: true },
    )
  })

  test('skips emission when the created entity is missing scope identifiers', async () => {
    await emitRegistrationCreatedEvent({ id: REGISTRATION_ID, tenantId: TENANT_ID })
    await emitRegistrationCreatedEvent(null)

    expect(emitWarrantyClaimsEventMock).not.toHaveBeenCalled()
  })
})
