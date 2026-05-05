import { z } from 'zod'
import {
  defineAiAgent,
  defineAiAgentExtension,
  type AiAgentDefinition,
} from '../ai-agent-definition'
import { defineAiTool } from '../ai-tool-definition'
import type { AiToolDefinition, McpToolDefinition } from '../types'

describe('defineAiTool', () => {
  it('returns the tool definition unchanged (identity builder)', () => {
    const tool = defineAiTool({
      name: 'catalog.search_products',
      description: 'Search the product catalog',
      inputSchema: z.object({ query: z.string() }),
      handler: async (input) => ({ matches: [input.query] }),
    })
    expect(tool.name).toBe('catalog.search_products')
    expect(tool.description).toBe('Search the product catalog')
    expect(typeof tool.handler).toBe('function')
  })

  it('preserves additive focused-agent metadata on AiToolDefinition', () => {
    const tool = defineAiTool({
      name: 'catalog.update_product',
      description: 'Update a product',
      inputSchema: z.object({ id: z.string() }),
      requiredFeatures: ['catalog.products.update'],
      handler: async (input) => ({ ok: true, id: input.id }),
      displayName: 'Update product',
      tags: ['write', 'catalog'],
      isMutation: true,
      maxCallsPerTurn: 1,
      supportsAttachments: true,
    })
    expect(tool.displayName).toBe('Update product')
    expect(tool.tags).toEqual(['write', 'catalog'])
    expect(tool.isMutation).toBe(true)
    expect(tool.maxCallsPerTurn).toBe(1)
    expect(tool.supportsAttachments).toBe(true)
  })

  it('returns an object assignable to AiToolDefinition and McpToolDefinition (BC)', () => {
    const built = defineAiTool({
      name: 'meta.ping',
      description: 'Ping',
      inputSchema: z.object({}),
      handler: async () => ({ pong: true }),
    })
    const asAi: AiToolDefinition = built
    const asMcp: McpToolDefinition = built
    expect(asAi.name).toBe('meta.ping')
    expect(asMcp.name).toBe('meta.ping')
  })

  it('plain-object AiToolDefinition authored without defineAiTool() still type-checks', () => {
    const plain: AiToolDefinition<{ id: string }, { ok: boolean }> = {
      name: 'customers.get',
      description: 'Fetch a customer',
      inputSchema: z.object({ id: z.string() }),
      handler: async () => ({ ok: true }),
    }
    expect(plain.name).toBe('customers.get')
  })
})

describe('defineAiAgentExtension', () => {
  it('returns the extension definition unchanged (identity builder)', () => {
    const extension = defineAiAgentExtension({
      targetAgentId: 'catalog.catalog_assistant',
      replaceAllowedTools: ['catalog.list_products'],
      deleteAllowedTools: ['catalog.old_tool'],
      appendAllowedTools: ['example.catalog_stats'],
      replaceSystemPrompt: 'Replacement prompt.',
      appendSystemPrompt: 'Use example.catalog_stats for app-level catalog metrics.',
      replaceSuggestions: [
        { label: 'Start fresh', prompt: 'Start fresh' },
      ],
      deleteSuggestions: ['Old prompt'],
      appendSuggestions: [
        { label: 'Show catalog stats', prompt: 'Show catalog stats' },
      ],
    })

    expect(extension.targetAgentId).toBe('catalog.catalog_assistant')
    expect(extension.replaceAllowedTools).toEqual(['catalog.list_products'])
    expect(extension.deleteAllowedTools).toEqual(['catalog.old_tool'])
    expect(extension.appendAllowedTools).toEqual(['example.catalog_stats'])
    expect(extension.replaceSystemPrompt).toBe('Replacement prompt.')
    expect(extension.deleteSuggestions).toEqual(['Old prompt'])
    expect(extension.appendSuggestions).toEqual([
      { label: 'Show catalog stats', prompt: 'Show catalog stats' },
    ])
  })
})

describe('defineAiAgent', () => {
  it('returns the agent definition unchanged (identity builder)', () => {
    const agent = defineAiAgent({
      id: 'catalog.merchandising_assistant',
      moduleId: 'catalog',
      label: 'Merchandising assistant',
      description: 'Draft product descriptions and extract attributes',
      systemPrompt: 'You are a merchandising assistant.',
      allowedTools: ['catalog.search_products', 'catalog.get_product'],
    })
    expect(agent.id).toBe('catalog.merchandising_assistant')
    expect(agent.moduleId).toBe('catalog')
    expect(agent.allowedTools).toHaveLength(2)
  })

  it('accepts every optional spec field', () => {
    const resolvePageContext = jest.fn<
      Promise<string | null>,
      [
        Parameters<NonNullable<AiAgentDefinition['resolvePageContext']>>[0],
      ]
    >(async () => 'context string')

    const agent = defineAiAgent({
      id: 'catalog.demo',
      moduleId: 'catalog',
      label: 'Demo',
      description: 'Demo agent with all optional fields set',
      systemPrompt: 'prompt',
      allowedTools: ['catalog.search_products'],
      executionMode: 'chat',
      defaultModel: 'gpt-4o',
      acceptedMediaTypes: ['image', 'pdf', 'file'],
      requiredFeatures: ['catalog.products.view'],
      uiParts: ['mutation-preview-card'],
      readOnly: true,
      mutationPolicy: 'read-only',
      maxSteps: 12,
      output: {
        schemaName: 'ProductBrief',
        schema: z.object({ name: z.string() }),
        mode: 'generate',
      },
      resolvePageContext,
      keywords: ['catalog', 'merchandising'],
      suggestions: [
        { label: 'Show catalog stats', prompt: 'Show catalog stats' },
      ],
      domain: 'catalog',
      dataCapabilities: {
        entities: ['catalog.product'],
        operations: ['read', 'search'],
        searchableFields: ['name', 'sku'],
      },
    })

    expect(agent.executionMode).toBe('chat')
    expect(agent.mutationPolicy).toBe('read-only')
    expect(agent.maxSteps).toBe(12)
    expect(agent.output?.schemaName).toBe('ProductBrief')
    expect(agent.output?.mode).toBe('generate')
    expect(agent.dataCapabilities?.operations).toEqual(['read', 'search'])
    expect(agent.keywords).toEqual(['catalog', 'merchandising'])
    expect(agent.suggestions).toEqual([
      { label: 'Show catalog stats', prompt: 'Show catalog stats' },
    ])
    expect(agent.domain).toBe('catalog')
    expect(agent.acceptedMediaTypes).toEqual(['image', 'pdf', 'file'])
    expect(agent.requiredFeatures).toEqual(['catalog.products.view'])
    expect(agent.uiParts).toEqual(['mutation-preview-card'])
    expect(agent.readOnly).toBe(true)
    expect(agent.defaultModel).toBe('gpt-4o')
    expect(resolvePageContext).not.toHaveBeenCalled()
  })

  it('enforces the structural shape at the type level (compile-time contract)', () => {
    const minimal: AiAgentDefinition = {
      id: 'mod.agent',
      moduleId: 'mod',
      label: 'l',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: [],
    }
    expect(minimal.allowedTools).toEqual([])
  })
})
