/**
 * Propose-only on the native runtime, end to end through the real ai-assistant
 * registry and tool resolution.
 *
 * On OpenCode a file agent was held read-only by its generated agent file's
 * allowlist and the MCP session ACL. On native the only load-bearing gate is the
 * read-only ai-assistant definition: the runtime must strip every
 * `isMutation: true` tool before the model sees it, even when the agent's
 * allowlist names one (a load-time check that skipped, or a tool that changed to
 * mutating after registration).
 */
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => null })),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { buildFileAgentAiDefinition } from '../lib/sdk/fileAgentNative'
import { resolveAiAgentTools } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-tools'
import {
  registerRuntimeAiAgents,
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'
import { registerMcpTool, toolRegistry } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'

const superAdmin = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

function tool(name: string, isMutation: boolean) {
  return {
    name,
    description: `${name} description`,
    inputSchema: z.object({ id: z.string().optional() }),
    isMutation,
    handler: async () => ({ ok: true }),
  }
}

function fileEntry(tools: string[]): AgentRegistryEntry {
  return {
    id: 'deals.native_file_agent',
    moduleId: 'agent_examples',
    resultKind: 'proposal',
    schema: z.object({ proposal: z.object({ stage: z.string() }) }),
    tools,
    skills: [],
    subAgents: [],
    label: 'Native file agent',
    description: 'A file agent on the native runtime.',
    instructions: 'Read the deal, then propose.',
    runtime: 'native',
    definitionSource: 'file',
  }
}

describe('native file agents stay propose-only', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    seedAgentRegistryForTests([])
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('strips a mutation tool the allowlist names and keeps the read tools', async () => {
    registerMcpTool(tool('customers.get_deal', false), { moduleId: 'customers' })
    registerMcpTool(tool('customers.update_deal', true), { moduleId: 'customers' })

    const definition = buildFileAgentAiDefinition(fileEntry(['customers.get_deal', 'customers.update_deal']), [])
    expect(await registerRuntimeAiAgents([definition])).toEqual(['deals.native_file_agent'])

    const { tools } = await resolveAiAgentTools({
      agentId: 'deals.native_file_agent',
      authContext: superAdmin,
      requestedExecutionMode: 'object',
    })

    expect(Object.keys(tools)).toContain('customers__get_deal')
    expect(Object.keys(tools)).not.toContain('customers__update_deal')
  })
})
