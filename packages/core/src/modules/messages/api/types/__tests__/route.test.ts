import { GET } from '@open-mercato/core/modules/messages/api/types/route'

const getAllMessageTypesMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getAllMessageTypes: () => getAllMessageTypesMock(),
}))

describe('messages /api/messages/types', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps message type definitions to API response shape', async () => {
    getAllMessageTypesMock.mockReturnValue([
      {
        type: 'default',
        module: 'messages',
        labelKey: 'messages.types.default',
        icon: 'mail',
        color: 'blue',
        allowReply: true,
        allowForward: false,
        actionsExpireAfterHours: 24,
        ui: {
          listItemComponent: 'list.component',
          contentComponent: 'content.component',
          actionsComponent: 'actions.component',
        },
      },
    ])

    const response = await GET()
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.items).toEqual([
      {
        type: 'default',
        module: 'messages',
        labelKey: 'messages.types.default',
        icon: 'mail',
        color: 'blue',
        allowReply: true,
        allowForward: false,
        actionsExpireAfterHours: 24,
        ui: {
          listItemComponent: 'list.component',
          contentComponent: 'content.component',
          actionsComponent: 'actions.component',
        },
      },
    ])
  })
})
