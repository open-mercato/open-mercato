import { GET } from '../route'

const getDeclaredEventsMock = jest.fn()

jest.mock('@open-mercato/shared/modules/events', () => ({
  getDeclaredEvents: () => getDeclaredEventsMock(),
}))

describe('webhooks events route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('filters webhook and trigger-excluded events from the response', async () => {
    getDeclaredEventsMock.mockReturnValue([
      {
        id: 'catalog.product.created',
        label: 'Product created',
      },
      {
        id: 'sales.document.calculate.before',
        label: 'Before document calculate',
        excludeFromTriggers: true,
      },
      {
        id: 'webhooks.delivery.succeeded',
        label: 'Webhook delivery succeeded',
      },
    ])

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'catalog.product.created',
          label: 'Product created',
        },
      ],
      total: 1,
    })
  })
})
