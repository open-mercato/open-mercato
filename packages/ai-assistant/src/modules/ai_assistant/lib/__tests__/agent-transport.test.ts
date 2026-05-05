import { createAiAgentTransport } from '../agent-transport'

describe('createAiAgentTransport', () => {
  it('points at the default ai_assistant dispatcher with the agent query param', () => {
    const transport = createAiAgentTransport({ agentId: 'customers.assistant' })
    // ChatTransport keeps the api URL as a protected field — access it for test assertions.
    const apiUrl = (transport as unknown as { api: string }).api
    expect(apiUrl).toBe('/api/ai_assistant/ai/chat?agent=customers.assistant')
  })

  it('honors a custom endpoint override', () => {
    const transport = createAiAgentTransport({
      agentId: 'catalog.merchandising_assistant',
      endpoint: '/custom/chat',
    })
    const apiUrl = (transport as unknown as { api: string }).api
    expect(apiUrl).toBe('/custom/chat?agent=catalog.merchandising_assistant')
  })

  it('merges extra body fields and surfaces the debug flag when provided', () => {
    const transport = createAiAgentTransport({
      agentId: 'customers.assistant',
      body: { pageContext: { pageId: 'customers.people' } },
      debug: true,
    })
    const body = (transport as unknown as { body: Record<string, unknown> }).body
    expect(body).toEqual({
      pageContext: { pageId: 'customers.people' },
      debug: true,
    })
  })

  it('preserves the agent query when the endpoint already contains a query string', () => {
    const transport = createAiAgentTransport({
      agentId: 'customers.assistant',
      endpoint: '/api/ai/chat?trace=1',
    })
    const apiUrl = (transport as unknown as { api: string }).api
    expect(apiUrl).toBe('/api/ai/chat?trace=1&agent=customers.assistant')
  })
})
