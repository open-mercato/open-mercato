import {
  addFieldFromPalette,
  addRoleToSchema,
  disableGuestSubmissions,
  enableGuestSubmissions,
  isGuestSubmissionEnabled,
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

describe('enableGuestSubmissions', () => {
  it('declares guest, sets it as default actor role, and grants every field editable-by guest', () => {
    const result = enableGuestSubmissions(baseSchema())
    expect(result['x-om-roles']).toEqual(['admin', 'patient', 'guest'])
    expect(result['x-om-default-actor-role']).toBe('guest')
    expect(result.properties.symptom['x-om-editable-by']).toEqual([
      'patient',
      'admin',
      'guest',
    ])
    expect(result.properties.note['x-om-editable-by']).toEqual([
      'patient',
      'guest',
      'admin',
    ])
  })

  it('leaves visible-to untouched', () => {
    const result = enableGuestSubmissions(baseSchema())
    expect(result.properties.symptom['x-om-visible-to']).toEqual(['patient'])
    expect(result.properties.note['x-om-visible-to']).toEqual([])
  })

  it('does not mutate the input schema', () => {
    const schema = baseSchema()
    enableGuestSubmissions(schema)
    expect(schema['x-om-roles']).toEqual(['admin', 'patient'])
    expect(schema['x-om-default-actor-role']).toBe('patient')
  })
})

describe('disableGuestSubmissions', () => {
  it('reverts an enabled schema: removes guest, resets default actor role, strips guest from fields', () => {
    const enabled = enableGuestSubmissions(baseSchema())
    const result = disableGuestSubmissions(enabled)
    expect(result['x-om-roles']).toEqual(['admin', 'patient'])
    expect(result['x-om-default-actor-role']).toBe('admin')
    expect(result.properties.symptom['x-om-editable-by']).toEqual(['patient', 'admin'])
    expect(result.properties.note['x-om-editable-by']).toEqual(['patient', 'admin'])
  })
})

describe('isGuestSubmissionEnabled', () => {
  it('is true only when guest is declared AND is the default actor role', () => {
    expect(isGuestSubmissionEnabled(baseSchema())).toBe(false)
    expect(isGuestSubmissionEnabled(enableGuestSubmissions(baseSchema()))).toBe(true)
  })

  it('is false when guest is declared but not the default actor role', () => {
    const schema = addRoleToSchema(baseSchema(), 'guest')
    expect(isGuestSubmissionEnabled(schema)).toBe(false)
  })
})

describe('addFieldFromPalette default permissions', () => {
  function sectionedSchema(defaultActorRole: string): FormSchema {
    return {
      type: 'object',
      'x-om-roles': defaultActorRole === 'admin' ? ['admin'] : ['admin', defaultActorRole],
      'x-om-default-actor-role': defaultActorRole,
      'x-om-sections': [{ key: 'general', title: { en: 'General' }, fieldKeys: [] }],
      properties: {},
      required: [],
    }
  }

  it('defaults editable-by to include the guest default actor role plus admin', () => {
    const { schema, fieldKey } = addFieldFromPalette({
      schema: sectionedSchema('guest'),
      typeKey: 'text',
      target: { sectionKey: 'general' },
    })
    expect(schema.properties[fieldKey]['x-om-editable-by']).toEqual(['guest', 'admin'])
    expect(schema.properties[fieldKey]['x-om-visible-to']).toBeUndefined()
  })

  it('defaults editable-by to just admin when the default actor role is admin', () => {
    const { schema, fieldKey } = addFieldFromPalette({
      schema: sectionedSchema('admin'),
      typeKey: 'text',
      target: { sectionKey: 'general' },
    })
    expect(schema.properties[fieldKey]['x-om-editable-by']).toEqual(['admin'])
    expect(schema.properties[fieldKey]['x-om-visible-to']).toBeUndefined()
  })
})
