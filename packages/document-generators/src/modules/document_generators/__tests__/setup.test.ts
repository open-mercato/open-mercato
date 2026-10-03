import { features } from '../acl'
import { setup } from '../setup'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'

describe('document generator default access', () => {
  it.each(['admin', 'superadmin'])('grants %s every declared engine feature without granting source-module access', (role) => {
    const grants = setup.defaultRoleFeatures?.[role]
    expect(grants).toEqual(expect.arrayContaining(features.map((feature) => feature.id)))
    expect(grants).toHaveLength(features.length)
    expect(features.every((feature) => feature.module === 'document_generators')).toBe(true)
  })

  it('does not implicitly grant document access to employee or portal roles', () => {
    expect(setup.defaultRoleFeatures?.employee ?? []).toEqual([])
    expect(setup.defaultCustomerRoleFeatures).toBeUndefined()
  })
})

describe('document generator translations', () => {
  it.each(Object.entries({ en, pl, de, es, ko }))('ships complete nonempty engine strings in %s', (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(dictionary)) {
      expect(key).toMatch(/^document_generators\./)
      expect(value.trim()).not.toBe('')
      expect(value).not.toBe(key)
    }
  })

  it('covers each stable API error code', () => {
    for (const code of ['invalid_json', 'invalid_query', 'invalid_request', 'unknown_template', 'forbidden', 'organization_required', 'render_failed']) {
      expect(en).toHaveProperty([`document_generators.errors.${code}`])
    }
  })
})
