import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGuardrailCheck,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
} from '../data/entities'
import { AgentAuditEvidenceContributor } from '../lib/evidence/agentAuditEvidenceContributor'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  after: new Date('2026-08-21T00:00:00.000Z'),
  before: new Date('2026-08-22T00:00:00.000Z'),
  limitPerSource: 100,
}
const CREATED_AT = new Date('2026-08-21T10:00:00.000Z')

describe('AgentAuditEvidenceContributor', () => {
  const mockedFind = jest.mocked(findWithDecryption)

  beforeEach(() => {
    mockedFind.mockReset()
  })

  it('collects scoped AI trace records correlated by run id', async () => {
    const run = Object.assign(new AgentRun(), {
      id: 'run-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentId: 'agent-1',
      status: 'ok' as const,
      input: { prompt: 'test' },
      createdAt: CREATED_AT,
    })
    const proposal = Object.assign(new AgentProposal(), {
      id: 'proposal-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentId: 'agent-1',
      runId: 'run-1',
      payload: { action: 'review' },
      createdAt: CREATED_AT,
    })
    const span = Object.assign(new AgentSpan(), {
      id: 'span-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentRunId: 'run-1',
      externalSpanId: 'external-span-1',
      sequence: 1,
      name: 'root',
      kind: 'system' as const,
      startedAt: CREATED_AT,
      createdAt: CREATED_AT,
    })
    const toolCall = Object.assign(new AgentToolCall(), {
      id: 'tool-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentRunId: 'run-1',
      spanId: 'span-1',
      toolName: 'lookup',
      createdAt: CREATED_AT,
    })
    const guardrail = Object.assign(new AgentGuardrailCheck(), {
      id: 'guard-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentRunId: 'run-1',
      guardrailSetVersion: 'v1',
      capability: 'proposal',
      phase: 'output' as const,
      kind: 'schema' as const,
      createdAt: CREATED_AT,
    })
    const rows = new Map<unknown, unknown[]>([
      [AgentRun, [run]],
      [AgentProposal, [proposal]],
      [AgentSpan, [span]],
      [AgentToolCall, [toolCall]],
      [AgentGuardrailCheck, [guardrail]],
    ])
    const queries: Array<Record<string, unknown>> = []
    mockedFind.mockImplementation(async (_em, entity, where) => {
      queries.push(where as Record<string, unknown>)
      return (rows.get(entity) ?? []) as never
    })
    const contributor = new AgentAuditEvidenceContributor()

    const records = await contributor.collect({ em: {} as EntityManager, scope: SCOPE })

    expect(records.map((record) => record.source)).toEqual([
      'agent.run',
      'agent.proposal',
      'agent.span',
      'agent.tool-call',
      'agent.guardrail',
    ])
    expect(records.every((record) => record.correlationId === 'run-1')).toBe(true)
    expect(queries).toHaveLength(5)
    for (const query of queries) {
      expect(query).toMatchObject({
        tenantId: SCOPE.tenantId,
        organizationId: SCOPE.organizationId,
        createdAt: { $gte: SCOPE.after, $lte: SCOPE.before },
      })
    }
  })
})
