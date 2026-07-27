import { defaultEncryptionMaps } from '../encryption'

describe('agent_orchestrator defaultEncryptionMaps', () => {
  it('encrypts AgentRun input and output (operator prompt + model response)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'agent_orchestrator:agent_run')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'input' },
      { field: 'output' },
    ]))
  })

  it('encrypts AgentProposal payload (drafted agent action)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'agent_orchestrator:agent_proposal')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'payload' },
    ]))
  })

  it('encrypts AgentEvalCase input and expected (promoted PII)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'agent_orchestrator:agent_eval_case')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'input' },
      { field: 'expected' },
    ]))
  })

  it('encrypts AgentToolCall request and response summaries', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'agent_orchestrator:agent_tool_call')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'request_summary' },
      { field: 'response_summary' },
    ]))
  })

  it('uses snake_case DB column names so the maps match the entity decorators', () => {
    for (const map of defaultEncryptionMaps) {
      for (const { field } of map.fields) {
        expect(field).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})
