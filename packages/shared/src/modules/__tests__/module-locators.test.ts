import { parseModuleLocator, normalizeModuleLocator, resolveModuleRequirement, getModuleRequirementHint } from '../module-locators'

describe('module locators', () => {
  it.each([
    ['npm:@pkarw/marketing_consents@1.2.3', 'npm:@pkarw/marketing_consents'],
    ['@pkarw/marketing_consents@next', 'npm:@pkarw/marketing_consents'],
    ['npm:marketing_consents@latest', 'npm:marketing_consents'],
    ['github:Open-Mercato/marketing-consents#main', 'github:open-mercato/marketing-consents'],
    ['https://github.com/Open-Mercato/marketing-consents.git@1.2.3', 'github:open-mercato/marketing-consents'],
    ['git@github.com:Open-Mercato/marketing-consents.git', 'github:open-mercato/marketing-consents'],
    ['git+ssh://git@github.com/Open-Mercato/marketing-consents.git#main', 'github:open-mercato/marketing-consents'],
    ['github.com/Open-Mercato/marketing-consents.git', 'github:open-mercato/marketing-consents'],
    ['github:marketing-consents', 'github:marketing-consents'],
    ['marketing_consents', 'marketing_consents'],
  ])('normalizes %s', (input, expected) => expect(normalizeModuleLocator(input)).toBe(expected))

  it('keeps source selectors in installation guidance', () => {
    expect(getModuleRequirementHint('npm:@pkarw/consents@next')).toBe("npx create-mercato-module install 'npm:@pkarw/consents@next'")
    expect(getModuleRequirementHint('github:pkarw/consents#main')).toBe("npx create-mercato-module install 'github:pkarw/consents#main'")
    expect(getModuleRequirementHint('npm:consents')).toBe("npx create-mercato-module install 'npm:consents'")
    expect(getModuleRequirementHint('consents')).toBe("Enable module 'consents' in src/modules.ts.")
  })

  it('keeps npm version selectors for installation', () => {
    expect(parseModuleLocator('npm:@pkarw/marketing_consents@next')?.installSpecifier).toBe('@pkarw/marketing_consents@next')
  })

  it('does not satisfy a source requirement with a matching module id from another publisher', () => {
    const enabled = [{ id: 'marketing_consents', locators: ['npm:@pkarw/marketing_consents'] }]
    expect(resolveModuleRequirement('marketing_consents', enabled)).toBe('marketing_consents')
    expect(resolveModuleRequirement('@pkarw/marketing_consents@next', enabled)).toBe('marketing_consents')
    expect(resolveModuleRequirement('@open-mercato/marketing_consents', enabled)).toBeUndefined()
  })

  it('matches repository shorthand only through explicit source evidence', () => {
    const enabled = [{ id: 'marketing_consents', locators: ['github:pkarw/marketing-consents'] }]
    expect(resolveModuleRequirement('github:marketing-consents', enabled)).toBe('marketing_consents')
    expect(resolveModuleRequirement('marketing-consents', enabled)).toBe('marketing_consents')
    expect(resolveModuleRequirement('marketing-consents', [...enabled, { id: 'other', locators: ['github:other/marketing-consents'] }])).toBeUndefined()
  })

  it.each(['https://example.com/owner/repo', 'npm:', `npm:${'a'.repeat(215)}`, 'npm:@.invalid/package', 'github:owner/repo#bad;ref', 'owner/repo/extra', ' module name ', 'https://github.com/owner/repo/tree/main', 'npm:package@bad;selector', 'npm:package@latest\"'])('rejects malformed %s', (input) => {
    expect(parseModuleLocator(input)).toBeNull()
  })
})
