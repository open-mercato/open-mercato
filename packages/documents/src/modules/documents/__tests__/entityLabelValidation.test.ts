import {
  documentEntityLinkCreateSchema,
  documentTemplateFillSlotSchema,
} from '../data/validators'

const ENTITY_ID = '11111111-1111-4111-8111-111111111111'
const GUID_SHAPED_LABEL = '12345678-1234-abcd-9876-1234567890ab'
const GUID_BEARING_LABEL = `Customer ${GUID_SHAPED_LABEL}`

const linkInput = {
  entityType: 'deal' as const,
  entityId: ENTITY_ID,
  label: 'Renewal opportunity',
  href: `/backend/customers/deals/${ENTITY_ID}`,
  source: 'chip' as const,
}

const templateSlotInput = {
  slot: 'deal',
  entityType: 'deal' as const,
  entityId: ENTITY_ID,
  label: 'Renewal opportunity',
  href: `/backend/customers/deals/${ENTITY_ID}`,
  values: {},
}

describe('user-visible document entity labels', () => {
  it.each([
    ['entity link', documentEntityLinkCreateSchema, linkInput],
    ['template slot', documentTemplateFillSlotSchema, templateSlotInput],
  ] as const)('rejects an exact GUID-shaped %s label', (_kind, schema, input) => {
    const result = schema.safeParse({ ...input, label: GUID_SHAPED_LABEL })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'documents.validation.links.readableLabelRequired' }),
      ]))
    }
  })

  it.each([
    ['entity link', documentEntityLinkCreateSchema, linkInput],
    ['template slot', documentTemplateFillSlotSchema, templateSlotInput],
  ] as const)('rejects a GUID anywhere in a %s label', (_kind, schema, input) => {
    expect(schema.safeParse({ ...input, label: GUID_BEARING_LABEL }).success).toBe(false)
  })

  it.each([
    ['entity link', documentEntityLinkCreateSchema, linkInput],
    ['template slot', documentTemplateFillSlotSchema, templateSlotInput],
  ] as const)('accepts a readable %s label', (_kind, schema, input) => {
    expect(schema.safeParse(input).success).toBe(true)
  })
})
