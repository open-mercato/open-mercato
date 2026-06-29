import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { safeOutboundFetch, UnsafeOutboundUrlError } from '@open-mercato/shared/lib/url-safety'

jest.mock('@open-mercato/shared/lib/url-safety', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/url-safety')
  return { ...actual, safeOutboundFetch: jest.fn() }
})

const mockedFetch = safeOutboundFetch as jest.MockedFunction<typeof safeOutboundFetch>

describe('agent_orchestrator.web_fetch', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: webFetchTool, WEB_FETCH_TOOL_ID, WEB_ACCESS_FEATURE } = require('../lib/webFetchTool')
  const tool = webFetchTool as AiToolDefinition
  const call = (url: string) =>
    (tool.handler as (i: unknown, c?: unknown) => Promise<any>)({ url }, {} as never)

  beforeEach(() => mockedFetch.mockReset())

  it('is gated read-only behind the web.access feature', () => {
    expect(tool.name).toBe(WEB_FETCH_TOOL_ID)
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual([WEB_ACCESS_FEATURE])
  })

  it('returns untrusted text on a 200 response', async () => {
    mockedFetch.mockResolvedValue(
      new Response('hello world', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const res = await call('https://example.com')
    expect(res).toMatchObject({
      ok: true, status: 200, truncated: false, _untrusted: true,
      text: 'hello world', contentType: 'text/html',
    })
  })

  it('truncates bodies larger than the cap', async () => {
    mockedFetch.mockResolvedValue(new Response('a'.repeat(250_000), { status: 200 }))
    const res = await call('https://example.com/huge')
    expect(res.ok).toBe(true)
    expect(res.truncated).toBe(true)
    expect(res.text.length).toBe(200_000)
  })

  it('refuses to follow redirects', async () => {
    mockedFetch.mockResolvedValue(new Response('redirecting', { status: 302 }))
    const res = await call('https://example.com/redirect')
    expect(res).toEqual({ ok: false, error: 'redirect_not_followed', status: 302 })
  })

  it('maps SSRF blocks to blocked_unsafe_url', async () => {
    mockedFetch.mockRejectedValue(new UnsafeOutboundUrlError('private_ip_resolved', 'nope'))
    const res = await call('http://169.254.169.254/latest/meta-data')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('blocked_unsafe_url')
    expect(res.message).toContain('[internal]')
  })

  it('maps generic failures to fetch_failed', async () => {
    mockedFetch.mockRejectedValue(new Error('boom'))
    const res = await call('https://example.com/down')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('fetch_failed')
    expect(res.message).toContain('[internal]')
  })
})
