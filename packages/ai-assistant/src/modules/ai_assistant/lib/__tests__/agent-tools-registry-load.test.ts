/**
 * An agent's `allowedTools` must mean the same thing on every path.
 *
 * It did not. The tool registry is a process singleton populated only by
 * `loadAllModuleTools()`, and that was called exclusively by the entry points
 * whose job IS serving tools — the MCP servers, `/api/ai_assistant/tools`,
 * `/tools/execute`, the action-confirm route, the CLI. Every other agent path
 * (the chat dispatcher, `runAiAgentText`, `runAiAgentObject`) assumed a
 * populated registry without populating it, so whether an agent could see its
 * own tools depended on what that Node process had happened to serve first.
 *
 * The visible symptom: the workflow drafter is declared with
 * `workflows.validate_workflow_definition` and a prompt telling it to
 * self-check, but the policy gate rejected the tool as `tool_unknown`, the
 * runtime silently degraded to a toolless single-shot call, and the schema
 * errors reached the human instead of the model that could act on them.
 */
import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import { resolveAiAgentTools } from '../agent-tools'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { registerMcpTool, toolRegistry } from '../tool-registry'

const ensureModuleToolsLoaded = jest.fn(async () => {
  registerMcpTool(
    {
      name: 'workflows.validate_workflow_definition',
      description: 'validate',
      inputSchema: z.object({ definition: z.unknown() }),
      handler: async () => ({ ok: true }),
    },
    { moduleId: 'workflows' },
  )
})

// Fully replaced, not spread over the real module: `ensureModuleToolsLoaded` is
// the seam `resolveAiAgentTools` reaches through, and the real one would run
// four dynamic imports and an OpenAPI load. Its own memo is covered in
// `tool-loader-ensure-loaded.test.ts`.
jest.mock('../tool-loader', () => ({
  ensureModuleToolsLoaded: (...args: unknown[]) => ensureModuleToolsLoaded(...args),
}))

const agent: AiAgentDefinition = {
  id: 'workflows.definition_drafter',
  moduleId: 'workflows',
  label: 'Drafter',
  description: 'Drafts a workflow',
  systemPrompt: 'Draft a workflow.',
  allowedTools: ['workflows.validate_workflow_definition'],
}

const auth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

describe('resolveAiAgentTools loads the tool registry', () => {
  beforeEach(() => {
    ensureModuleToolsLoaded.mockClear()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    seedAgentRegistryForTests([agent])
  })

  afterEach(() => {
    toolRegistry.clear()
  })

  it('resolves an allowlisted tool without any other entry point having run first', async () => {
    const resolved = await resolveAiAgentTools({ agentId: agent.id, authContext: auth })

    expect(ensureModuleToolsLoaded).toHaveBeenCalledTimes(1)
    // Before the fix this was `{}` — and the caller silently became toolless.
    expect(Object.keys(resolved.tools)).toHaveLength(1)
  })

  it('survives a registry that cannot load, rather than failing the turn', async () => {
    ensureModuleToolsLoaded.mockRejectedValueOnce(new Error('generated registry missing'))

    const resolved = await resolveAiAgentTools({ agentId: agent.id, authContext: auth })

    // Toolless is a degradation the caller already handles; a thrown error here
    // would turn a recoverable turn into a 500.
    expect(Object.keys(resolved.tools)).toHaveLength(0)
  })
})
