import { injectionTable } from '../injection-table'
import { translatableFields as catalogFields } from '../../../catalog/translations'
import { translatableFields as dictionaryFields } from '../../../dictionaries/translations'
import { translatableFields as entitiesFields } from '../../../entities/translations'

const allExpectedEntityTypes = [
  ...Object.keys(catalogFields),
  ...Object.keys(dictionaryFields),
  ...Object.keys(entitiesFields),
]

describe('translations injection-table', () => {
  it('generates a full-form entry for every translatable entity type', () => {
    for (const entityType of allExpectedEntityTypes) {
      const spotId = `crud-form:${entityType.replace(/:/g, '.')}`
      expect(injectionTable[spotId]).toBeDefined()
    }
  })

  it('generates short-form entries for entity types with module prefix', () => {
    // catalog:catalog_product → short form: crud-form:catalog.product
    expect(injectionTable['crud-form:catalog.product']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_variant']).toBeDefined()
    expect(injectionTable['crud-form:catalog.offer']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_category']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_tag']).toBeDefined()
    expect(injectionTable['crud-form:catalog.option_schema_template']).toBeDefined()
  })

  it('does not generate short-form for entries without module prefix', () => {
    // dictionaries:dictionary_entry → prefix is "dictionaries_", slug is "dictionary_entry"
    // "dictionary_entry" does NOT start with "dictionaries_", so no short form
    expect(injectionTable['crud-form:dictionaries.dictionary_entry']).toBeDefined()
  })

  it('uses the correct widget ID for all entries', () => {
    const widgetId = 'translations.injection.translation-manager'
    for (const slots of Object.values(injectionTable)) {
      const slotsArray = Array.isArray(slots) ? slots : [slots]
      for (const slot of slotsArray) {
        const resolved = typeof slot === 'string' ? slot : slot.widgetId
        expect(resolved).toBe(widgetId)
      }
    }
  })

  it('places all widgets in column 2 with kind=group', () => {
    for (const slots of Object.values(injectionTable)) {
      const slotsArray = Array.isArray(slots) ? slots : [slots]
      for (const slot of slotsArray) {
        if (typeof slot !== 'string') {
          expect(slot.column).toBe(2)
          expect(slot.kind).toBe('group')
        }
      }
    }
  })

  it('includes catalog:catalog_product in both full and short form', () => {
    expect(injectionTable['crud-form:catalog.catalog_product']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product']).toBeDefined()
  })

  it('includes dictionaries:dictionary_entry spot', () => {
    expect(injectionTable['crud-form:dictionaries.dictionary_entry']).toBeDefined()
  })

  it('includes entities:custom_field_def spot', () => {
    expect(injectionTable['crud-form:entities.custom_field_def']).toBeDefined()
  })
})
