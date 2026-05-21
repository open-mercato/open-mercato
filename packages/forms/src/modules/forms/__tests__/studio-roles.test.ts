import {
  addRoleToSchema,
  removeRoleFromSchema,
  renameRoleInSchema,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'

function baseSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin', 'patient'],
    'x-om-default-actor-role': 'patient',
    properties: {
      symptom: {
        type: 'string',
        'x-om-type': 'text',
        'x-om-editable-by': ['patient', 'admin'],
        'x-om-visible-to': ['patient'],
      },
      note: {
        type: 'string',
        'x-om-type': 'textarea',
        'x-om-editable-by': ['patient'],
        'x-om-visible-to': [],
      },
    },
  }
}

describe('addRoleToSchema', () => {
  it('adds a new role and preserves admin', () => {
    const result = addRoleToSchema(baseSchema(), 'guest')
    expect(result['x-om-roles']).toEqual(['admin', 'patient', 'guest'])
  })

  it('dedupes when the role is already declared', () => {
    const result = addRoleToSchema(baseSchema(), 'patient')
    expect(result['x-om-roles']).toEqual(['admin', 'patient'])
  })

  it('does not mutate the input schema', () => {
    const schema = baseSchema()
    addRoleToSchema(schema, 'guest')
    expect(schema['x-om-roles']).toEqual(['admin', 'patient'])
  })
})

describe('renameRoleInSchema', () => {
  it('renames in roles, default actor role, and field references', () => {
    const result = renameRoleInSchema(baseSchema(), 'patient', 'guest')
    expect(result['x-om-roles']).toEqual(['admin', 'guest'])
    expect(result['x-om-default-actor-role']).toBe('guest')
    expect(result.properties.symptom['x-om-editable-by']).toEqual(['guest', 'admin'])
    expect(result.properties.symptom['x-om-visible-to']).toEqual(['guest'])
    expect(result.properties.note['x-om-editable-by']).toEqual(['guest'])
  })

  it('never touches admin', () => {
    const result = renameRoleInSchema(baseSchema(), 'admin', 'guest')
    expect(result['x-om-roles']).toEqual(['admin', 'patient'])
    const blocked = renameRoleInSchema(baseSchema(), 'patient', 'admin')
    expect(blocked['x-om-roles']).toEqual(['admin', 'patient'])
  })
})

describe('removeRoleFromSchema', () => {
  it('drops the role from roles and fields', () => {
    const result = removeRoleFromSchema(baseSchema(), 'patient')
    expect(result['x-om-roles']).toEqual(['admin'])
    expect(result.properties.symptom['x-om-editable-by']).toEqual(['admin'])
    expect(result.properties.symptom['x-om-visible-to']).toEqual([])
  })

  it('resets default actor role to admin when removed', () => {
    const result = removeRoleFromSchema(baseSchema(), 'patient')
    expect(result['x-om-default-actor-role']).toBe('admin')
  })

  it('falls back editable-by to [admin] when it would become empty', () => {
    const result = removeRoleFromSchema(baseSchema(), 'patient')
    expect(result.properties.note['x-om-editable-by']).toEqual(['admin'])
  })

  it('never removes admin', () => {
    const result = removeRoleFromSchema(baseSchema(), 'admin')
    expect(result['x-om-roles']).toEqual(['admin', 'patient'])
  })
})
