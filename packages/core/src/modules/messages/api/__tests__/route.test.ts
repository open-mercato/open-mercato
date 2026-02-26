import { POST } from '@open-mercato/core/modules/messages/api/route'

const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn(async () => true)

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: (...args: unknown[]) => canUseMessageEmailFeatureMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(),
}))

describe('messages /api/messages POST', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = {
      execute: jest.fn(async () => ({
        result: {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          threadId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          externalEmail: null,
          recipientUserIds: [
            'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a',
            '2ce61514-c312-4a54-8ec0-cd9b70d7e76f',
          ],
        },
      })),
    }


    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        auth: { orgId: 'd5aa0e9a-4359-49a0-89a3-fdec0785fdb8' },
        container: {
          resolve: (name: string) => {
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      },
      scope: {
        tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
        organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
        userId: '5be8e4d6-14d2-4352-8f55-b95f95fd9205',
      },
    })
  })

  it('composes message via command bus when message is sent', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
          { userId: '2ce61514-c312-4a54-8ec0-cd9b70d7e76f', type: 'cc' },
        ],
        subject: 'Subject',
        body: 'Body',
      }),
    }))

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({
        input: expect.objectContaining({
          subject: 'Subject',
          body: 'Body',
          sendViaEmail: false,
          tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
          organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
          userId: '5be8e4d6-14d2-4352-8f55-b95f95fd9205',
        }),
      }),
    )
  })

  it('passes draft compose input to command bus without route side effects', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
        ],
        subject: 'Subject',
        body: 'Body',
        isDraft: true,
      }),
    }))

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })
})
