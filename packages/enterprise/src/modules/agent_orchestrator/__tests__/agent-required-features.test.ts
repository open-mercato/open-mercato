import { z } from 'zod'
import { defineAgent, getAgentEntry } from '../lib/sdk/defineAgent'
import { parseAgentMarkdown } from '../lib/sdk/agentMarkdown'
import {
  agentRequiredFeaturesSchema,
  normalizeAgentRequiredFeatures,
} from '../data/validators'

const schema = z.object({ kind: z.literal('research'), data: z.unknown() })

describe('defineAgent requiredFeatures', () => {
  it('stores normalised requiredFeatures on the registry entry and forwards them to defineAiAgent', () => {
    const definition = defineAgent({
      id: 'test.gated_agent',
      moduleId: 'agent_orchestrator',
      label: 'Gated',
      description: 'Needs a feature.',
      instructions: 'BASE',
      requiredFeatures: [' deals.health.run ', 'deals.health.run', '', 'customers.*'],
      result: { kind: 'research', schema },
    })
    expect(definition.requiredFeatures).toEqual(['deals.health.run', 'customers.*'])
    expect(getAgentEntry('test.gated_agent')?.requiredFeatures).toEqual([
      'deals.health.run',
      'customers.*',
    ])
  })

  it('omits requiredFeatures when the agent declares none', () => {
    const definition = defineAgent({
      id: 'test.open_agent',
      moduleId: 'agent_orchestrator',
      label: 'Open',
      description: 'No gate.',
      instructions: 'BASE',
      result: { kind: 'research', schema },
    })
    expect('requiredFeatures' in definition).toBe(false)
    expect(getAgentEntry('test.open_agent')?.requiredFeatures).toBeUndefined()
  })

  it('omits requiredFeatures when the declared list normalises to empty', () => {
    const definition = defineAgent({
      id: 'test.blank_gate_agent',
      moduleId: 'agent_orchestrator',
      label: 'Blank',
      description: 'Only blanks.',
      instructions: 'BASE',
      requiredFeatures: ['  ', ''],
      result: { kind: 'research', schema },
    })
    expect('requiredFeatures' in definition).toBe(false)
    expect(getAgentEntry('test.blank_gate_agent')?.requiredFeatures).toBeUndefined()
  })

  it('rejects a malformed feature id without registering the agent', () => {
    expect(() =>
      defineAgent({
        id: 'test.bad_gate_agent',
        moduleId: 'agent_orchestrator',
        label: 'Bad',
        description: 'Malformed feature.',
        instructions: 'BASE',
        requiredFeatures: ['deals health run'],
        result: { kind: 'research', schema },
      }),
    ).toThrow('[internal] agent "test.bad_gate_agent" declares invalid requiredFeatures')
    expect(getAgentEntry('test.bad_gate_agent')).toBeUndefined()
  })
})

describe('agentRequiredFeaturesSchema', () => {
  it('trims, drops empties and dedupes in declaration order', () => {
    expect(agentRequiredFeaturesSchema.parse(['b.view', ' a.run ', 'b.view', ''])).toEqual([
      'b.view',
      'a.run',
    ])
  })

  it('rejects non-string entries and malformed ids', () => {
    expect(agentRequiredFeaturesSchema.safeParse([1]).success).toBe(false)
    expect(agentRequiredFeaturesSchema.safeParse(['has space']).success).toBe(false)
    expect(agentRequiredFeaturesSchema.safeParse(['.leading.dot']).success).toBe(false)
  })

  it('normalizeAgentRequiredFeatures returns undefined for absent or empty lists', () => {
    expect(normalizeAgentRequiredFeatures('x.y', undefined)).toBeUndefined()
    expect(normalizeAgentRequiredFeatures('x.y', [])).toBeUndefined()
    expect(normalizeAgentRequiredFeatures('x.y', ['a.b'])).toEqual(['a.b'])
    expect(() => normalizeAgentRequiredFeatures('x.y', 'a.b')).toThrow('[internal]')
  })
})

describe('parseAgentMarkdown requiredFeatures', () => {
  it('parses the inline list form', () => {
    const parsed = parseAgentMarkdown(
      ['---', 'id: a.b', 'label: A', 'description: d', 'requiredFeatures: [a.run, "b.view"]', '---', 'body'].join(
        '\n',
      ),
    )
    expect(parsed!.requiredFeatures).toEqual(['a.run', 'b.view'])
  })

  it('parses the block list form', () => {
    const parsed = parseAgentMarkdown(
      ['---', 'id: a.b', 'label: A', 'description: d', 'requiredFeatures:', '  - a.run', '  - b.*', '---', 'body'].join(
        '\n',
      ),
    )
    expect(parsed!.requiredFeatures).toEqual(['a.run', 'b.*'])
  })

  it('defaults to an empty list when absent', () => {
    const parsed = parseAgentMarkdown(['---', 'id: a.b', 'label: A', 'description: d', '---', 'body'].join('\n'))
    expect(parsed!.requiredFeatures).toEqual([])
  })
})
