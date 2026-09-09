import { resolveNotificationService } from '../../../notifications/lib/notificationService'
import {
  deliverEudrNotification,
  type EudrNotificationTypeId,
} from '../notifications'

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

const resolveNotificationServiceMock = resolveNotificationService as jest.MockedFunction<
  typeof resolveNotificationService
>

const createForFeature = jest.fn().mockResolvedValue([])
const container = { resolve: jest.fn() }

function buildPayload(occurredAt = '2026-07-22T12:00:00.000Z') {
  return {
    tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
    organizationId: '09a2c9be-4a41-47a5-a67c-4ebf6d318024',
    entityId: '956a626c-009d-473e-aa81-3ee089298f8d',
    occurredAt,
    bodyVariables: { statementTitle: 'DDS 2026-001' },
    linkHref: '/backend/eudr/statements/956a626c-009d-473e-aa81-3ee089298f8d',
    sourceEntityType: 'eudr:eudr_due_diligence_statement',
  }
}

async function deliver(
  typeId: EudrNotificationTypeId,
  occurredAt?: string,
): Promise<void> {
  await deliverEudrNotification({
    container,
    typeId,
    payload: buildPayload(occurredAt),
  })
}

describe('deliverEudrNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createForFeature.mockResolvedValue([])
    resolveNotificationServiceMock.mockReturnValue({ createForFeature } as never)
  })

  it('builds a deterministic group key per event occurrence', async () => {
    await deliver('eudr.statement.submitted')
    await deliver('eudr.statement.submitted')
    await deliver('eudr.statement.submitted', '2026-07-22T12:00:01.000Z')

    const firstGroupKey = createForFeature.mock.calls[0]?.[0].groupKey
    const secondGroupKey = createForFeature.mock.calls[1]?.[0].groupKey
    const laterGroupKey = createForFeature.mock.calls[2]?.[0].groupKey
    expect(firstGroupKey).toBe(
      'eudr.statement.submitted:956a626c-009d-473e-aa81-3ee089298f8d:2026-07-22T12:00:00.000Z',
    )
    expect(secondGroupKey).toBe(firstGroupKey)
    expect(laterGroupKey).not.toBe(firstGroupKey)
  })

  it('degrades to a no-op when the notification service is unavailable', async () => {
    resolveNotificationServiceMock.mockImplementation(() => {
      throw new Error('notifications module unavailable')
    })

    await expect(deliver('eudr.statement.submitted')).resolves.toBeUndefined()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('rethrows notification creation errors for persistent delivery retry', async () => {
    const createError = new Error('notification create failed')
    createForFeature.mockRejectedValueOnce(createError)

    await expect(deliver('eudr.statement.submitted')).rejects.toBe(createError)
  })

  it.each<[EudrNotificationTypeId, string]>([
    ['eudr.statement.submitted', 'eudr.statements.manage'],
    ['eudr.statement.reference_issued', 'eudr.statements.manage'],
    ['eudr.statement.withdrawn', 'eudr.statements.manage'],
    ['eudr.risk.non_negligible', 'eudr.risk.manage'],
    ['eudr.mitigation.completed', 'eudr.risk.manage'],
  ])('maps %s to feature %s', async (typeId, expectedFeature) => {
    await deliver(typeId)

    expect(createForFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredFeature: expectedFeature,
        restrictRecipientsToOrganization: true,
      }),
      expect.anything(),
    )
  })

  it('binds the organization filter and row scope to the same context organization', async () => {
    await deliver('eudr.statement.submitted')

    const [input, context] = createForFeature.mock.calls[0] ?? []
    expect(input).toEqual(expect.objectContaining({ restrictRecipientsToOrganization: true }))
    expect(input).not.toHaveProperty('restrictToOrganizationId')
    expect(context).toEqual({
      tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
      organizationId: '09a2c9be-4a41-47a5-a67c-4ebf6d318024',
    })
  })
})
