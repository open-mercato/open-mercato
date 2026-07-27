import { parseSkillMarkdown } from '../lib/sdk/skillMarkdown'

describe('parseSkillMarkdown', () => {
  it('parses frontmatter (block tools list) + body', () => {
    const raw = [
      '---',
      'id: deals.stage_playbook',
      'moduleId: agent_orchestrator',
      'label: Deal stage playbook',
      'description: Pipeline expertise.',
      'tools:',
      '  - customers.analyze_deals',
      '  - customers.get_deal',
      '---',
      '# Heading',
      '',
      'Body text.',
    ].join('\n')
    const parsed = parseSkillMarkdown(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('deals.stage_playbook')
    expect(parsed!.moduleId).toBe('agent_orchestrator')
    expect(parsed!.label).toBe('Deal stage playbook')
    expect(parsed!.description).toBe('Pipeline expertise.')
    expect(parsed!.tools).toEqual(['customers.analyze_deals', 'customers.get_deal'])
    expect(parsed!.instructions).toBe('# Heading\n\nBody text.')
  })

  it('parses the inline tools array form', () => {
    const raw = [
      '---',
      'id: x.y',
      'moduleId: m',
      'label: L',
      'tools: [a.b, "c.d"]',
      '---',
      'Body.',
    ].join('\n')
    const parsed = parseSkillMarkdown(raw)
    expect(parsed!.tools).toEqual(['a.b', 'c.d'])
  })

  it('returns null when required frontmatter is missing', () => {
    const raw = ['---', 'label: only a label', '---', 'Body.'].join('\n')
    expect(parseSkillMarkdown(raw)).toBeNull()
  })

  it('returns null when there is no frontmatter block', () => {
    expect(parseSkillMarkdown('# Just markdown, no frontmatter')).toBeNull()
  })

  it('defaults tools to an empty array when omitted', () => {
    const raw = ['---', 'id: a.b', 'moduleId: m', 'label: L', '---', 'Body.'].join('\n')
    const parsed = parseSkillMarkdown(raw)
    expect(parsed!.tools).toEqual([])
  })
})
