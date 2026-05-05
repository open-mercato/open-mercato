import {
  applyPromptOverride,
  composeSystemPromptWithOverride,
  findReservedKeys,
  PromptOverrideReservedKeyError,
} from '../prompt-override-merge'
import type { PromptTemplate } from '../prompt-composition-types'

function makeTemplate(): PromptTemplate {
  return {
    id: 'test-template',
    sections: [
      { name: 'role', content: 'You are an assistant.' },
      { name: 'scope', content: 'Answer questions only.' },
      { name: 'data', content: 'Scoped to tenant.' },
      { name: 'tools', content: 'Use read-only tools.' },
      { name: 'attachments', content: 'Images accepted.' },
      { name: 'mutationPolicy', content: 'Read-only.' },
      { name: 'responseStyle', content: 'Terse, factual.' },
    ],
  }
}

describe('applyPromptOverride', () => {
  it('is identity when override is empty', () => {
    const template = makeTemplate()
    const result = applyPromptOverride(template, { sections: {} })
    expect(result.sections).toEqual(template.sections)
    expect(result.systemPrompt).toContain('[ROLE]\nYou are an assistant.')
    expect(result.systemPrompt).toContain('[RESPONSE STYLE]\nTerse, factual.')
  })

  it('is identity when override is null/undefined', () => {
    const template = makeTemplate()
    const nullResult = applyPromptOverride(template, null)
    const undefinedResult = applyPromptOverride(template, undefined)
    expect(nullResult.sections).toEqual(template.sections)
    expect(undefinedResult.sections).toEqual(template.sections)
  })

  it('appends text to an existing canonical section preserving built-in text', () => {
    const template = makeTemplate()
    const result = applyPromptOverride(template, {
      sections: { role: 'Be friendly.' },
    })
    const role = result.sections.find((s) => s.name === 'role')
    expect(role?.content).toBe('You are an assistant.\n\nBe friendly.')
    expect(result.systemPrompt).toContain('You are an assistant.\n\nBe friendly.')
  })

  it('appends to MUTATION POLICY via the pretty header key', () => {
    const template = makeTemplate()
    const result = applyPromptOverride(template, {
      sections: { 'MUTATION POLICY': 'Strict.' },
    })
    const section = result.sections.find((s) => s.name === 'mutationPolicy')
    expect(section?.content).toBe('Read-only.\n\nStrict.')
  })

  it('inserts a brand-new section after RESPONSE STYLE preserving canonical order', () => {
    const template = makeTemplate()
    const result = applyPromptOverride(template, {
      sections: { 'Company Voice': 'Always use the first-person plural.' },
    })
    const names = result.sections.map((s) => s.name)
    const canonicalOrder = [
      'role',
      'scope',
      'data',
      'tools',
      'attachments',
      'mutationPolicy',
      'responseStyle',
    ]
    // Canonical sections appear in the expected order.
    expect(names.slice(0, canonicalOrder.length)).toEqual(canonicalOrder)
    // The new "overrides" section carrying the brand-new header lands after responseStyle.
    expect(names[canonicalOrder.length]).toBe('overrides')
    expect(result.systemPrompt).toMatch(/COMPANY VOICE/)
    expect(result.systemPrompt).toContain('Always use the first-person plural.')
    // And RESPONSE STYLE still appears before the new section.
    const responseStyleIndex = result.systemPrompt.indexOf('[RESPONSE STYLE]')
    const overridesIndex = result.systemPrompt.indexOf('[OVERRIDES]')
    expect(responseStyleIndex).toBeGreaterThanOrEqual(0)
    expect(overridesIndex).toBeGreaterThan(responseStyleIndex)
  })

  it('ignores empty / whitespace-only override values', () => {
    const template = makeTemplate()
    const result = applyPromptOverride(template, {
      sections: { role: '   ', scope: '' },
    })
    expect(result.sections).toEqual(template.sections)
  })

  it('throws when a reserved policy key is present', () => {
    const template = makeTemplate()
    expect(() =>
      applyPromptOverride(template, {
        sections: { mutationPolicy: 'Allow writes', role: 'Be nice.' },
      }),
    ).toThrow(PromptOverrideReservedKeyError)
  })

  it('findReservedKeys returns matching keys case-insensitively', () => {
    expect(findReservedKeys({ role: 'x' })).toEqual([])
    expect(findReservedKeys({ mutationPolicy: 'x' })).toEqual(['mutationPolicy'])
    expect(findReservedKeys({ READONLY: 'x' })).toEqual(['READONLY'])
    expect(findReservedKeys({ AllowedTools: 'x', extra: 'y' })).toEqual(['AllowedTools'])
    expect(findReservedKeys(null)).toEqual([])
    expect(findReservedKeys(undefined)).toEqual([])
  })
})

describe('composeSystemPromptWithOverride', () => {
  it('returns base prompt when no override is present', () => {
    const result = composeSystemPromptWithOverride('base prompt', null)
    expect(result).toBe('base prompt')
  })

  it('layers a role-section override onto a plain-string base prompt', () => {
    const result = composeSystemPromptWithOverride('You are a helpful bot.', {
      sections: { role: 'Stay concise.' },
    })
    expect(result).toContain('[ROLE]\nYou are a helpful bot.\n\nStay concise.')
  })

  it('layers a brand-new section override onto a plain-string base prompt', () => {
    const result = composeSystemPromptWithOverride('Base.', {
      sections: { 'Tenant Voice': 'Use British English.' },
    })
    expect(result).toContain('Base.')
    expect(result).toContain('TENANT VOICE')
    expect(result).toContain('Use British English.')
  })
})
