/**
 * Coverage for the AI override pipeline. The pipeline is the only public
 * way for downstream modules (or app-level code) to replace or disable
 * an AI agent / AI tool registered by another module — see spec
 * `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md`.
 */
import {
  applyAgentOverrideMap,
  applyAiAgentOverrides,
  applyAiToolOverrides,
  composeAgentOverrideMap,
  composeToolOverrideMap,
  applyToolOverrideMap,
  resetProgrammaticOverridesForTests,
  snapshotProgrammaticOverrides,
  type AiOverrideConfigEntry,
} from '../ai-overrides'
import {
  applyAgentOverrideEntriesForTests,
  listAgents,
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import { z } from 'zod'

function makeAgent(id: string, overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id,
    moduleId: id.split('.')[0] ?? 'mod',
    label: id,
    description: id,
    systemPrompt: 'system',
    allowedTools: [],
    ...overrides,
  } as AiAgentDefinition
}

function makeTool(name: string, overrides: Partial<AiToolDefinition> = {}): AiToolDefinition {
  return {
    name,
    description: name,
    inputSchema: z.object({}),
    requiredFeatures: [],
    handler: async () => ({ ok: true }),
    ...overrides,
  } as AiToolDefinition
}

beforeEach(() => {
  resetAgentRegistryForTests()
  resetProgrammaticOverridesForTests()
})

describe('composeAgentOverrideMap', () => {
  it('merges file-based entries in order, last wins', () => {
    const baseAgent = makeAgent('catalog.merchandising_assistant')
    const replacement = makeAgent('catalog.merchandising_assistant', { label: 'Replacement' })
    const entries: AiOverrideConfigEntry[] = [
      { moduleId: 'app', overrides: { agents: { 'catalog.merchandising_assistant': baseAgent } } },
      { moduleId: 'app2', overrides: { agents: { 'catalog.merchandising_assistant': replacement } } },
    ]
    const map = composeAgentOverrideMap(entries)
    expect(map['catalog.merchandising_assistant']).toBe(replacement)
  })

  it('programmatic overrides supersede file-based entries', () => {
    const fileAgent = makeAgent('catalog.merchandising_assistant', { label: 'File' })
    const programmaticAgent = makeAgent('catalog.merchandising_assistant', { label: 'Programmatic' })
    applyAiAgentOverrides({ 'catalog.merchandising_assistant': programmaticAgent })
    const entries: AiOverrideConfigEntry[] = [
      { moduleId: 'app', overrides: { agents: { 'catalog.merchandising_assistant': fileAgent } } },
    ]
    const map = composeAgentOverrideMap(entries)
    expect(map['catalog.merchandising_assistant']).toBe(programmaticAgent)
  })

  it('null override propagates through both layers', () => {
    applyAiAgentOverrides({ 'catalog.catalog_assistant': null })
    const map = composeAgentOverrideMap([])
    expect(map['catalog.catalog_assistant']).toBeNull()
  })
})

describe('applyAgentOverrideMap', () => {
  it('replaces an existing agent in place', () => {
    const original = makeAgent('catalog.merchandising_assistant', { label: 'Original' })
    const replacement = makeAgent('catalog.merchandising_assistant', { label: 'Replacement' })
    const out = applyAgentOverrideMap([original], {
      'catalog.merchandising_assistant': replacement,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(replacement)
  })

  it('disables an agent when the override is null', () => {
    const a = makeAgent('catalog.catalog_assistant')
    const b = makeAgent('catalog.merchandising_assistant')
    const out = applyAgentOverrideMap([a, b], { 'catalog.catalog_assistant': null })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('catalog.merchandising_assistant')
  })

  it('warns and skips a malformed override (id mismatch)', () => {
    const a = makeAgent('catalog.catalog_assistant')
    const malformed = makeAgent('catalog.merchandising_assistant')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const out = applyAgentOverrideMap([a], {
      // The map key says one id but the value carries another.
      'catalog.catalog_assistant': malformed,
    })
    expect(warnSpy).toHaveBeenCalled()
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(a)
    warnSpy.mockRestore()
  })

  it('warns when an override targets an id with no base entry but does not throw', () => {
    const replacement = makeAgent('catalog.unknown')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const out = applyAgentOverrideMap([], { 'catalog.unknown': replacement })
    expect(warnSpy).toHaveBeenCalled()
    // Override that registers a brand-new agent IS supported (synthetic agents)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(replacement)
    warnSpy.mockRestore()
  })

  it('returns a copy when the override map is empty', () => {
    const a = makeAgent('m.a')
    const out = applyAgentOverrideMap([a], {})
    expect(out).not.toBe([a])
    expect(out).toEqual([a])
  })
})

describe('agent-registry override pipeline', () => {
  it('disables an agent registered by another module via a null override', () => {
    seedAgentRegistryForTests([
      makeAgent('catalog.catalog_assistant'),
      makeAgent('catalog.merchandising_assistant'),
    ])
    expect(listAgents().map((a) => a.id)).toEqual([
      'catalog.catalog_assistant',
      'catalog.merchandising_assistant',
    ])
    applyAgentOverrideEntriesForTests([
      { moduleId: 'app', overrides: { agents: { 'catalog.catalog_assistant': null } } },
    ])
    expect(listAgents().map((a) => a.id)).toEqual(['catalog.merchandising_assistant'])
  })

  it('replaces an agent registered by another module', () => {
    seedAgentRegistryForTests([
      makeAgent('catalog.merchandising_assistant', { label: 'Default' }),
    ])
    const replacement = makeAgent('catalog.merchandising_assistant', { label: 'App-level Replacement' })
    applyAgentOverrideEntriesForTests([
      { moduleId: 'app', overrides: { agents: { 'catalog.merchandising_assistant': replacement } } },
    ])
    const list = listAgents()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('App-level Replacement')
  })

  it('module load order — last file entry wins', () => {
    seedAgentRegistryForTests([makeAgent('m.x', { label: 'Original' })])
    const first = makeAgent('m.x', { label: 'First override' })
    const second = makeAgent('m.x', { label: 'Second override' })
    applyAgentOverrideEntriesForTests([
      { moduleId: 'overrider1', overrides: { agents: { 'm.x': first } } },
      { moduleId: 'overrider2', overrides: { agents: { 'm.x': second } } },
    ])
    expect(listAgents()[0].label).toBe('Second override')
  })

  it('programmatic override beats file-based override', () => {
    seedAgentRegistryForTests([makeAgent('m.x', { label: 'Original' })])
    const fileAgent = makeAgent('m.x', { label: 'File' })
    const programmatic = makeAgent('m.x', { label: 'Programmatic' })
    applyAiAgentOverrides({ 'm.x': programmatic })
    applyAgentOverrideEntriesForTests([
      { moduleId: 'overrider', overrides: { agents: { 'm.x': fileAgent } } },
    ])
    expect(listAgents()[0].label).toBe('Programmatic')
  })

  it('snapshotProgrammaticOverrides reflects the current state', () => {
    expect(snapshotProgrammaticOverrides().agents).toEqual({})
    const replacement = makeAgent('m.x', { label: 'X' })
    applyAiAgentOverrides({ 'm.x': replacement, 'm.y': null })
    const snapshot = snapshotProgrammaticOverrides()
    expect(snapshot.agents).toEqual({ 'm.x': replacement, 'm.y': null })
  })
})

describe('tool override map', () => {
  it('disables a tool when the override is null', () => {
    const base = new Map<string, AiToolDefinition>([
      ['customers.update_deal_stage', makeTool('customers.update_deal_stage')],
      ['customers.list_people', makeTool('customers.list_people')],
    ])
    const out = applyToolOverrideMap(base, { 'customers.update_deal_stage': null })
    expect(out.has('customers.update_deal_stage')).toBe(false)
    expect(out.has('customers.list_people')).toBe(true)
  })

  it('replaces a tool when the override is a definition', () => {
    const original = makeTool('customers.update_deal_stage', { description: 'Original' })
    const replacement = makeTool('customers.update_deal_stage', { description: 'Replacement' })
    const base = new Map<string, AiToolDefinition>([['customers.update_deal_stage', original]])
    const out = applyToolOverrideMap(base, { 'customers.update_deal_stage': replacement })
    expect(out.get('customers.update_deal_stage')).toBe(replacement)
  })

  it('skips and warns on malformed overrides (name mismatch)', () => {
    const original = makeTool('customers.update_deal_stage')
    const malformed = makeTool('customers.list_people')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const base = new Map<string, AiToolDefinition>([['customers.update_deal_stage', original]])
    const out = applyToolOverrideMap(base, { 'customers.update_deal_stage': malformed })
    expect(warnSpy).toHaveBeenCalled()
    expect(out.get('customers.update_deal_stage')).toBe(original)
    warnSpy.mockRestore()
  })

  it('composeToolOverrideMap: programmatic beats file-based', () => {
    const fileTool = makeTool('m.x', { description: 'File' })
    const progTool = makeTool('m.x', { description: 'Programmatic' })
    applyAiToolOverrides({ 'm.x': progTool })
    const map = composeToolOverrideMap([
      { moduleId: 'app', overrides: { tools: { 'm.x': fileTool } } },
    ])
    expect(map['m.x']).toBe(progTool)
  })

  it('composeToolOverrideMap: null disables across both layers', () => {
    applyAiToolOverrides({ 'm.x': null })
    const map = composeToolOverrideMap([])
    expect(map['m.x']).toBeNull()
  })
})
