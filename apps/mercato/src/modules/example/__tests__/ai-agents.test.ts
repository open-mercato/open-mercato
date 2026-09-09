/** @jest-environment node */
/**
 * `ai-agents.ts` declares two independent things and both have failure modes that
 * only show up at runtime:
 *
 * - the agent's `allowedTools` is a closed whitelist, so a typo silently removes a
 *   tool from the model instead of erroring;
 * - `aiAgentExtensions` patches an agent this module does not own, so it must name
 *   a foreign agent id and may only append tools this module actually ships.
 *
 * Every expectation below is cross-file (agent ↔ tool pack ↔ acl) or a literal, so
 * widening the declaration cannot widen the assertion with it.
 */
import aclFeatures from '../acl'
import aiTools from '../ai-tools'
import aiAgents, { aiAgentExtensions, compileExamplePrompt } from '../ai-agents'

const declaredToolNames = new Set(aiTools.map((tool) => tool.name))
const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))
const mutationToolNames = new Set(aiTools.filter((tool) => tool.isMutation).map((tool) => tool.name))

describe('example ai-agents contribution', () => {
  it('ships exactly one agent, namespaced to this module', () => {
    expect(aiAgents).toHaveLength(1)
    expect(aiAgents[0].id).toBe('example.todo_assistant')
    expect(aiAgents[0].moduleId).toBe('example')
    expect(aiAgents[0].id.startsWith(`${aiAgents[0].moduleId}.`)).toBe(true)
  })

  it('whitelists only tools this module declares', () => {
    const agent = aiAgents[0]
    expect(agent.allowedTools.length).toBeGreaterThan(0)
    const unknown = agent.allowedTools.filter((name) => !declaredToolNames.has(name))
    expect(unknown).toEqual([])
  })

  it('keeps readOnly, mutationPolicy and the whitelist mutually consistent', () => {
    const agent = aiAgents[0]
    expect(agent.readOnly).toBe(true)
    expect(agent.mutationPolicy).toBe('read-only')
    const writes = agent.allowedTools.filter((name) => mutationToolNames.has(name))
    expect(writes).toEqual([])
  })

  it('gates the agent on a feature acl.ts declares', () => {
    const required = aiAgents[0].requiredFeatures ?? []
    expect(required.length).toBeGreaterThan(0)
    expect(required.filter((feature) => !declaredFeatureIds.has(feature))).toEqual([])
  })

  it('compiles the system prompt in declared section order', () => {
    const compiled = compileExamplePrompt([
      { name: 'responseStyle', order: 7, content: '  LAST  ' },
      { name: 'role', order: 1, content: '  FIRST  ' },
      { name: 'scope', order: 2, content: 'MIDDLE' },
    ])
    expect(compiled).toBe('FIRST\n\nMIDDLE\n\nLAST')
  })

  it('emits a non-empty system prompt carrying every named section', () => {
    const prompt = aiAgents[0].systemPrompt
    for (const heading of [
      'ROLE',
      'SCOPE',
      'DATA',
      'TOOLS',
      'ATTACHMENTS',
      'MUTATION POLICY',
      'RESPONSE STYLE',
    ]) {
      expect(prompt).toContain(heading)
    }
  })
})

describe('example aiAgentExtensions', () => {
  it('patches an agent owned by another module, never one of its own', () => {
    expect(aiAgentExtensions).toHaveLength(1)
    const ownAgentIds = new Set(aiAgents.map((agent) => agent.id))
    for (const extension of aiAgentExtensions) {
      expect(ownAgentIds.has(extension.targetAgentId)).toBe(false)
      expect(extension.targetAgentId.startsWith('example.')).toBe(false)
    }
  })

  it('only lends tools this module actually declares', () => {
    for (const extension of aiAgentExtensions) {
      const appended = extension.appendAllowedTools ?? []
      expect(appended.length).toBeGreaterThan(0)
      expect(appended.filter((name) => !declaredToolNames.has(name))).toEqual([])
      expect(appended.filter((name) => mutationToolNames.has(name))).toEqual([])
    }
  })

  it('stays additive — it never replaces or deletes the host agent\'s surface', () => {
    for (const extension of aiAgentExtensions) {
      expect(extension.replaceAllowedTools).toBeUndefined()
      expect(extension.deleteAllowedTools).toBeUndefined()
      expect(extension.replaceSystemPrompt).toBeUndefined()
      expect(extension.replaceSuggestions).toBeUndefined()
      expect(extension.deleteSuggestions).toBeUndefined()
    }
  })
})
