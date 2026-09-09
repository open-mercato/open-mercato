import {
  AiModerationUnavailableError,
  createModerationService,
  DEFAULT_MODERATION_MODEL,
} from '../moderation'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function moderationBody(flagged: boolean): unknown {
  return {
    results: [
      {
        flagged,
        categories: { hate: flagged, violence: false },
        category_scores: { hate: flagged ? 0.97 : 0.01, violence: 0.002 },
      },
    ],
  }
}

describe('createModerationService.checkInput', () => {
  const service = createModerationService()
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('returns flagged=false with mapped categories for clean input', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(moderationBody(false)))
    const result = await service.checkInput({ text: 'hello', apiKey: 'sk-test' })
    expect(result.flagged).toBe(false)
    expect(result.categories.hate).toEqual({ flagged: false, score: 0.01 })
    expect(result.categories.violence).toEqual({ flagged: false, score: 0.002 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns flagged=true with category flags + scores for flagged input', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(moderationBody(true)))
    const result = await service.checkInput({ text: 'bad', apiKey: 'sk-test' })
    expect(result.flagged).toBe(true)
    expect(result.categories.hate).toEqual({ flagged: true, score: 0.97 })
  })

  it('sends the configured model + base URL and bearer auth', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(moderationBody(false)))
    await service.checkInput({
      text: 'hi',
      apiKey: 'sk-secret',
      baseURL: 'https://proxy.example.com/v1/',
      model: 'omni-moderation-2026',
    })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.example.com/v1/moderations')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'omni-moderation-2026', input: 'hi' })
  })

  it('defaults to omni-moderation-latest when no model is supplied', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(moderationBody(false)))
    await service.checkInput({ text: 'hi', apiKey: 'sk-test' })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string).model).toBe(DEFAULT_MODERATION_MODEL)
  })

  it('retries once on a 5xx and succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse(moderationBody(false)))
    const result = await service.checkInput({ text: 'hi', apiKey: 'sk-test' })
    expect(result.flagged).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws AiModerationUnavailableError after a 5xx on both attempts', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    await expect(service.checkInput({ text: 'hi', apiKey: 'sk-test' })).rejects.toBeInstanceOf(
      AiModerationUnavailableError,
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws AiModerationUnavailableError on repeated network/timeout errors', async () => {
    fetchSpy.mockRejectedValue(new Error('AbortError: timed out'))
    await expect(service.checkInput({ text: 'hi', apiKey: 'sk-test' })).rejects.toBeInstanceOf(
      AiModerationUnavailableError,
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx (credential/config error) and fails closed', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))
    await expect(service.checkInput({ text: 'hi', apiKey: 'bad' })).rejects.toBeInstanceOf(
      AiModerationUnavailableError,
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws AiModerationUnavailableError when the response schema is unexpected', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ unexpected: true }))
    await expect(service.checkInput({ text: 'hi', apiKey: 'sk-test' })).rejects.toBeInstanceOf(
      AiModerationUnavailableError,
    )
  })
})
