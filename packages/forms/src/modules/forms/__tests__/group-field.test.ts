import { V1_FIELD_TYPES } from '../schema/field-type-registry'
import {
  GROUP_TYPE,
  GROUP_MAX_ITEMS_SOFT_CAP,
  readGroupSubFields,
  readGroupMinItems,
  readGroupMaxItems,
} from '../schema/group-field'

const medicationsNode = {
  type: 'array',
  'x-om-type': 'group',
  'x-om-label': { en: 'Medications' },
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: 'Name' } },
      dose: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: 'Dose' } },
    },
  },
}

describe('group field type (W6)', () => {
  it('is registered on the default registry with the group widget + rows icon', () => {
    const spec = V1_FIELD_TYPES.group
    expect(spec).toBe(GROUP_TYPE)
    expect(spec.category).toBe('input')
    expect(spec.icon).toBe('rows')
    expect(spec.displayNameKey).toBe('forms.studio.palette.input.group')
    expect(spec.defaultUiSchema).toEqual({ widget: 'group' })
    expect(spec.renderer).toBeNull()
  })

  describe('readers', () => {
    it('reads sub-field descriptors in declaration order with required flags', () => {
      const subFields = readGroupSubFields(medicationsNode)
      expect(subFields.map((entry) => entry.key)).toEqual(['name', 'dose'])
      expect(subFields[0]).toMatchObject({ key: 'name', type: 'text', required: true })
      expect(subFields[1]).toMatchObject({ key: 'dose', type: 'text', required: false })
    })

    it('defaults min items to 0 and max items to null when absent', () => {
      expect(readGroupMinItems(medicationsNode)).toBe(0)
      expect(readGroupMaxItems(medicationsNode)).toBeNull()
    })

    it('reads explicit x-om-min-items / x-om-max-items', () => {
      const node = { ...medicationsNode, 'x-om-min-items': 1, 'x-om-max-items': 5 }
      expect(readGroupMinItems(node)).toBe(1)
      expect(readGroupMaxItems(node)).toBe(5)
    })
  })

  describe('validator', () => {
    it('treats null / undefined as valid (required-ness enforced elsewhere)', () => {
      expect(GROUP_TYPE.validator(null, medicationsNode)).toBe(true)
      expect(GROUP_TYPE.validator(undefined, medicationsNode)).toBe(true)
    })

    it('rejects non-array values', () => {
      expect(GROUP_TYPE.validator('x', medicationsNode)).not.toBe(true)
      expect(GROUP_TYPE.validator(42, medicationsNode)).not.toBe(true)
      expect(GROUP_TYPE.validator({}, medicationsNode)).not.toBe(true)
    })

    it('accepts an array of well-formed entries', () => {
      expect(
        GROUP_TYPE.validator(
          [
            { name: 'Aspirin', dose: '100mg' },
            { name: 'Ibuprofen' },
          ],
          medicationsNode,
        ),
      ).toBe(true)
    })

    it('rejects an entry missing a required sub-field', () => {
      expect(GROUP_TYPE.validator([{ dose: '100mg' }], medicationsNode)).not.toBe(true)
    })

    it('rejects an entry with an unknown sub-field', () => {
      expect(
        GROUP_TYPE.validator([{ name: 'Aspirin', mystery: 'x' }], medicationsNode),
      ).not.toBe(true)
    })

    it('rejects an entry whose sub-field fails its per-type validator', () => {
      const numericNode = {
        ...medicationsNode,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['count'],
          properties: {
            count: { type: 'integer', 'x-om-type': 'integer', 'x-om-label': { en: 'Count' } },
          },
        },
      }
      expect(GROUP_TYPE.validator([{ count: 'not-a-number' }], numericNode)).not.toBe(true)
      expect(GROUP_TYPE.validator([{ count: 3 }], numericNode)).toBe(true)
    })

    it('enforces x-om-min-items', () => {
      const node = { ...medicationsNode, 'x-om-min-items': 1 }
      expect(GROUP_TYPE.validator([], node)).not.toBe(true)
      expect(GROUP_TYPE.validator([{ name: 'Aspirin' }], node)).toBe(true)
    })

    it('enforces x-om-max-items', () => {
      const node = { ...medicationsNode, 'x-om-max-items': 1 }
      expect(GROUP_TYPE.validator([{ name: 'A' }, { name: 'B' }], node)).not.toBe(true)
      expect(GROUP_TYPE.validator([{ name: 'A' }], node)).toBe(true)
    })

    it('exposes the soft cap constant', () => {
      expect(GROUP_MAX_ITEMS_SOFT_CAP).toBeGreaterThan(0)
    })
  })

  describe('exportAdapter', () => {
    it('renders a readable per-entry summary using sub-field labels', () => {
      expect(
        GROUP_TYPE.exportAdapter(
          [
            { name: 'Aspirin', dose: '100mg' },
            { name: 'Ibuprofen', dose: '200mg' },
          ],
          medicationsNode,
        ),
      ).toBe('#1 Name: Aspirin, Dose: 100mg | #2 Name: Ibuprofen, Dose: 200mg')
    })

    it('renders an em-dash for missing sub-field values', () => {
      expect(GROUP_TYPE.exportAdapter([{ name: 'Aspirin' }], medicationsNode)).toBe(
        '#1 Name: Aspirin, Dose: —',
      )
    })

    it('exports an empty string for non-array / empty values', () => {
      expect(GROUP_TYPE.exportAdapter(null)).toBe('')
      expect(GROUP_TYPE.exportAdapter([])).toBe('')
      expect(GROUP_TYPE.exportAdapter('x')).toBe('')
    })

    it('falls back to raw keys when no field node is supplied', () => {
      expect(GROUP_TYPE.exportAdapter([{ name: 'Aspirin' }])).toBe('#1 name: Aspirin')
    })
  })
})
