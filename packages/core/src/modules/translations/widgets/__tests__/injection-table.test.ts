import { buildInjectionTable } from '../injection-table'
import { translatableFields as catalogFields } from '../../../catalog/translations'
import { translatableFields as dictionaryFields } from '../../../dictionaries/translations'
import { translatableFields as entitiesFields } from '../../../entities/translations'
import { translatableFields as resourcesFields } from '../../../resources/translations'

const allExpectedEntityTypes = [
  ...Object.keys(catalogFields),
  ...Object.keys(dictionaryFields),
  ...Object.keys(entitiesFields),
  ...Object.keys(resourcesFields),
]

const expectedFields: Record<string, string[]> = {
  ...catalogFields,
  ...dictionaryFields,
  ...entitiesFields,
  ...resourcesFields,
}

describe('translations injection-table', () => {
  const injectionTable = buildInjectionTable(expectedFields)

  it('generates a full-form header entry for every translatable entity type', () => {
    for (const entityType of allExpectedEntityTypes) {
      const spotId = `crud-form:${entityType.replace(/:/g, '.')}:header`
      expect(injectionTable[spotId]).toBeDefined()
    }
  })

  it('generates short-form header entries for entity types with module prefix', () => {
    expect(injectionTable['crud-form:catalog.product:header']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_variant:header']).toBeDefined()
    expect(injectionTable['crud-form:catalog.offer:header']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_category:header']).toBeDefined()
    expect(injectionTable['crud-form:catalog.product_tag:header']).toBeDefined()
    expect(injectionTable['crud-form:catalog.option_schema_template:header']).toBeDefined()
  })

  it('does not generate short-form entries without module prefix convention', () => {
    expect(injectionTable['crud-form:dictionaries.dictionary_entry:header']).toBeDefined()
    expect(injectionTable['crud-form:dictionaries.entry:header']).toBeUndefined()
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

  it('includes resources:resources_resource in both full and short form', () => {
    expect(injectionTable['crud-form:resources.resources_resource:header']).toBeDefined()
    expect(injectionTable['crud-form:resources.resource:header']).toBeDefined()
  })

  it('includes resources:resources_resource_type in both full and short form', () => {
    expect(injectionTable['crud-form:resources.resources_resource_type:header']).toBeDefined()
    expect(injectionTable['crud-form:resources.resource_type:header']).toBeDefined()
  })
})
