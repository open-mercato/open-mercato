/**
 * Step 4.7 — unit coverage for the first production AI agent definition
 * (customers.account_assistant). The agent must be additive, read-only,
 * and reference only features / tools that already exist in the platform.
 *
 * Keeping the test under `packages/core` matches the per-module placement
 * rule: each module owns the unit tests that guard its own contract.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import aiAgents, { promptTemplate } from '../ai-agents'
import features from '../acl'
import customersAiTools from '../ai-tools'

const GENERAL_PURPOSE_TOOLS = new Set([
  'search.hybrid_search',
  'search.get_record_context',
  'attachments.list_record_attachments',
  'attachments.read_attachment',
  'meta.describe_agent',
])

const EXPECTED_SECTION_ORDER = [
  'role',
  'scope',
  'data',
  'tools',
  'attachments',
  'mutationPolicy',
  'responseStyle',
] as const

describe('customers.account_assistant agent definition', () => {
  const agent = aiAgents[0]

  it('registers a single agent exported as default and named aiAgents', () => {
    expect(aiAgents).toHaveLength(1)
    expect(agent.id).toBe('customers.account_assistant')
    expect(agent.moduleId).toBe('customers')
  })

  it('is strictly read-only at the definition level', () => {
    expect(agent.readOnly).toBe(true)
    expect(agent.mutationPolicy).toBe('read-only')
  })

  it('declares the expected execution metadata', () => {
    expect(agent.executionMode).toBe('chat')
    expect(agent.defaultModel).toBeUndefined()
    expect(agent.maxSteps).toBeUndefined()
    expect(agent.output).toBeUndefined()
    expect(agent.acceptedMediaTypes).toEqual(['image', 'pdf', 'file'])
  })

  it('whitelists only read-only tools that exist in the customers pack or general-purpose packs', () => {
    const customersToolNames = new Set(customersAiTools.map((tool) => tool.name))
    for (const toolName of agent.allowedTools) {
      const isCustomerRead = customersToolNames.has(toolName)
      const isGeneral = GENERAL_PURPOSE_TOOLS.has(toolName)
      expect(isCustomerRead || isGeneral).toBe(true)
    }
  })

  it('never whitelists a mutation tool from the customers pack', () => {
    for (const tool of customersAiTools) {
      if (!tool.isMutation) continue
      expect(agent.allowedTools).not.toContain(tool.name)
    }
  })

  it('every requiredFeatures entry exists in customers/acl.ts', () => {
    const knownFeatureIds = new Set(features.map((entry) => entry.id))
    expect(agent.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
    for (const feature of agent.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares the seven spec §8 prompt sections in the canonical order', () => {
    expect(promptTemplate.id).toBe('customers.account_assistant.prompt')
    const sectionNames = promptTemplate.sections
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section) => section.name)
    expect(sectionNames).toEqual(EXPECTED_SECTION_ORDER)

    for (const section of promptTemplate.sections) {
      expect(typeof section.content).toBe('string')
      expect(section.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('compiles the prompt template into the agent systemPrompt', () => {
    for (const section of promptTemplate.sections) {
      const firstLine = section.content.split('\n')[0].trim()
      expect(agent.systemPrompt).toContain(firstLine)
    }
  })

  it('resolvePageContext is an async identity stub that yields no extra context', async () => {
    expect(typeof agent.resolvePageContext).toBe('function')
    const result = await agent.resolvePageContext!({
      entityType: 'customers.person',
      recordId: 'fake-record-id',
      container: {} as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })
})
