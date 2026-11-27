import {
  optionSchemaTemplateCreateSchema,
  optionSchemaTemplateUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
} from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const productId = '11111111-1111-4111-8111-111111111111'
const templateId = '77777777-7777-4777-8777-777777777777'

const option = {
  code: 'size',
  label: 'Size',
  inputType: 'select' as const,
}

const schemaWithNulls = {
  name: null,
  description: null,
  options: [{ ...option, description: null }],
}

describe.each([
  ['create', productCreateSchema, { ...scope, title: 'Synthetic product' }],
  ['update', productUpdateSchema, { ...scope, id: productId }],
] as const)('product option schema on %s (issue #10375)', (_operation, schema, input) => {
  it('accepts an explicit null name, description, and option description', () => {
    const result = schema.parse({ ...input, optionSchema: schemaWithNulls })

    expect(result.optionSchema?.name).toBeNull()
    expect(result.optionSchema?.description).toBeNull()
    expect(result.optionSchema?.options[0]?.description).toBeNull()
  })

  it('keeps omitted option-schema fields distinct from null', () => {
    const result = schema.parse({ ...input, optionSchema: { options: [option] } })

    expect(result.optionSchema).not.toHaveProperty('name')
    expect(result.optionSchema).not.toHaveProperty('description')
    expect(result.optionSchema?.options[0]).not.toHaveProperty('description')
  })

  it('trims string name and description values', () => {
    const result = schema.parse({
      ...input,
      optionSchema: {
        name: '  Shirt options  ',
        description: '  Free text  ',
        options: [{ ...option, description: '  Shown under the label  ' }],
      },
    })

    expect(result.optionSchema?.name).toBe('Shirt options')
    expect(result.optionSchema?.description).toBe('Free text')
    expect(result.optionSchema?.options[0]?.description).toBe('Shown under the label')
  })

  it('rejects invalid option-schema name and description values', () => {
    for (const name of [42, false, {}, []]) {
      const result = schema.safeParse({ ...input, optionSchema: { name, options: [option] } })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ['optionSchema', 'name'] })]),
        )
      }
    }

    const overlong = schema.safeParse({
      ...input,
      optionSchema: {
        description: 'x'.repeat(4001),
        options: [{ ...option, description: 'x'.repeat(2001) }],
      },
    })
    expect(overlong.success).toBe(false)
    if (!overlong.success) {
      expect(overlong.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['optionSchema', 'description'] }),
          expect.objectContaining({ path: ['optionSchema', 'options', 0, 'description'] }),
        ]),
      )
    }
  })
})

describe.each([
  [
    'create',
    optionSchemaTemplateCreateSchema,
    { ...scope, name: 'Synthetic template' },
  ],
  ['update', optionSchemaTemplateUpdateSchema, { id: templateId }],
] as const)('option schema template on %s (issue #10375)', (_operation, schema, input) => {
  it('accepts explicit nulls inside the nested option schema', () => {
    const result = schema.parse({ ...input, schema: schemaWithNulls })

    expect(result.schema?.name).toBeNull()
    expect(result.schema?.description).toBeNull()
    expect(result.schema?.options[0]?.description).toBeNull()
  })

  it('keeps omitted nested fields distinct from null', () => {
    const result = schema.parse({ ...input, schema: { options: [option] } })

    expect(result.schema).not.toHaveProperty('name')
    expect(result.schema).not.toHaveProperty('description')
    expect(result.schema?.options[0]).not.toHaveProperty('description')
  })
})
