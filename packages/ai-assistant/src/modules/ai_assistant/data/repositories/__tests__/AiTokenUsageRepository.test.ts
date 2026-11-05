import { AiTokenUsageRepository } from '../AiTokenUsageRepository'

function makeRepository() {
  const execute = jest.fn(async () => [{ already_seen: false }])
  const em = {
    getConnection: () => ({ execute }),
  }

  return {
    repo: new AiTokenUsageRepository(em as never),
    execute,
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    organizationId: null,
    day: '2026-05-13',
    agentId: 'customers.account_assistant',
    modelId: 'gpt-5-mini',
    providerId: 'openai',
    sessionId: '00000000-0000-0000-0000-000000000002',
    inputTokens: 100,
    outputTokens: 25,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  }
}

describe('AiTokenUsageRepository', () => {
  it('targets the tenant-wide partial unique index in daily rollup upserts', async () => {
    const { repo, execute } = makeRepository()

    await repo.upsertDaily(baseInput())

    const upsertSql = String(execute.mock.calls[1]?.[0] ?? '')
    expect(upsertSql).toContain('on conflict (tenant_id, day, agent_id, model_id)')
    expect(upsertSql).toContain('where organization_id is null')
    expect(upsertSql).not.toContain('on constraint')
  })

  it('targets the organization-scoped partial unique index in daily rollup upserts', async () => {
    const { repo, execute } = makeRepository()

    await repo.upsertDaily(baseInput({
      organizationId: '00000000-0000-0000-0000-000000000003',
    }))

    const upsertSql = String(execute.mock.calls[1]?.[0] ?? '')
    expect(upsertSql).toContain(
      'on conflict (tenant_id, day, agent_id, model_id, organization_id)',
    )
    expect(upsertSql).toContain('where organization_id is not null')
    expect(upsertSql).not.toContain('on constraint')
  })
})
