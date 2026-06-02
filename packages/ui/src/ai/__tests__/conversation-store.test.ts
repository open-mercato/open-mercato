import { listAiServerConversations, loadAiServerTranscript } from '../conversation-store'

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

  describe('loadAiServerTranscript', () => {
    it('returns ok=true with parsed data on 200', async () => {
      const payload = {
        conversation: {
          conversationId: 'conv-1',
          agentId: 'agent-1',
          title: null,
          status: 'open',
          visibility: 'private',
          pageContext: null,
          createdAt: '2026-05-28T00:00:00Z',
          updatedAt: '2026-05-28T00:00:00Z',
          lastMessageAt: null,
          importedFromLocalAt: null,
          isOwner: true,
        },
        messages: [],
        nextCursor: null,
      }
      global.fetch = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch

      const result = await loadAiServerTranscript('conv-1')

      expect(result).toEqual({ ok: true, data: payload })
    })

    it('returns ok=false notFound=true on 404 (stale conversationId from previous scope)', async () => {
      global.fetch = jest.fn(async () => new Response('{"error":"not found"}', { status: 404 })) as unknown as typeof fetch

      const result = await loadAiServerTranscript('conv-from-old-scope')

      expect(result).toEqual({ ok: false, notFound: true })
    })

    it('returns ok=false notFound=false on 503 (transient transport failure)', async () => {
      global.fetch = jest.fn(async () => new Response('{"error":"upstream"}', { status: 503 })) as unknown as typeof fetch

      const result = await loadAiServerTranscript('conv-1')

      expect(result).toEqual({ ok: false, notFound: false })
    })

    it('returns ok=false notFound=false on 403 (no scope membership)', async () => {
      global.fetch = jest.fn(async () => new Response('{"error":"forbidden"}', { status: 403 })) as unknown as typeof fetch

      const result = await loadAiServerTranscript('conv-1')

      expect(result).toEqual({ ok: false, notFound: false })
    })

    it('returns ok=false notFound=false when fetch throws', async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch

      const result = await loadAiServerTranscript('conv-1')

      expect(result).toEqual({ ok: false, notFound: false })
    })

    it('forwards the limit option as a query string', async () => {
      const fetchMock = jest.fn(async () => new Response('{}', { status: 404 }))
      global.fetch = fetchMock as unknown as typeof fetch

      await loadAiServerTranscript('conv-1', { limit: 25 })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ai_assistant/ai/conversations/conv-1?limit=25',
        expect.any(Object),
      )
    })
  })
})
