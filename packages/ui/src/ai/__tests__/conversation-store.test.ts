import { listAiServerConversations } from '../conversation-store'

describe('AI conversation store', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('suppresses auth redirects for optional conversation sync calls', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(listAiServerConversations({ limit: 100 })).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai_assistant/ai/conversations?limit=100',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'x-om-forbidden-redirect': '0',
          'x-om-unauthorized-redirect': '0',
        }),
      }),
    )
  })
})
