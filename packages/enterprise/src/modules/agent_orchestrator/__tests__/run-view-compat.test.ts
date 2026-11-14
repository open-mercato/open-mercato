import { formatTokens, mapRun, type RunView } from '../components/types'

const legacyRunView: RunView = {
  id: 'run-1',
  agentId: 'agent-1',
  status: 'completed',
  resultKind: 'proposal',
  errorMessage: null,
  input: null,
  output: null,
  outputArtifactKey: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:05.000Z',
  runtime: 'native',
  externalRunId: null,
  model: 'gpt-4o-mini',
  confidence: null,
  evalScore: null,
  evalPassed: null,
  goldenCaseId: null,
  goldenPassed: null,
  latencyMs: 5000,
  costMinor: 12,
  inputTokens: 1200,
  outputTokens: 300,
  currency: 'USD',
  agentVersion: '1',
  humanConfirmedAt: null,
  completedAt: '2026-10-01T10:00:05.000Z',
  flaggedAt: null,
  contextRouting: null,
  workflowInstanceId: null,
}

describe('RunView cachedInputTokens compatibility (#6240)', () => {
  it('accepts a RunView built in the pre-#6240 shape without cachedInputTokens', () => {
    expect('cachedInputTokens' in legacyRunView).toBe(false)
    expect(formatTokens(legacyRunView.cachedInputTokens ?? null)).toBeNull()
  })

  it('maps a run payload that predates the cached_input_tokens column to null', () => {
    const view = mapRun({ id: 'run-1', agent_id: 'agent-1', input_tokens: 1200, output_tokens: 300 })
    expect(view?.cachedInputTokens).toBeNull()
    expect(view?.inputTokens).toBe(1200)
  })

  it('maps cached input from snake_case and camelCase payloads', () => {
    expect(mapRun({ id: 'run-1', agent_id: 'agent-1', cached_input_tokens: 800 })?.cachedInputTokens).toBe(800)
    expect(mapRun({ id: 'run-1', agentId: 'agent-1', cachedInputTokens: 640 })?.cachedInputTokens).toBe(640)
  })
})
