import { z } from 'zod'
import { field } from '../crud-form-extensions'
import {
  createCrudFormDerivedSectionIdentity,
  crudFormExtensionOptionsLoader,
  defineCrudFormFieldGranularSection,
  deriveCrudFormFieldGranularSection,
} from '../crud-form-field-granular'

const address = { hostId: 'inventory.product', formVariant: 'default', formOperation: 'update', sectionId: 'details' } as const
const identity = createCrudFormDerivedSectionIdentity('inventory.extension', 'details', 3)
const titleSchema = z.string().trim().min(1)
const titleProjector = jest.fn((value: unknown, values: Readonly<Record<string, unknown>>) => ({ details: { title: value, category: values.category } }))
const detailsProjector = (value: unknown) => ({ details: { notes: value } })
const title = { id: 'general.title', type: 'text', label: 'Title' } as const
const notes = { id: 'notes', type: 'textarea', label: 'Notes' } as const
const check = jest.fn(() => ({ notes: 'product.errors.notes' }))

function baseSection(mandatory?: boolean) {
  return defineCrudFormFieldGranularSection({
    id: 'inventory.details',
    roundTripId: 'inventory.details@v1',
    group: { id: 'details' },
    fields: [title, notes],
    fieldSchemas: { 'general.title': titleSchema, notes: z.string().optional() },
    fieldPayloadPaths: { 'general.title': ['details.title', 'details.category'], notes: ['details.notes'] },
    refinements: [{ id: 'details-with-notes', fieldPaths: ['general.title', 'notes'], mandatory, check }],
    projectField: { 'general.title': titleProjector, notes: detailsProjector },
  })
}

beforeEach(() => jest.clearAllMocks())

test('prunes optional intersecting refinements and reuses unaltered schema, controls, and projector', () => {
  const base = baseSection()
  expect(base.refinements[0].mandatory).toBe(false)
  expect(baseSection(false).refinements).toEqual(base.refinements)
  const derived = deriveCrudFormFieldGranularSection({
    identity, address, base, changes: { notes: { operation: 'remove' } }, addedPayloadPaths: {},
  })
  expect(derived.roundTripId).toBe('inventory.extension.details@v3')
  expect(derived.group.fields).toEqual([title])
  expect(derived.group.fields?.[0]).toBe(base.fields[0])
  expect(derived.fieldSchemas['general.title']).toBe(titleSchema)
  expect(derived.projectField['general.title']).toBe(titleProjector)
  expect(derived.fieldPayloadPaths['general.title']).toBe(base.fieldPayloadPaths['general.title'])
  expect(derived.fieldSchemas).not.toHaveProperty('notes')
  expect(derived.projectField).not.toHaveProperty('notes')
  expect(derived.refinements).toEqual([])
  const values = { general: { title: '  Trimmed ' }, notes: 'omitted', category: 'active' }
  expect(derived.validateAndProject({ sectionValues: values, fullValues: values })).toMatchObject({
    success: true, data: { payload: { details: { title: 'Trimmed', category: 'active' } } },
  })
  expect(titleProjector.mock.lastCall?.[1]).toBe(values)
  expect(check).not.toHaveBeenCalled()
})

test('names the mandatory refinement when removing a participating field', () => {
  expect(() => deriveCrudFormFieldGranularSection({
    identity, address, base: baseSection(true), changes: { notes: { operation: 'remove' } }, addedPayloadPaths: {},
  })).toThrow(/mandatory refinement "details-with-notes"/)
})

test('patches presentation and checks an already-loaded browser rule with the exact bound context', async () => {
  const rule = jest.fn(() => 'product.errors.title' as const)
  const patch = field.patch({
    labelKey: 'product.fields.title',
    validate: { client: async () => ({ default: rule }), server: async () => true as const },
  })
  const base = baseSection()
  const section = deriveCrudFormFieldGranularSection({
    identity, address, base, addedPayloadPaths: {},
    changes: {
      'general.title': { operation: 'patch', patch: { labelKey: patch.patch.labelKey, readOnly: true, rules: [{ minLength: 2, messageKey: 'product.errors.short' }] } },
      notes: { operation: 'remove' },
    },
    prepared: { 'general.title': { clientRule: (await patch.patch.validate.client()).default, validationPayloadPath: 'details.title' } },
  })
  expect(section.fields[0]).toMatchObject({ labelKey: 'product.fields.title', readOnly: true })
  expect(section.fields[0]).not.toBe(base.fields[0])
  expect(section.projectField['general.title']).toBe(base.projectField['general.title'])
  expect(section.fieldSchemas['general.title']).toBe(base.fieldSchemas['general.title'])
  const submit = (titleValue: string) => {
    const values = { general: { title: titleValue }, category: 'active' }
    return section.validateAndProject({ sectionValues: values, fullValues: values })
  }
  expect(submit('  A  ')).toEqual({ success: false, fieldErrors: { 'general.title': 'product.errors.short' } })
  expect(rule).not.toHaveBeenCalled()
  expect(submit('  ABC  ')).toEqual({ success: false, fieldErrors: { 'general.title': 'product.errors.title' } })
  expect(rule).toHaveBeenCalledWith('ABC', {
    address, fieldId: 'general.title', payloadPath: 'details.title',
    values: { general: { title: '  ABC  ' }, category: 'active' },
  })
})

test('orders new fields and projects only their exact extension or custom-field bindings', async () => {
  const choices = [{ value: 'wood', labelKey: 'product.material.wood' }] as const
  const control = field.add({ type: 'select', options: async () => ({ default: async () => choices }) })
  const getContext = () => ({ address, fieldId: 'material', payloadPath: 'customFields.productMaterial', values: {} })
  const load = crudFormExtensionOptionsLoader((await control.definition.options()).default, getContext)
  const section = deriveCrudFormFieldGranularSection({
    identity, address, customFieldDefinitionSetId: 'inventory.custom',
    changes: {
      active: { operation: 'add', definition: { type: 'boolean', required: true, after: 'material', labelKey: 'product.active' } },
      material: { operation: 'add', definition: { type: 'select', required: true, options: choices } },
      intake: { operation: 'add', definition: { type: 'date', before: 'material' } },
    },
    addedPayloadPaths: { active: 'extensions.inventory.active', material: 'customFields.productMaterial', intake: 'extensions.inventory.date' },
    prepared: { material: { loadOptions: load } },
  })
  expect(section.fields.map(({ id, type }) => [id, type])).toEqual([['intake', 'date'], ['material', 'select'], ['active', 'checkbox']])
  expect(section.fields[1]).toMatchObject({ options: [{ value: 'wood', label: 'product.material.wood', labelKey: 'product.material.wood' }] })
  await expect(load()).resolves.toEqual([{ value: 'wood', label: 'product.material.wood', labelKey: 'product.material.wood' }])
  expect(section.ownedCustomFieldIds).toEqual(['productMaterial'])
  expect(section.customFieldDefinitionSetId).toBe('inventory.custom')
  const values = { active: false, material: 'wood', intake: '2026-11-20', unrelated: 'drop' }
  expect(section.validateAndProject({ sectionValues: values, fullValues: values })).toMatchObject({
    success: true,
    data: { payload: { customFields: { productMaterial: 'wood' }, extensions: { inventory: { active: false, date: '2026-11-20' } } } },
  })
})

test('rejects cyclic placements and projectors that emit an unowned payload leaf', () => {
  expect(() => deriveCrudFormFieldGranularSection({
    identity, address,
    changes: {
      active: { operation: 'add', definition: { type: 'boolean', after: 'date' } },
      date: { operation: 'add', definition: { type: 'date', after: 'active' } },
    },
    addedPayloadPaths: { active: 'extensions.inventory.active', date: 'extensions.inventory.date' },
  })).toThrow(/cyclic field placement/)
  const base = defineCrudFormFieldGranularSection({
    id: 'inventory.details', roundTripId: 'inventory.details@v1', group: { id: 'details' },
    fields: [notes], fieldSchemas: { notes: z.string() }, fieldPayloadPaths: { notes: ['details.notes'] },
    refinements: [], projectField: { notes: () => ({ unowned: 'discard' }) },
  })
  expect(() => base.validateAndProject({ sectionValues: { notes: 'value' }, fullValues: {} })).toThrow(/unowned payload paths/)
})
