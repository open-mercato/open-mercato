import { createAgentRunReader } from '../agent-run-reader'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../../data/entities'

type Row = Record<string, unknown>

const mockFindOne = jest.fn()
const mockFind = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findWithDecryption: (...args: unknown[]) => mockFind(...args),
}))

const tenantId = '00000000-0000-4000-8000-0000000000a1'
const organizationId = '00000000-0000-4000-8000-0000000000b1'
const otherOrganizationId = '00000000-0000-4000-8000-0000000000b2'
const runId = '00000000-0000-4000-8000-000000000001'

const runs: Row[] = [
  { id: runId, tenantId, organizationId, deletedAt: null },
  { id: '00000000-0000-4000-8000-000000000002', tenantId, organizationId, deletedAt: new Date() },
]
const steps: Row[] = [
  { runId, tenantId, organizationId, stepIndex: 1 },
  { runId, tenantId, organizationId, stepIndex: 0 },
]
const toolCalls: Row[] = [
  { runId, tenantId, organizationId, stepIndex: 1, callIndex: 0 },
  { runId, tenantId, organizationId, stepIndex: 0, callIndex: 1 },
  { runId, tenantId, organizationId, stepIndex: 0, callIndex: 0 },
]

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)
}

function rowsFor(entity: unknown): Row[] {
  if (entity === AiAgentRun) return runs
  if (entity === AiAgentRunStep) return steps
  if (entity === AiAgentRunToolCall) return toolCalls
  return []
}

const forkedEm = { marker: 'forked' }
const rootEm = { fork: jest.fn(() => forkedEm) }
const reader = createAgentRunReader(() => rootEm as never)

beforeEach(() => {
  mockFindOne.mockReset()
  mockFind.mockReset()
  mockFindOne.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).find((row) => matches(row, where)) ?? null,
  )
  mockFind.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where)),
  )
})

describe('aiAgentRunReader', () => {
  it('loads a run in scope through findOneWithDecryption with tenant/org/soft-delete filters', async () => {
    const run = await reader.getRun({ tenantId, organizationId }, runId)
    expect(run).toEqual(expect.objectContaining({ id: runId }))
    expect(mockFindOne).toHaveBeenCalledWith(
      forkedEm,
      AiAgentRun,
      { id: runId, tenantId, organizationId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
  })

  it('returns null for a different organization or tenant', async () => {
    await expect(reader.getRun({ tenantId, organizationId: otherOrganizationId }, runId)).resolves.toBeNull()
    await expect(
      reader.getRun({ tenantId: '00000000-0000-4000-8000-0000000000a2', organizationId }, runId),
    ).resolves.toBeNull()
  })

  it('excludes soft-deleted runs', async () => {
    await expect(
      reader.getRun({ tenantId, organizationId }, '00000000-0000-4000-8000-000000000002'),
    ).resolves.toBeNull()
  })

  it('lists steps ordered by step index through findWithDecryption', async () => {
    const listed = await reader.listSteps({ tenantId, organizationId }, runId)
    expect(listed.map((step) => step.stepIndex)).toEqual([0, 1])
    expect(mockFind).toHaveBeenCalledWith(
      forkedEm,
      AiAgentRunStep,
      { runId, tenantId, organizationId },
      { orderBy: { stepIndex: 'asc' } },
      { tenantId, organizationId },
    )
  })

  it('lists tool calls ordered by step index then call index', async () => {
    const listed = await reader.listToolCalls({ tenantId, organizationId }, runId)
    expect(listed.map((call) => [call.stepIndex, call.callIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ])
    expect(mockFind).toHaveBeenCalledWith(
      forkedEm,
      AiAgentRunToolCall,
      { runId, tenantId, organizationId },
      { orderBy: { stepIndex: 'asc', callIndex: 'asc' } },
      { tenantId, organizationId },
    )
  })

  it('returns empty lists for a different organization without querying children', async () => {
    const scope = { tenantId, organizationId: otherOrganizationId }
    await expect(reader.listSteps(scope, runId)).resolves.toEqual([])
    await expect(reader.listToolCalls(scope, runId)).resolves.toEqual([])
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('returns empty results for an incomplete scope', async () => {
    await expect(reader.getRun({ tenantId: '', organizationId }, runId)).resolves.toBeNull()
    await expect(reader.listSteps({ tenantId: '', organizationId }, runId)).resolves.toEqual([])
    expect(mockFindOne).not.toHaveBeenCalled()
  })
})
