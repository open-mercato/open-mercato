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
  const agent = aiAgents.find((entry) => entry.id === 'customers.account_assistant')!

  it('is exported as part of aiAgents alongside the deal_analyzer demo agents', () => {
    // Module ships three agents: the production account assistant plus two
    // demo agents (`customers.deal_analyzer`, `customers.deal_analyzer_tool_loop`)
    // that exercise the loop primitives. New agents added to the module MUST
    // update this assertion explicitly so the inventory stays locked.
    const ids = aiAgents.map((entry) => entry.id).sort()
    expect(ids).toEqual([
      'customers.account_assistant',
      'customers.deal_analyzer',
      'customers.deal_analyzer_tool_loop',
    ])
    expect(agent).toBeDefined()
    expect(agent.moduleId).toBe('customers')
  })

  it('declares write capability behind the confirm-required gate', () => {
    // The customers account assistant whitelists `customers.update_deal_stage`,
    // so the code-declared policy is `confirm-required` — every mutation must
    // be confirmed by the operator via the pending-action approval card. A
    // per-tenant override can downgrade the agent back to `read-only`.
    expect(agent.readOnly).toBe(false)
    expect(agent.mutationPolicy).toBe('confirm-required')
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

  it('whitelists only the explicitly approved mutation tool(s) from the customers pack', () => {
    // The agent exposes the explicitly-approved mutation tools at the
    // code-declaration layer. Any other mutation tool that lands in the
    // customers pack MUST stay behind an explicit whitelist review.
    const APPROVED_MUTATION_TOOLS = new Set<string>([
      'customers.update_deal_stage',
      'customers.manage_deal_comment',
      'customers.manage_deal_activity',
      'customers.manage_record_comment',
      'customers.manage_record_activity',
    ])
    for (const tool of customersAiTools) {
      if (!tool.isMutation) continue
      if (APPROVED_MUTATION_TOOLS.has(tool.name)) {
        expect(agent.allowedTools).toContain(tool.name)
      } else {
        expect(agent.allowedTools).not.toContain(tool.name)
      }
    }
  })

  it('exposes customers.update_deal_stage with the existing customers.deals.manage feature', () => {
    const tool = customersAiTools.find((entry) => entry.name === 'customers.update_deal_stage')
    expect(tool).toBeDefined()
    expect(tool!.isMutation).toBe(true)
    expect(agent.allowedTools).toContain('customers.update_deal_stage')
    const knownFeatureIds = new Set(features.map((entry) => entry.id))
    for (const feature of tool!.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool!.requiredFeatures).toContain('customers.deals.manage')
  })

  it('MUTATION POLICY section documents customers.update_deal_stage', () => {
    const section = promptTemplate.sections.find((entry) => entry.name === 'mutationPolicy')
    expect(section).toBeDefined()
    expect(section!.content).toMatch(/customers\.update_deal_stage/)
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

  it('resolvePageContext yields no extra context for non-UUID recordIds', async () => {
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

// Step 5.2 — resolvePageContext hydration path.
const VALID_UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VALID_UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function makeAgent() {
  return aiAgents.find((entry) => entry.id === 'customers.account_assistant') as any
}

function buildContainer(ctxOverrides: Record<string, unknown> = {}) {
  return {
    resolve: (name: string) => {
      if (name === 'em') return { count: jest.fn() }
      return (ctxOverrides as Record<string, unknown>)[name] ?? null
    },
  }
}

describe('customers.account_assistant resolvePageContext hydration (Step 5.2)', () => {
  const agent = aiAgents.find((entry) => entry.id === 'customers.account_assistant')!
  const originalWarn = console.warn
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })
  afterEach(() => {
    console.warn = originalWarn
  })

  async function mockTool(toolName: string, handler: jest.Mock) {
    jest.doMock('../ai-tools', () => ({
      __esModule: true,
      default: [
        {
          name: toolName,
          description: 'mock',
          inputSchema: { parse: (value: unknown) => value },
          handler,
        },
      ],
      aiTools: [
        {
          name: toolName,
          description: 'mock',
          inputSchema: { parse: (value: unknown) => value },
          handler,
        },
      ],
    }))
    const { hydrateCustomersAccountContext } = await import('../ai-agents-context')
    return hydrateCustomersAccountContext
  }

  it('returns null when tenantId is missing (cross-tenant guard)', async () => {
    const handler = jest.fn()
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.person',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: null,
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns null when recordId is not a UUID', async () => {
    const handler = jest.fn()
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.person',
      recordId: 'not-a-uuid',
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: null,
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('hydrates person bundles for entityType=customers.person', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      person: { id: VALID_UUID_A, displayName: 'Taylor' },
    }))
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.person',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ personId: VALID_UUID_A, includeRelated: true })
    expect(handler.mock.calls[0][1]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(result).not.toBeNull()
    expect(result).toContain('## Page context — Person')
    expect(result).toContain('Taylor')
  })

  it('hydrates company bundles for entityType=customers.company', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      company: { id: VALID_UUID_A, displayName: 'Acme Corp' },
    }))
    const hydrate = await mockTool('customers.get_company', handler)
    const result = await hydrate({
      entityType: 'customers.company',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { companyId: VALID_UUID_A, includeRelated: true },
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(result).toContain('Company')
    expect(result).toContain('Acme Corp')
  })

  it('hydrates deal bundles for entityType=customers.deal', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      deal: { id: VALID_UUID_A, title: 'Q3 renewal' },
    }))
    const hydrate = await mockTool('customers.get_deal', handler)
    const result = await hydrate({
      entityType: 'customers.deal',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { dealId: VALID_UUID_A, includeRelated: true },
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(result).toContain('Deal')
    expect(result).toContain('Q3 renewal')
  })

  it('returns null when tool reports found=false (cross-tenant / missing)', async () => {
    const handler = jest.fn(async () => ({ found: false, personId: VALID_UUID_B }))
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.person',
      recordId: VALID_UUID_B,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null without throwing when the tool handler throws', async () => {
    const warn = jest.fn()
    console.warn = warn
    const handler = jest.fn(async () => {
      throw new Error('downstream blew up')
    })
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.person',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null for unknown entityType (no-op fall-through)', async () => {
    const handler = jest.fn()
    const hydrate = await mockTool('customers.get_person', handler)
    const result = await hydrate({
      entityType: 'customers.task',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('production agent callback delegates to the hydrator', async () => {
    expect(typeof agent.resolvePageContext).toBe('function')
    // Hitting the production callback with a valid UUID but no DI tools
    // registered should not throw — the tool-lookup miss returns null
    // via the warn + swallow path.
    const warn = jest.fn()
    console.warn = warn
    const result = await agent.resolvePageContext!({
      entityType: 'customers.notset',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })
})

describe('customers.deal_analyzer demo agents', () => {
  const dealAnalyzer = aiAgents.find((entry) => entry.id === 'customers.deal_analyzer')!
  const dealAnalyzerToolLoop = aiAgents.find(
    (entry) => entry.id === 'customers.deal_analyzer_tool_loop',
  )!

  it('both demo agents are registered with the customers moduleId', () => {
    expect(dealAnalyzer).toBeDefined()
    expect(dealAnalyzerToolLoop).toBeDefined()
    expect(dealAnalyzer.moduleId).toBe('customers')
    expect(dealAnalyzerToolLoop.moduleId).toBe('customers')
  })

  it('declares confirm-required mutation policy with write capability', () => {
    expect(dealAnalyzer.readOnly).toBe(false)
    expect(dealAnalyzer.mutationPolicy).toBe('confirm-required')
    expect(dealAnalyzerToolLoop.readOnly).toBe(false)
    expect(dealAnalyzerToolLoop.mutationPolicy).toBe('confirm-required')
  })

  it('exposes only stream-text vs tool-loop-agent on the two siblings', () => {
    expect(dealAnalyzer.executionEngine).toBe('stream-text')
    expect(dealAnalyzerToolLoop.executionEngine).toBe('tool-loop-agent')
  })

  it('inherits the runtime default provider and model from environment settings', () => {
    expect(dealAnalyzer.defaultModel).toBeUndefined()
    expect(dealAnalyzer.defaultProvider).toBeUndefined()
    expect(dealAnalyzer.allowRuntimeOverride).toBe(true)
  })

  it('declares loop budget and stopWhen on the mutation tool call', () => {
    const loop = dealAnalyzer.loop
    expect(loop).toBeDefined()
    expect(loop?.maxSteps).toBe(12)
    expect(loop?.budget?.maxToolCalls).toBe(12)
    expect(loop?.budget?.maxWallClockMs).toBe(60_000)
    expect(loop?.allowRuntimeOverride).toBe(true)
    const stopWhen = loop?.stopWhen ?? []
    expect(stopWhen.length).toBeGreaterThan(0)
    const hasStageStop = stopWhen.some(
      (entry) =>
        entry.kind === 'hasToolCall' && entry.toolName === 'customers.update_deal_stage',
    )
    expect(hasStageStop).toBe(true)
  })

  it('whitelists the analyze + update-stage tools and not others', () => {
    expect(dealAnalyzer.allowedTools).toContain('customers.analyze_deals')
    expect(dealAnalyzer.allowedTools).toContain('customers.update_deal_stage')
    expect(dealAnalyzer.allowedTools).not.toContain('customers.manage_record_activity')
  })

  it('requiredFeatures stays inside the customers acl namespace', () => {
    const knownFeatureIds = new Set(features.map((entry) => entry.id))
    for (const featureId of dealAnalyzer.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(featureId)).toBe(true)
    }
  })

  it('prepareStep callback scopes tools by step without overriding the model', async () => {
    expect(typeof dealAnalyzer.loop?.prepareStep).toBe('function')
    const stepZero = await dealAnalyzer.loop!.prepareStep!({
      stepNumber: 0,
    } as any)
    const stepOne = await dealAnalyzer.loop!.prepareStep!({
      stepNumber: 1,
    } as any)

    expect((stepZero as any).model).toBeUndefined()
    expect((stepOne as any).model).toBeUndefined()
    expect((stepZero as any).activeTools).toContain('customers.analyze_deals')
    expect((stepZero as any).activeTools).not.toContain('customers.update_deal_stage')
    expect((stepOne as any).activeTools).toContain('customers.update_deal_stage')
  })
})
