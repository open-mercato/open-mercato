import {
  aiAgentConversationRunsParamsSchema,
  aiAgentRunDetailParamsSchema,
  aiAgentRunListQuerySchema,
} from '../validators'

const uuid = '3f1c1d7e-6f5b-4a4e-9a4e-1b2c3d4e5f60'

describe('aiAgentRunListQuerySchema', () => {
  it('applies paging defaults', () => {
    const parsed = aiAgentRunListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(25)
  })

  it('coerces numeric query strings and accepts filters', () => {
    const parsed = aiAgentRunListQuerySchema.parse({
      agentId: 'catalog.assistant',
      channel: 'chat',
      status: 'failed',
      userId: uuid,
      conversationId: uuid,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      page: '2',
      pageSize: '100',
    })
    expect(parsed.page).toBe(2)
    expect(parsed.pageSize).toBe(100)
    expect(parsed.channel).toBe('chat')
  })

  it('rejects pageSize above 100 and page below 1', () => {
    expect(aiAgentRunListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(aiAgentRunListQuerySchema.safeParse({ page: '0' }).success).toBe(false)
  })

  it('rejects unknown channel, status and malformed ids or dates', () => {
    expect(aiAgentRunListQuerySchema.safeParse({ channel: 'sms' }).success).toBe(false)
    expect(aiAgentRunListQuerySchema.safeParse({ status: 'running' }).success).toBe(false)
    expect(aiAgentRunListQuerySchema.safeParse({ userId: 'nope' }).success).toBe(false)
    expect(aiAgentRunListQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false)
  })

  it('rejects an inverted date range', () => {
    const result = aiAgentRunListQuerySchema.safeParse({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('run path parameter schemas', () => {
  it('requires a uuid run id and a bounded conversation id', () => {
    expect(aiAgentRunDetailParamsSchema.safeParse({ id: uuid }).success).toBe(true)
    expect(aiAgentRunDetailParamsSchema.safeParse({ id: 'x' }).success).toBe(false)
    expect(aiAgentConversationRunsParamsSchema.safeParse({ conversationId: uuid }).success).toBe(true)
    expect(aiAgentConversationRunsParamsSchema.safeParse({ conversationId: 'chat_legacy_1' }).success).toBe(true)
    expect(aiAgentConversationRunsParamsSchema.safeParse({ conversationId: '' }).success).toBe(false)
    expect(aiAgentConversationRunsParamsSchema.safeParse({ conversationId: 'x'.repeat(129) }).success).toBe(false)
  })
})
