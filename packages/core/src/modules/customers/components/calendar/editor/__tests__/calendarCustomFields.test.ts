import { selectCalendarCustomFields, projectCalendarCustomValues, validateCalendarCustomValues } from '../useCalendarCustomFields'

const definitions = [
  { key: 'visit_notes', kind: 'text', fieldsets: ['visit_details', 'shared'], validation: [{ rule: 'required' as const, message: 'required' }] },
  { key: 'general_notes', kind: 'text' },
  { key: 'private_notes', kind: 'text', fieldset: 'private' },
  { key: 'hidden', kind: 'text', fieldset: 'visit_details', formEditable: false },
]

describe('Customers calendar custom fields', () => {
  it('handles multiple fieldsets, general fields, empty selection and noneditable definitions', () => {
    expect(selectCalendarCustomFields(definitions, ['visit_details']).map((definition) => definition.key)).toEqual(['visit_notes'])
    expect(selectCalendarCustomFields(definitions, ['shared', '__general__']).map((definition) => definition.key)).toEqual(['visit_notes', 'general_notes'])
    expect(selectCalendarCustomFields(definitions, []).map((definition) => definition.key)).toEqual(['visit_notes', 'general_notes', 'private_notes'])
  })

  it('projects the submission without discarding the hidden draft values', () => {
    const values = { title: 'Visit', cf_visit_notes: 'On site', cf_private_notes: 'Retained draft' }
    const selected = selectCalendarCustomFields(definitions, ['visit_details'])
    expect(projectCalendarCustomValues(values, selected)).toEqual({ title: 'Visit', cf_visit_notes: 'On site' })
    expect(values.cf_private_notes).toBe('Retained draft')
    expect(projectCalendarCustomValues(values, selectCalendarCustomFields(definitions, ['private']))).toEqual({ title: 'Visit', cf_private_notes: 'Retained draft' })
  })

  it('validates only applicable fields using their declared validation rules', () => {
    expect(validateCalendarCustomValues({}, selectCalendarCustomFields(definitions, ['visit_details']))).toMatchObject({ ok: false, fieldErrors: { cf_visit_notes: 'required' } })
    expect(validateCalendarCustomValues({}, selectCalendarCustomFields(definitions, ['private']))).toMatchObject({ ok: true })
  })
})
