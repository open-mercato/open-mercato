import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  FILE_AGENT_RUNTIME_ENV,
  buildFileAgentAiDefinition,
  extractOutcomeProse,
  resetFileAgentRuntimeWarningForTests,
  resolveFileAgentRuntime,
  rewriteOpenCodeToolNames,
} from '../lib/sdk/fileAgentNative'

function fileEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id: 'deals.health_check_file',
    moduleId: 'agent_examples',
    resultKind: 'proposal',
    schema: z.object({ proposal: z.object({ stage: z.string() }) }),
    tools: ['agent_orchestrator.web_search'],
    skills: ['stage_playbook'],
    subAgents: [],
    label: 'Deal health check',
    description: 'Assess a deal.',
    instructions: 'Assess the deal. Search with `open-mercato_agent_orchestrator_web_search` first.',
    runtime: 'opencode',
    definitionSource: 'file',
    outcomeSchema: { type: 'object', properties: { stage: { type: 'string' } } },
    sourceFiles: [
      {
        path: 'OUTCOME.md',
        content: '---\nkind: proposal\n---\n```json\n{"type":"object"}\n```\nPrefer the conservative stage.',
        tokens: 10,
        inContext: true,
      },
    ],
    ...overrides,
  }
}

describe('resolveFileAgentRuntime', () => {
  const original = process.env[FILE_AGENT_RUNTIME_ENV]

  afterEach(() => {
    if (original === undefined) delete process.env[FILE_AGENT_RUNTIME_ENV]
    else process.env[FILE_AGENT_RUNTIME_ENV] = original
    resetFileAgentRuntimeWarningForTests()
  })

  it('runs file agents natively by default', () => {
    delete process.env[FILE_AGENT_RUNTIME_ENV]
    expect(resolveFileAgentRuntime(fileEntry())).toBe('native')
  })

  it('keeps file-plane and artifact agents on OpenCode, which owns the sandbox', () => {
    delete process.env[FILE_AGENT_RUNTIME_ENV]
    expect(resolveFileAgentRuntime(fileEntry({ files: { enabled: true } }))).toBe('opencode')
    expect(resolveFileAgentRuntime(fileEntry({ resultKind: 'artifact' }))).toBe('opencode')
  })

  it('routes every file agent back to OpenCode through the deprecation bridge', () => {
    process.env[FILE_AGENT_RUNTIME_ENV] = 'opencode'
    expect(resolveFileAgentRuntime(fileEntry())).toBe('opencode')
  })
})

describe('buildFileAgentAiDefinition', () => {
  it('is read-only, so the AI runtime strips every mutation tool (the propose-only gate on native)', () => {
    const definition = buildFileAgentAiDefinition(fileEntry(), [])
    expect(definition.readOnly).toBe(true)
    expect(definition.mutationPolicy).toBe('read-only')
    expect(definition.executionMode).toBe('object')
    expect(definition.output?.schemaName).toBe('deals_health_check_file')
  })

  it('allows only the agent tools plus the skill and delegation tools it needs, never submit_outcome', () => {
    const plain = buildFileAgentAiDefinition(fileEntry({ skills: [] }), [])
    expect(plain.allowedTools).toEqual(['agent_orchestrator.web_search'])

    const full = buildFileAgentAiDefinition(fileEntry({ subAgents: ['deals.activity_scan'] }), [
      { id: 'stage_playbook', instructions: 'x', scripts: [{ name: 'score' }] },
    ])
    expect(full.allowedTools).toEqual([
      'agent_orchestrator.web_search',
      'agent_orchestrator.load_skill',
      'agent_orchestrator.run_skill_script',
      'agent_orchestrator.delegate_agent',
    ])
    expect(full.allowedTools).not.toContain('agent_orchestrator.submit_outcome')
  })

  it('renders skills, local tools, sub-agents and the outcome contract into the prompt', () => {
    const definition = buildFileAgentAiDefinition(fileEntry({ subAgents: ['deals.activity_scan'] }), [
      { id: 'stage_playbook', instructions: 'x', scripts: [{ name: 'score' }] },
      { id: '__agent_tools__', instructions: '', scripts: [{ name: 'lookup_ticket_history' }] },
    ])
    expect(definition.systemPrompt).toContain('Available skills: stage_playbook.')
    expect(definition.systemPrompt).toContain('Scripts: stage_playbook/score.')
    expect(definition.systemPrompt).toContain('Local tools: lookup_ticket_history.')
    expect(definition.systemPrompt).toContain('Available sub-agents: deals.activity_scan.')
    expect(definition.systemPrompt).toContain('Prefer the conservative stage.')
    expect(definition.systemPrompt).not.toContain('submit_outcome')
  })

  it('maps OpenCode tool names in the instructions to the native names', () => {
    const definition = buildFileAgentAiDefinition(fileEntry(), [])
    expect(definition.systemPrompt).toContain('`agent_orchestrator__web_search`')
    expect(definition.systemPrompt).not.toContain('open-mercato_agent_orchestrator_web_search')
  })

  it('forwards invoker features and the module the model env overrides key on', () => {
    const definition = buildFileAgentAiDefinition(
      fileEntry({ moduleId: '', requiredFeatures: ['deals.health.run'] }),
      [],
      'agent_examples',
    )
    expect(definition.moduleId).toBe('agent_examples')
    expect(definition.requiredFeatures).toEqual(['deals.health.run'])
  })
})

describe('rewriteOpenCodeToolNames', () => {
  it('never maps a tool that is not on the allowlist', () => {
    const text = 'Use `open-mercato_customers_update_deal` to save.'
    expect(rewriteOpenCodeToolNames(text, ['agent_orchestrator.web_search'])).toBe(text)
  })
})

describe('extractOutcomeProse', () => {
  it('returns the guidance after the schema fence, or the whole body without one', () => {
    expect(extractOutcomeProse(fileEntry().sourceFiles)).toBe('Prefer the conservative stage.')
    expect(
      extractOutcomeProse([{ path: 'OUTCOME.md', content: '---\nkind: artifact\n---\nWrite a PDF.', tokens: 1, inContext: true }]),
    ).toBe('Write a PDF.')
    expect(extractOutcomeProse(undefined)).toBe('')
  })
})
