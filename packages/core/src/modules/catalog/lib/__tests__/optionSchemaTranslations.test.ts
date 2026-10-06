import { getTranslatableFieldExpander } from '@open-mercato/shared/lib/localization/translatable-fields'
import translatableFields from '../../translations'
import {
  OPTION_SCHEMA_TEMPLATE_ENTITY_TYPE,
  expandOptionSchemaTranslationFields,
  optionChoiceLabelTranslationField,
  optionLabelTranslationField,
} from '../optionSchemaTranslations'

describe('option schema translation field keys', () => {
  it('builds the option label key', () => {
    expect(optionLabelTranslationField('color')).toBe('options.color.label')
  })

  it('builds the choice label key', () => {
    expect(optionChoiceLabelTranslationField('color', 'red')).toBe('options.color.choices.red.label')
  })
})

describe('expandOptionSchemaTranslationFields', () => {
  const record = {
    id: 'tpl-1',
    name: 'Shirt',
    schema: {
      options: [
        {
          code: 'color',
          label: 'Color',
          inputType: 'select',
          choices: [{ code: 'red', label: 'Red' }, { code: 'blue' }],
        },
        { code: 'note', label: 'Note', inputType: 'text' },
        { label: 'No code', inputType: 'text' },
      ],
    },
  }

  it('emits an option key and one key per choice with base values', () => {
    expect(expandOptionSchemaTranslationFields(record)).toEqual([
      { key: 'options.color.label', label: 'Color', baseValue: 'Color' },
      { key: 'options.color.choices.red.label', label: 'Color › Red', baseValue: 'Red' },
      { key: 'options.color.choices.blue.label', label: 'Color › blue', baseValue: '' },
      { key: 'options.note.label', label: 'Note', baseValue: 'Note' },
    ])
  })

  it('returns nothing when the record carries no option schema', () => {
    expect(expandOptionSchemaTranslationFields({ id: 'tpl-2' })).toEqual([])
    expect(expandOptionSchemaTranslationFields({ schema: { options: 'nope' } })).toEqual([])
  })

  it('deduplicates repeated codes', () => {
    const keys = expandOptionSchemaTranslationFields({
      schema: { options: [{ code: 'a', label: 'A' }, { code: 'a', label: 'A2' }] },
    }).map((entry) => entry.key)
    expect(keys).toEqual(['options.a.label'])
  })
})

describe('catalog translations declaration', () => {
  it('keeps the static template fields and registers the option expander', () => {
    expect(translatableFields[OPTION_SCHEMA_TEMPLATE_ENTITY_TYPE]).toEqual(['name', 'description'])
    expect(getTranslatableFieldExpander(OPTION_SCHEMA_TEMPLATE_ENTITY_TYPE)).toBe(expandOptionSchemaTranslationFields)
  })
})
