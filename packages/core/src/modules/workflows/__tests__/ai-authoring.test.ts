/**
 * Unit tests for the pure prompt-to-draft half (`lib/ai-authoring.ts`).
 *
 * The load-bearing behaviour this locks down is the fail-closed `INVOKE_AGENT`
 * rule: the catalog carries the usable-agents list, and the prompt FORBIDS the
 * `INVOKE_AGENT` activity type whenever that list is empty — which is exactly
 * when an agent step could only fail the strict `invokeAgentConfigSchema` later.
 */
import {
  buildWorkflowDraftCatalog,
  buildWorkflowDraftPrompt,
  type WorkflowDraftCatalog,
} from '../lib/ai-authoring'

const baseInput = {
  stepTypes: ['START', 'END'] as const,
  transitionTriggers: ['manual'] as const,
  activityTypes: [{ id: 'INVOKE_AGENT' }, { id: 'CALL_API' }],
  commands: [],
  functions: [],
  events: [],
}

function promptFor(catalog: WorkflowDraftCatalog): string {
  return buildWorkflowDraftPrompt({ prompt: 'ship it', catalog })
}

describe('buildWorkflowDraftCatalog — agents', () => {
  it('defaults agents to an empty list when omitted', () => {
    const catalog = buildWorkflowDraftCatalog(baseInput)
    expect(catalog.agents).toEqual([])
  })

  it('maps provided agents to catalog entries with optional labels', () => {
    const catalog = buildWorkflowDraftCatalog({
      ...baseInput,
      agents: [{ id: 'agent.triage', label: 'Triage' }, { id: 'agent.plain' }],
    })
    expect(catalog.agents).toEqual([
      { id: 'agent.triage', description: 'Triage' },
      { id: 'agent.plain' },
    ])
  })
})

describe('buildWorkflowDraftPrompt — fail-closed INVOKE_AGENT', () => {
  it('forbids INVOKE_AGENT when no agents are available', () => {
    const prompt = promptFor(buildWorkflowDraftCatalog(baseInput))
    expect(prompt).toContain('Do NOT use the INVOKE_AGENT activity type')
    expect(prompt).not.toContain('config.agentId to one of the catalog')
  })

  it('permits and constrains INVOKE_AGENT when agents exist', () => {
    const prompt = promptFor(
      buildWorkflowDraftCatalog({ ...baseInput, agents: [{ id: 'agent.triage' }] }),
    )
    expect(prompt).toContain('config.agentId to one of the catalog `agents` ids')
    expect(prompt).toContain('config.onResult')
    expect(prompt).not.toContain('Do NOT use the INVOKE_AGENT activity type')
  })

  it('always instructs the agent to self-validate via the tool', () => {
    const prompt = promptFor(buildWorkflowDraftCatalog(baseInput))
    expect(prompt).toContain('workflows.validate_workflow_definition')
  })
})
