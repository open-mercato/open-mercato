import { parseAgentMarkdown } from '../lib/sdk/agentMarkdown'

describe('parseAgentMarkdown', () => {
  it('parses frontmatter (inline lists) + body instructions', () => {
    const raw = [
      '---',
      'id: deals.health_check',
      'label: Deal health check',
      'description: Assess a deal and propose the next stage.',
      'provider: anthropic',
      'model: claude-sonnet-4-6',
      'tools: [customers.get_deal, customers.analyze]',
      'skills: [deals.stage_playbook]',
      'subAgents: [deals.activity_scan]',
      'maxSteps: 12',
      '---',
      'You assess the health of a sales deal.',
    ].join('\n')

    const parsed = parseAgentMarkdown(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('deals.health_check')
    expect(parsed!.label).toBe('Deal health check')
    expect(parsed!.description).toBe('Assess a deal and propose the next stage.')
    expect(parsed!.provider).toBe('anthropic')
    expect(parsed!.model).toBe('claude-sonnet-4-6')
    expect(parsed!.tools).toEqual(['customers.get_deal', 'customers.analyze'])
    expect(parsed!.skills).toEqual(['deals.stage_playbook'])
    expect(parsed!.subAgents).toEqual(['deals.activity_scan'])
    expect(parsed!.maxSteps).toBe(12)
    expect(parsed!.instructions).toBe('You assess the health of a sales deal.')
  })

  it('parses block-list form for tools/skills/subAgents', () => {
    const raw = [
      '---',
      'id: a.b',
      'label: A B',
      'description: desc',
      'tools:',
      '  - x.one',
      '  - x.two',
      'skills:',
      '  - s.one',
      '---',
      'body',
    ].join('\n')
    const parsed = parseAgentMarkdown(raw)
    expect(parsed!.tools).toEqual(['x.one', 'x.two'])
    expect(parsed!.skills).toEqual(['s.one'])
    expect(parsed!.subAgents).toEqual([])
  })

  it('ignores a non-numeric maxSteps', () => {
    const raw = ['---', 'id: a.b', 'label: A', 'description: d', 'maxSteps: lots', '---', 'body'].join('\n')
    const parsed = parseAgentMarkdown(raw)
    expect(parsed!.maxSteps).toBeUndefined()
  })

  it('returns null when a required field is missing', () => {
    const noId = ['---', 'label: A', 'description: d', '---', 'body'].join('\n')
    const noLabel = ['---', 'id: a.b', 'description: d', '---', 'body'].join('\n')
    const noDescription = ['---', 'id: a.b', 'label: A', '---', 'body'].join('\n')
    expect(parseAgentMarkdown(noId)).toBeNull()
    expect(parseAgentMarkdown(noLabel)).toBeNull()
    expect(parseAgentMarkdown(noDescription)).toBeNull()
  })

  it('returns null without frontmatter', () => {
    expect(parseAgentMarkdown('no frontmatter here')).toBeNull()
  })
})
